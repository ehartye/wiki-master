import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openOperationsLine, openOperationsList } from '../scripts/lib/open-operations.mjs';
import { abortOperation } from '../scripts/op-abort.mjs';
import { formatBrief } from '../scripts/lib/session-brief.mjs';

// An operation token is removed only by its own op-commit, so a session that ends before closing leaves one behind, and
// nothing said so except a note at the end of a sync. The state is now visible where people look for it (health and
// session-brief, only when something is open), and a session that stops early can drop its own token.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3600 * 1000;

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-openops-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'wiki', 'authored', 'p1'), { recursive: true });
  writeFileSync(join(dir, 'wiki/authored/p1/overview.md'), '---\ntype: authored\nstatus: draft\nsources: []\nai-generated: true\nproject: p1\nkind: overview\n---\n\nAn overview with enough words in it to be a substantive page for the integrity scan to read.\n');
  return dir;
}
function token(dir, id, hoursAgo, op = 'relink', dirty = []) {
  mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
  writeFileSync(join(dir, '.wiki-master', 'ops', `${id}.json`), JSON.stringify({ op, startedAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(), dirty }));
}
const run = (script, dir, ...args) => spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { env: { ...process.env, WIKI_MASTER_VAULT: dir }, encoding: 'utf8' });

test('no open operation: no line, no list', (t) => {
  const v = vault(t);
  assert.equal(openOperationsLine(v), null);
  assert.deepEqual(openOperationsList(v), []);
});

test('the line gives the count, the oldest, and how many are past a day', (t) => {
  const v = vault(t);
  token(v, 'f652e3bdeb9c2cee', 30, 'relink');
  token(v, '139e627a83b39c58', 2, 'ingest');
  const line = openOperationsLine(v);
  assert.match(line, /^Open vault operations: 2 \(oldest 1d 6h, relink f652e3bd\); 1 older than 24 hours\./);
  assert.match(line, /op-cleanup\.mjs/);
  assert.match(line, /op-abort\.mjs --since <token>/);
});

test('a single recent operation is said without the stale clause', (t) => {
  const v = vault(t);
  token(v, '139e627a83b39c58', 0.2, 'ingest');
  const line = openOperationsLine(v);
  assert.match(line, /^Open vault operations: 1 \(oldest under an hour, ingest 139e627a\)\./);
  assert.doesNotMatch(line, /older than/);
});

test('the list carries token, op, start, age and staleness', (t) => {
  const v = vault(t);
  token(v, 'f652e3bdeb9c2cee', 30);
  const [o] = openOperationsList(v);
  assert.equal(o.token, 'f652e3bdeb9c2cee');
  assert.equal(o.op, 'relink');
  assert.equal(o.stale, true);
  assert.ok(o.ageHours > 29.9 && o.ageHours < 30.2);
  assert.ok(Date.parse(o.startedAt) > 0);
});

test('health prints the line only when an operation is open, and --json lists them', (t) => {
  const v = vault(t);
  const quiet = run('health.mjs', v);
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.doesNotMatch(quiet.stdout, /Open vault operations/);
  assert.deepEqual(JSON.parse(run('health.mjs', v, '--json').stdout).openOperations, []);
  token(v, 'f652e3bdeb9c2cee', 30);
  const shown = run('health.mjs', v);
  assert.match(shown.stdout, /^Open vault operations: 1 \(oldest 1d 6h, relink f652e3bd\); 1 older than 24 hours/m);
  const json = JSON.parse(run('health.mjs', v, '--json').stdout);
  assert.equal(json.openOperations.length, 1);
  assert.equal(json.openOperations[0].token, 'f652e3bdeb9c2cee');
  assert.equal(json.defectCount, 0, 'an open operation is not a defect and does not change the count');
});

test('session-brief adds the line in both outputs, and not otherwise', () => {
  const line = 'Open vault operations: 1 (oldest 2h, ingest 139e627a).';
  const noState = formatBrief({ project: 'p1', path: 'wiki/authored/p1', by: 'flag', brief: null, openOperations: line });
  assert.ok(noState.endsWith(line));
  const brief = { report: ['Phase: x', 'Next step: y', 'Blocked by: z'], empty: [], stale: [], blockedItems: [], overdue: [], dueNext: [] };
  assert.ok(formatBrief({ project: 'p1', path: 'wiki/authored/p1', by: 'flag', brief, openOperations: line }).endsWith(line));
  assert.doesNotMatch(formatBrief({ project: 'p1', path: 'wiki/authored/p1', by: 'flag', brief }), /Open vault operations/);
});

test('session-brief on the command line shows the line when an operation is open', (t) => {
  const v = vault(t);
  assert.doesNotMatch(run('session-brief.mjs', v, '--project', 'p1').stdout, /Open vault operations/);
  token(v, 'f652e3bdeb9c2cee', 30);
  const shown = run('session-brief.mjs', v, '--project', 'p1');
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /Open vault operations: 1 /);
});

test('op-abort drops the named token whatever its age, and only that one', (t) => {
  const v = vault(t);
  token(v, 'aaaaaaaaaaaaaaaa', 0.01, 'relink', ['x.md', 'y.md']);
  token(v, 'bbbbbbbbbbbbbbbb', 30);
  const r = abortOperation(v, 'aaaaaaaaaaaaaaaa');
  assert.equal(r.ok, true);
  assert.deepEqual([r.op, r.dirtyCount], ['relink', 2]);
  assert.deepEqual(readdirSync(join(v, '.wiki-master', 'ops')), ['bbbbbbbbbbbbbbbb.json']);
});

test('op-abort refuses a token that is malformed or not there, and removes nothing outside the operations folder', (t) => {
  const v = vault(t);
  mkdirSync(join(v, '.wiki-master'), { recursive: true });
  writeFileSync(join(v, '.wiki-master', 'keep.json'), '{}');
  for (const bad of ['../keep', '..\\keep', 'keep.json', 'not-hex', '', 'abc']) {
    const r = abortOperation(v, bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.reason, /malformed|no such/, bad);
  }
  assert.equal(abortOperation(v, 'cccccccccccccccc').ok, false);
  assert.ok(existsSync(join(v, '.wiki-master', 'keep.json')));
});

test('op-abort on the command line: it names what it dropped and what it left', (t) => {
  const v = vault(t);
  token(v, 'aaaaaaaaaaaaaaaa', 3, 'ingest', ['x.md']);
  const r = run('op-abort.mjs', v, '--since', 'aaaaaaaaaaaaaaaa');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dropped operation aaaaaaaaaaaaaaaa \(ingest, started /);
  assert.match(r.stdout, /still in the working tree/);
  assert.equal(existsSync(join(v, '.wiki-master', 'ops', 'aaaaaaaaaaaaaaaa.json')), false);
  const again = run('op-abort.mjs', v, '--since=aaaaaaaaaaaaaaaa');
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /no such operation/);
});

test('op-abort needs a token, and refuses an option it does not know', (t) => {
  const v = vault(t);
  assert.notEqual(run('op-abort.mjs', v).status, 0);
  assert.match(run('op-abort.mjs', v, '--force').stderr, /unknown option/);
  assert.equal(run('op-abort.mjs', v, '--help').status, 0);
});
