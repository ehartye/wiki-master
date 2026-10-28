import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { beginOp } from '../scripts/op-begin.mjs';
import { commitOp } from '../scripts/op-commit.mjs';
import { abortOperation } from '../scripts/op-abort.mjs';
import { cleanupOperations } from '../scripts/op-cleanup.mjs';
import { recordWritten, writtenLedgerFile, orphanLedgers } from '../scripts/lib/op-ledger.mjs';

// The ledger lives and dies with its operation: op-commit removes it when the close lands (and keeps it with the token when the
// close is refused, so the same close can be retried), op-abort removes it with the token, and op-cleanup removes it with a
// stale token it is told to remove. A ledger whose token is already gone is listed, and removed only when named.

const HOUR = 3600 * 1000;

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-oplife-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(dir, '.gitignore'), '.wiki-master/\n');
  git('add', '.gitignore');
  git('commit', '-q', '-m', 'initial');
  return dir;
}
const put = (dir, rel, text = 'x\n') => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
function oldToken(dir, id, hoursAgo) {
  mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
  const file = join(dir, '.wiki-master', 'ops', `${id}.json`);
  writeFileSync(file, JSON.stringify({ op: 'ingest', startedAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(), dirty: [] }));
  return file;
}

test('a close that lands removes the ledger', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'discover');
  put(v, 'raw/clippings/a.md');
  recordWritten(v, token, ['raw/clippings/a.md']);
  assert.equal(existsSync(writtenLedgerFile(v, token)), true);
  assert.equal(commitOp(v, { op: 'discover', title: 't', token, paths: ['raw/clippings/a.md'] }).committed, true);
  assert.equal(existsSync(writtenLedgerFile(v, token)), false);
});

test('a close with nothing to commit also removes it', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'discover');
  recordWritten(v, token, ['raw/clippings/never-written.md']);
  assert.equal(commitOp(v, { op: 'discover', title: 't', token }).committed, false);
  assert.equal(existsSync(writtenLedgerFile(v, token)), false);
});

test('a refused close keeps the token and the ledger so the same close can be retried', (t) => {
  const v = repo(t);
  put(v, 'wiki/theirs.md');
  const token = beginOp(v, 'relink');
  put(v, 'wiki/theirs.md', 'edited\n');
  recordWritten(v, token, ['wiki/theirs.md']);
  const r = commitOp(v, { op: 'relink', title: 't', token, paths: ['wiki/theirs.md'] });
  assert.equal(r.refused, true);
  assert.equal(existsSync(writtenLedgerFile(v, token)), true);
  assert.equal(commitOp(v, { op: 'relink', title: 't', token, paths: ['wiki/theirs.md'], include: ['wiki/theirs.md'] }).committed, true);
  assert.equal(existsSync(writtenLedgerFile(v, token)), false);
});

test('op-abort drops the ledger with the token, and only that operation\'s', (t) => {
  const v = repo(t);
  const mine = beginOp(v, 'ingest');
  const other = beginOp(v, 'relink');
  recordWritten(v, mine, ['raw/clippings/a.md']);
  recordWritten(v, other, ['raw/clippings/b.md']);
  assert.equal(abortOperation(v, mine).ok, true);
  assert.equal(existsSync(writtenLedgerFile(v, mine)), false);
  assert.equal(existsSync(writtenLedgerFile(v, other)), true);
});

test('op-cleanup removes a stale token\'s ledger with it, and a recent operation\'s ledger stays', (t) => {
  const v = repo(t);
  oldToken(v, 'aaaaaaaaaaaaaaaa', 30);
  const recent = beginOp(v, 'ingest');
  recordWritten(v, 'aaaaaaaaaaaaaaaa', ['raw/clippings/a.md']);
  recordWritten(v, recent, ['raw/clippings/b.md']);
  const dry = cleanupOperations(v, { apply: false });
  assert.deepEqual(dry.stale.map((o) => o.token), ['aaaaaaaaaaaaaaaa']);
  assert.equal(existsSync(writtenLedgerFile(v, 'aaaaaaaaaaaaaaaa')), true, 'a dry run removes nothing');
  const done = cleanupOperations(v, { apply: true, tokens: ['aaaaaaaaaaaaaaaa'] });
  assert.deepEqual(done.removed, ['aaaaaaaaaaaaaaaa']);
  assert.equal(existsSync(writtenLedgerFile(v, 'aaaaaaaaaaaaaaaa')), false);
  assert.equal(existsSync(writtenLedgerFile(v, recent)), true);
});

test('a ledger whose token is gone is listed, and removed only when its token is named', (t) => {
  const v = repo(t);
  oldToken(v, 'aaaaaaaaaaaaaaaa', 30);
  const orphan = join(v, '.wiki-master', 'ops', 'bbbbbbbbbbbbbbbb.paths.jsonl');
  writeFileSync(orphan, `${JSON.stringify('raw/clippings/x.md')}\n`);
  assert.deepEqual(orphanLedgers(v), ['bbbbbbbbbbbbbbbb']);
  assert.deepEqual(cleanupOperations(v, { apply: false }).orphanLedgers, ['bbbbbbbbbbbbbbbb']);
  cleanupOperations(v, { apply: true, tokens: ['aaaaaaaaaaaaaaaa'] });
  assert.equal(existsSync(orphan), true, 'naming another token does not remove it');
  const done = cleanupOperations(v, { apply: true, tokens: ['bbbbbbbbbbbbbbbb'] });
  assert.deepEqual(done.removedLedgers, ['bbbbbbbbbbbbbbbb']);
  assert.equal(existsSync(orphan), false);
});

test('a ledger beside its open token is not an orphan', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'ingest');
  recordWritten(v, token, ['raw/clippings/a.md']);
  assert.deepEqual(orphanLedgers(v), []);
});
