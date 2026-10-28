import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { commitOp } from '../scripts/op-commit.mjs';
import { beginOp } from '../scripts/op-begin.mjs';
import { recordRefusal, readRefusalCounts, refusalsLine, refusalsFile } from '../scripts/lib/op-refusals.mjs';

// Every refused op-commit leaves one counts-only line in .wiki-master/op-refusals.jsonl, and health shows the totals. The
// line holds a time, the operation, the kind and a number: never a path name.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const RECEIPT = Buffer.from('{\r\n  "run": 91,\r\n  "ok": true\r\n}\r\n');
const declare = (buf) => ({ bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-refusals-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'core.safecrlf', 'false');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, '.gitignore'), '.wiki-master/\n');
  writeFileSync(join(dir, '.gitattributes'), '* text=auto eol=lf\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}
const put = (dir, path, data) => { const file = join(dir, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
const lines = (dir) => (existsSync(refusalsFile(dir)) ? readFileSync(refusalsFile(dir), 'utf8').split('\n').filter(Boolean) : []);
const records = (dir) => lines(dir).map((l) => JSON.parse(l));
const health = (dir, ...args) => spawnSync(process.execPath, [join(root, 'scripts', 'health.mjs'), ...args], { env: { ...process.env, WIKI_MASTER_VAULT: dir }, encoding: 'utf8' });

// Each refusal kind, produced by a real refused close. Returns the file name that must never reach the record.
function unscoped(dir) {
  const a = beginOp(dir, 'ingest');
  beginOp(dir, 'relink');
  put(dir, 'private-note-name.md', 'x\n');
  const r = commitOp(dir, { op: 'ingest', title: 't', token: a });
  assert.equal(r.ok, false);
  return 'private-note-name';
}
function preDirty(dir) {
  put(dir, 'secret-draft.md', 'x\n');
  const a = beginOp(dir, 'relink');
  put(dir, 'ours.md', 'x\n');
  const r = commitOp(dir, { op: 'relink', title: 't', token: a, paths: ['ours.md', 'secret-draft.md'] });
  assert.equal(r.ok, false);
  return 'secret-draft';
}
function evidence(dir) {
  const a = beginOp(dir, 'relink');
  put(dir, 'raw/evidence/confidential-receipt.json', RECEIPT);
  const r = commitOp(dir, { op: 'relink', title: 't', token: a, paths: ['raw/evidence/confidential-receipt.json'], evidence: { 'raw/evidence/confidential-receipt.json': declare(RECEIPT) } });
  assert.equal(r.ok, false);
  return 'confidential-receipt';
}

test('an unscoped refusal records kind unscoped and the number of delta paths, with no name', (t) => {
  const dir = vault(t);
  const name = unscoped(dir);
  const [one, ...rest] = records(dir);
  assert.equal(rest.length, 0, 'exactly one line');
  assert.equal(one.kind, 'unscoped');
  assert.equal(one.paths, 1);
  assert.equal(one.op, 'ingest');
  assert.ok(Number.isFinite(Date.parse(one.at)));
  assert.deepEqual(Object.keys(one).sort(), ['at', 'kind', 'op', 'paths']);
  assert.ok(!readFileSync(refusalsFile(dir), 'utf8').includes(name));
});

test('a pre-dirty refusal records kind pre-dirty and the number of unowned ledger paths, with no name', (t) => {
  const dir = vault(t);
  const name = preDirty(dir);
  const [one, ...rest] = records(dir);
  assert.equal(rest.length, 0);
  assert.equal(one.kind, 'pre-dirty');
  assert.equal(one.paths, 1);
  assert.ok(!readFileSync(refusalsFile(dir), 'utf8').includes(name));
});

test('an evidence mismatch records kind evidence and the size of the evidence map, with no name', (t) => {
  const dir = vault(t);
  const name = evidence(dir);
  const [one, ...rest] = records(dir);
  assert.equal(rest.length, 0);
  assert.equal(one.kind, 'evidence');
  assert.equal(one.paths, 1);
  assert.ok(!readFileSync(refusalsFile(dir), 'utf8').includes(name));
});

test('a close that lands appends nothing, and neither does a refusal that is not one of the three kinds', (t) => {
  const dir = vault(t);
  const a = beginOp(dir, 'relink');
  put(dir, 'ours.md', 'x\n');
  assert.equal(commitOp(dir, { op: 'relink', title: 't', token: a }).ok, true);
  assert.equal(commitOp(dir, { op: 'relink', title: 't', token: a }).ok, false, 'a missing token is not a recorded refusal');
  assert.equal(commitOp(dir, { op: 'relink', title: 't', token: 'bad', paths: [] }).ok, false);
  assert.deepEqual(lines(dir), []);
});

test('a failed append never changes the result: a directory in the file place still refuses and still lands', (t) => {
  const dir = vault(t);
  mkdirSync(refusalsFile(dir), { recursive: true });
  const a = beginOp(dir, 'ingest');
  beginOp(dir, 'relink');
  put(dir, 'ours.md', 'x\n');
  const refused = commitOp(dir, { op: 'ingest', title: 't', token: a });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /^this close has no --paths-file and another operation is open/);
  assert.ok(existsSync(join(dir, '.wiki-master', 'ops', `${a}.json`)), 'the token is kept');
  const scope = commitOp(dir, { op: 'ingest', title: 't', token: a, paths: ['ours.md'] });
  assert.equal(scope.ok, true, 'a landed close is unaffected');
  assert.equal(recordRefusal(dir, { op: 'x', kind: 'unscoped', paths: 1 }), false, 'the failure is reported to the caller as false, never thrown');
});

test('the counts read back by kind; damaged lines and unknown kinds count as nothing', (t) => {
  const dir = vault(t);
  assert.deepEqual(readRefusalCounts(dir), { total: 0, preDirty: 0, evidence: 0, unscoped: 0 });
  mkdirSync(join(dir, '.wiki-master'), { recursive: true });
  writeFileSync(refusalsFile(dir), [
    JSON.stringify({ at: 'x', op: 'a', kind: 'pre-dirty', paths: 2 }),
    'not json',
    JSON.stringify({ at: 'x', op: 'a', kind: 'evidence', paths: 1 }),
    JSON.stringify({ at: 'x', op: 'a', kind: 'something-else', paths: 1 }),
    JSON.stringify({ at: 'x', op: 'a', kind: 'unscoped', paths: 4 }),
    JSON.stringify({ at: 'x', op: 'a', kind: 'unscoped', paths: 1 }),
    '',
  ].join('\n'));
  assert.deepEqual(readRefusalCounts(dir), { total: 4, preDirty: 1, evidence: 1, unscoped: 2 });
  assert.equal(refusalsLine({ total: 0, preDirty: 0, evidence: 0, unscoped: 0 }), null);
  assert.equal(refusalsLine({ total: 4, preDirty: 1, evidence: 1, unscoped: 2 }), 'Recorded op-commit refusals: 4 (pre-dirty 1, evidence 1, unscoped 2).');
});

test('health prints the refusals line only above zero and --json always carries opRefusals, with the defect count unchanged', (t) => {
  const dir = vault(t);
  mkdirSync(join(dir, 'wiki', 'authored', 'p1'), { recursive: true });
  writeFileSync(join(dir, 'wiki/authored/p1/overview.md'), '---\ntype: authored\nstatus: draft\nsources: []\nai-generated: true\nproject: p1\nkind: overview\n---\n\nAn overview with enough words in it to be a substantive page for the integrity scan to read.\n');
  const absent = health(dir);
  assert.equal(absent.status, 0, absent.stderr);
  assert.doesNotMatch(absent.stdout, /Recorded op-commit refusals/);
  const base = JSON.parse(health(dir, '--json').stdout);
  assert.deepEqual(base.opRefusals, { total: 0, preDirty: 0, evidence: 0, unscoped: 0 });

  mkdirSync(join(dir, '.wiki-master'), { recursive: true });
  writeFileSync(refusalsFile(dir), '');
  assert.doesNotMatch(health(dir).stdout, /Recorded op-commit refusals/, 'an empty file prints nothing');

  writeFileSync(refusalsFile(dir), ['pre-dirty', 'evidence', 'unscoped'].map((kind) => JSON.stringify({ at: new Date().toISOString(), op: 'relink', kind, paths: 1 })).join('\n') + '\n');
  const shown = health(dir);
  assert.match(shown.stdout, /^Recorded op-commit refusals: 3 \(pre-dirty 1, evidence 1, unscoped 1\)\.$/m);
  const json = JSON.parse(health(dir, '--json').stdout);
  assert.deepEqual(json.opRefusals, { total: 3, preDirty: 1, evidence: 1, unscoped: 1 });
  assert.equal(json.defectCount, base.defectCount, 'a recorded refusal is not a defect');
});
