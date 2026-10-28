import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { beginOp } from '../scripts/op-begin.mjs';
import { commitOp } from '../scripts/op-commit.mjs';
import { showLedger } from '../scripts/op-ledger.mjs';
import { recordWritten, readWritten, writtenLedgerFile } from '../scripts/lib/op-ledger.mjs';

// `op-ledger show` turns what the writers recorded into the file op-commit takes as --paths-file, and says, before the close,
// what the close would get wrong: a recorded path that was already dirty when the operation opened (op-commit refuses it), a
// recorded path that is not dirty now, and every path this operation made dirty that nobody recorded (it never claims those:
// another writer may own them, and a forgotten log entry looks the same).

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DASH = String.fromCodePoint(0x2014);

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-opledger-'));
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
const cli = (dir, ...args) => spawnSync(process.execPath, [join(root, 'scripts', 'op-ledger.mjs'), ...args], { env: { ...process.env, WIKI_MASTER_VAULT: dir }, encoding: 'utf8' });
const committed = (dir) => execFileSync('git', ['-c', 'core.quotePath=false', 'show', '--name-only', '--format=', 'HEAD'], { cwd: dir, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).sort();
const dirty = (dir) => execFileSync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).map((l) => l.slice(3));

test('show prints exactly the recorded paths; op-commit takes them and leaves a foreign file alone', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'discover');
  const dashName = `raw/clippings/Fish ${DASH} a note.md`;
  put(v, 'raw/clippings/plain.md');
  put(v, dashName);
  put(v, 'raw/clippings/foreign.md');
  recordWritten(v, token, ['raw/clippings/plain.md', dashName]);

  const r = showLedger(v, token);
  assert.equal(r.ok, true);
  assert.deepEqual(r.paths, ['raw/clippings/plain.md', dashName]);
  assert.deepEqual(r.unclaimed, ['raw/clippings/foreign.md']);
  assert.deepEqual([r.preexisting, r.clean], [[], []]);

  const out = join(v, '.wiki-master', 'ledger.json');
  const shown = cli(v, 'show', '--since', token, '--out', out);
  assert.equal(shown.status, 0, shown.stderr);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), ['raw/clippings/plain.md', dashName]);
  assert.match(shown.stderr, /unclaimed \(1\).*foreign\.md/s);

  const done = commitOp(v, { op: 'discover', title: 'two clips', token, paths: JSON.parse(readFileSync(out, 'utf8')) });
  assert.equal(done.committed, true);
  assert.deepEqual(committed(v), ['raw/clippings/plain.md', dashName].sort());
  assert.deepEqual(dirty(v), ['raw/clippings/foreign.md']);
  assert.equal(existsSync(writtenLedgerFile(v, token)), false, 'the ledger goes with the closed operation');
});

test('stdout is the JSON array and nothing else, so it can be piped to a file', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'ingest');
  put(v, 'wiki/sources/a.md');
  put(v, 'wiki/sources/stray.md');
  recordWritten(v, token, ['wiki/sources/a.md']);
  const shown = cli(v, 'show', '--since', token);
  assert.equal(shown.status, 0, shown.stderr);
  assert.deepEqual(JSON.parse(shown.stdout), ['wiki/sources/a.md']);
});

test('a forgotten log entry is unclaimed before the close, and recording it clears that', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'relink');
  put(v, 'wiki/authored/p/a.md');
  put(v, 'log/2026-10-28-120000-relink-x.md');
  recordWritten(v, token, ['wiki/authored/p/a.md']);
  assert.deepEqual(showLedger(v, token).unclaimed, ['log/2026-10-28-120000-relink-x.md']);
  recordWritten(v, token, ['log/2026-10-28-120000-relink-x.md']);
  assert.deepEqual(showLedger(v, token).unclaimed, []);
});

test('a recorded path that was already dirty when the operation opened is flagged, with the way out', (t) => {
  const v = repo(t);
  put(v, 'wiki/other/theirs.md');
  const token = beginOp(v, 'relink');
  put(v, 'wiki/other/theirs.md', 'edited again\n');
  put(v, 'wiki/authored/p/a.md');
  recordWritten(v, token, ['wiki/authored/p/a.md', 'wiki/other/theirs.md']);
  const r = showLedger(v, token);
  assert.deepEqual(r.preexisting, ['wiki/other/theirs.md']);
  const shown = cli(v, 'show', '--since', token);
  assert.match(shown.stderr, /already dirty before op-begin \(1\).*--include.*theirs\.md/s);
  assert.equal(commitOp(v, { op: 'relink', title: 't', token, paths: r.paths }).refused, true, 'op-commit would refuse it');
});

test('a recorded path that is not dirty now is reported, not hidden', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'ingest');
  put(v, 'wiki/sources/a.md');
  recordWritten(v, token, ['wiki/sources/a.md', 'wiki/sources/typo.md']);
  const r = showLedger(v, token);
  assert.deepEqual(r.clean, ['wiki/sources/typo.md']);
  assert.match(cli(v, 'show', '--since', token).stderr, /not changed now \(1\).*typo\.md/s);
});

test('a foreign non-ASCII file is listed by its real name, not an escaped one', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'discover');
  put(v, 'raw/clippings/a.md');
  put(v, `raw/clippings/Theirs ${DASH} b.md`);
  recordWritten(v, token, ['raw/clippings/a.md']);
  assert.deepEqual(showLedger(v, token).unclaimed, [`raw/clippings/Theirs ${DASH} b.md`]);
});

test('show refuses when nothing was recorded or the token is not open', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'discover');
  const empty = cli(v, 'show', '--since', token);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /nothing recorded/);
  const gone = cli(v, 'show', '--since', 'bbbbbbbbbbbbbbbb');
  assert.equal(gone.status, 1);
  assert.match(gone.stderr, /no open operation/);
  assert.equal(cli(v, 'show').status, 1);
});

test('add records paths given on the line and from a JSON file, and says what it recorded', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'ingest');
  put(v, 'wiki/sources/a.md');
  put(v, `wiki/sources/b ${DASH} c.md`);
  const list = join(v, '.wiki-master', 'from.json');
  writeFileSync(list, String.fromCodePoint(0xFEFF) + JSON.stringify([`wiki/sources/b ${DASH} c.md`])); // as Windows PowerShell saves it
  const one = cli(v, 'add', '--since', token, 'wiki/sources/a.md');
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /recorded 1 path/);
  const two = cli(v, 'add', `--since=${token}`, '--from', list);
  assert.equal(two.status, 0, two.stderr);
  assert.deepEqual(readWritten(v, token), ['wiki/sources/a.md', `wiki/sources/b ${DASH} c.md`]);
});

test('add with a bad path or token records nothing and exits 1', (t) => {
  const v = repo(t);
  const token = beginOp(v, 'ingest');
  assert.equal(cli(v, 'add', '--since', token, 'ok.md', '../up.md').status, 1);
  assert.equal(cli(v, 'add', '--since', 'bbbbbbbbbbbbbbbb', 'ok.md').status, 1);
  assert.equal(cli(v, 'add', '--since', token).status, 1, 'no path given');
  assert.deepEqual(readWritten(v, token), []);
});

test('the command takes a subcommand and refuses an option it does not know', (t) => {
  const v = repo(t);
  assert.equal(cli(v).status, 1);
  assert.equal(cli(v, 'frobnicate').status, 1);
  const bad = cli(v, 'show', '--force');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option/);
  assert.equal(cli(v, '--help').status, 0);
});
