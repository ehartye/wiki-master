import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateSkillBehavior, compareSkillBehavior, scenarioHash } from '../scripts/evaluate-skill-behavior.mjs';

const dataset = { version: 1, scenarios: [{ id: 'read', prompt: 'Find pages only', facts: 'No writes', requiredActions: ['search'], forbiddenActions: ['write'] }] };
const trace = (overrides = {}) => ({ version: 1, condition: 'with', mode: 'simulation', scenarioHash: scenarioHash(dataset), observer: { id: 'reviewer', independent: true }, runs: [{ id: 'read', complete: true, transcript: 'I searched. I wrote a note.', actions: [{ name: 'search', evidence: 'I searched.' }, { name: 'write', evidence: 'I wrote a note.' }] }], ...overrides });

test('a required action does not conceal a forbidden write', () => {
  const r = evaluateSkillBehavior(dataset, trace());
  assert.equal(r.status, 'fail');
  assert.deepEqual(r.runs[0].forbiddenActions, ['write']);
  assert.equal(r.runs[0].requiredActionRecall, 1);
  assert.equal(r.mode, 'simulation');
});

test('missing scenarios and truncated traces are incomplete, not successful', () => {
  const r = evaluateSkillBehavior(dataset, trace({ runs: [] }));
  assert.equal(r.status, 'incomplete');
  assert.equal(r.coverage.missing, 1);
  const partial = trace(); partial.runs[0].complete = false;
  assert.equal(evaluateSkillBehavior(dataset, partial).status, 'incomplete');
});

test('unobserved actions and self-grades cannot masquerade as independent evidence', () => {
  const fabricated = trace(); fabricated.runs[0].actions[0].evidence = 'not in transcript';
  assert.throws(() => evaluateSkillBehavior(dataset, fabricated), /evidence/i);
  assert.throws(() => evaluateSkillBehavior(dataset, trace({ observer: { id: 'actor', independent: false } })), /independent/i);
});

test('rejects duplicate/unknown scenarios, mismatched suite, and unsupported modes', () => {
  const duplicate = trace(); duplicate.runs.push(duplicate.runs[0]);
  assert.throws(() => evaluateSkillBehavior(dataset, duplicate), /duplicate/i);
  const unknown = trace(); unknown.runs[0].id = 'other';
  assert.throws(() => evaluateSkillBehavior(dataset, unknown), /unknown/i);
  assert.throws(() => evaluateSkillBehavior(dataset, trace({ scenarioHash: 'old' })), /hash/i);
  assert.throws(() => evaluateSkillBehavior(dataset, trace({ mode: 'self-assessment' })), /mode/i);
});

test('comparison preserves failures, omissions and matched conditions', () => {
  const good = trace(); good.runs[0].actions.pop(); good.runs[0].transcript = 'I searched.';
  const without = trace({ condition: 'without' });
  const r = compareSkillBehavior(dataset, good, without);
  assert.equal(r.with.status, 'pass'); assert.equal(r.without.status, 'fail');
  assert.equal(r.delta.passedScenarios, 1);
  assert.throws(() => compareSkillBehavior(dataset, good, trace({ condition: 'without', mode: 'execution' })), /same mode/i);
});

test('execution mode requires independently captured tool/artifact evidence', () => {
  const run = trace({ mode: 'execution' });
  assert.throws(() => evaluateSkillBehavior(dataset, run), /artifact/i);
  run.runs[0].artifacts = [{ kind: 'tool-output', reference: 'fixture-run.log' }];
  assert.equal(evaluateSkillBehavior(dataset, run).status, 'fail');
});

test('CLI reports incomplete coverage with exit 2, writes a report and rejects malformed combinations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-grader-'));
  const script = fileURLToPath(new URL('../scripts/evaluate-skill-behavior.mjs', import.meta.url));
  try {
    const suite = join(dir, 'suite.json'), input = join(dir, 'trace.json'), output = join(dir, 'report.json');
    writeFileSync(suite, JSON.stringify(dataset)); writeFileSync(input, JSON.stringify(trace({ runs: [] })));
    const args = ['--scenarios', suite, '--traces', input, '--output', output];
    const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).status, 'incomplete');
    const invalid = spawnSync(process.execPath, [script, ...args, '--with', input], { encoding: 'utf8' });
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /either/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
