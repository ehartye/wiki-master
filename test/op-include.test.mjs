import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as beginMain } from '../scripts/op-begin.mjs';
import { main as commitMain, commitOp } from '../scripts/op-commit.mjs';

// A path named in the ledger that was already dirty when the operation opened used to be dropped from the commit and
// listed as "left alone" while op-commit exited 0, so a page the author believed published stayed on disk only. The
// ledger is a statement of ownership, but pre-existing dirt may be another writer's work, so op-commit now refuses
// loudly and names the paths, and `--include` is the explicit, reported way to adopt them.

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-opinc-'));
  const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(dir, '.gitignore'), '.wiki-master/\n');
  writeFileSync(join(dir, 'tracked.md'), 'tracked v1\n');
  writeFileSync(join(dir, 'index.md'), 'index v1\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return { dir, git };
}

async function run(fn, vaultPath, argv) {
  const prev = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = vaultPath;
  const logs = []; const errs = [];
  const { log, error } = console;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  process.exitCode = undefined;
  let exitCode;
  try { await fn(argv); } finally {
    exitCode = process.exitCode; process.exitCode = undefined;
    console.log = log; console.error = error;
    if (prev === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prev;
  }
  return { logs, errs, exitCode };
}

const begin = async (dir) => (await run(beginMain, dir, ['--op', 'relink'])).logs[0].trim();
const tokenAlive = (dir, token) => existsSync(join(dir, '.wiki-master', 'ops', `${token}.json`));
const committed = (git) => git('show', '--name-only', '--format=', 'HEAD').split(/\r?\n/).filter(Boolean).sort();
const ledgerFile = (dir, paths, name = 'ledger.json') => { mkdirSync(join(dir, '.wiki-master'), { recursive: true }); const f = join(dir, '.wiki-master', name); writeFileSync(f, JSON.stringify(paths)); return f; };

test('a ledger path that was dirty before op-begin makes op-commit refuse, name it, and keep the token', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'early.md'), 'written before op-begin\n'); // a new page, created before the operation opened
  const token = await begin(dir);
  writeFileSync(join(dir, 'late.md'), 'written after\n');
  const head = git('rev-parse', 'HEAD');
  const r = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledgerFile(dir, ['early.md', 'late.md'])]);
  assert.equal(r.exitCode, 1);
  assert.match(r.errs.join('\n'), /early\.md/);
  assert.match(r.errs.join('\n'), /already dirty before/);
  assert.match(r.errs.join('\n'), /--include/);
  assert.doesNotMatch(r.errs.join('\n'), /late\.md/, 'only the refused path is listed');
  assert.ok(tokenAlive(dir, token), 'the token is kept so the same close can be retried');
  assert.equal(git('rev-parse', 'HEAD'), head, 'nothing was committed');
  assert.equal(git('diff', '--cached', '--name-only'), '', 'nothing was staged');
});

test('--include adopts the named pre-existing paths, commits them with the rest, and reports them', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'early.md'), 'written before op-begin\n');
  const token = await begin(dir);
  writeFileSync(join(dir, 'late.md'), 'written after\n');
  const r = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledgerFile(dir, ['early.md', 'late.md']), '--include', 'early.md']);
  assert.equal(r.exitCode, undefined, r.errs.join('\n'));
  assert.deepEqual(committed(git), ['early.md', 'late.md']);
  assert.ok(r.logs.some((l) => /adopted/i.test(l) && /1 file/.test(l)), r.logs.join('\n'));
  assert.ok(r.logs.includes('  early.md'));
  assert.ok(!r.logs.some((l) => /left alone \(already dirty/.test(l)), 'an adopted path is not also reported as left alone');
  assert.equal(tokenAlive(dir, token), false);
});

test('a refused close can be retried with --include under the same token', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'early.md'), 'x\n');
  const token = await begin(dir);
  const ledger = ledgerFile(dir, ['early.md']);
  const first = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledger]);
  assert.equal(first.exitCode, 1);
  const second = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledger, '--include', 'early.md']);
  assert.equal(second.exitCode, undefined, second.errs.join('\n'));
  assert.deepEqual(committed(git), ['early.md']);
});

test('--include-from reads a ledger-format file, with or without a byte-order mark', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.md'), 'a\n'); writeFileSync(join(dir, 'b.md'), 'b\n');
  const token = await begin(dir);
  const inc = join(dir, '.wiki-master', 'include.json');
  mkdirSync(join(dir, '.wiki-master'), { recursive: true });
  writeFileSync(inc, String.fromCharCode(0xFEFF) + JSON.stringify(['a.md', 'b.md']));
  const r = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledgerFile(dir, ['a.md', 'b.md']), '--include-from', inc]);
  assert.equal(r.exitCode, undefined, r.errs.join('\n'));
  assert.deepEqual(committed(git), ['a.md', 'b.md']);
});

test('a tracked file or a generated catalog that was dirty before op-begin is refused and then adopted the same way', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'index.md'), 'index v2, left dirty by something else\n');
  const token = await begin(dir);
  writeFileSync(join(dir, 'tracked.md'), 'tracked v2\n');
  const ledger = ledgerFile(dir, ['index.md', 'tracked.md']);
  const refused = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledger]);
  assert.equal(refused.exitCode, 1);
  assert.match(refused.errs.join('\n'), /index\.md/);
  assert.equal(readFileSync(join(dir, 'index.md'), 'utf8'), 'index v2, left dirty by something else\n', 'the file is untouched');
  const adopted = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledger, '--include', 'index.md']);
  assert.equal(adopted.exitCode, undefined, adopted.errs.join('\n'));
  assert.deepEqual(committed(git), ['index.md', 'tracked.md']);
});

test('a pre-existing dirty path that the ledger does not name is still left alone, and the commit still succeeds', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'theirs.md'), 'someone else is writing this\n');
  const token = await begin(dir);
  writeFileSync(join(dir, 'ours.md'), 'ours\n');
  const r = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledgerFile(dir, ['ours.md'])]);
  assert.equal(r.exitCode, undefined, r.errs.join('\n'));
  assert.deepEqual(committed(git), ['ours.md']);
  assert.ok(r.logs.some((l) => /left alone \(already dirty/.test(l)));
  assert.match(git('status', '--porcelain'), /\?\? theirs\.md/);
});

test('without a ledger nothing changes: pre-existing dirt is left alone and the commit succeeds', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'theirs.md'), 'x\n');
  const token = await begin(dir);
  writeFileSync(join(dir, 'ours.md'), 'ours\n');
  const r = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token]);
  assert.equal(r.exitCode, undefined);
  assert.deepEqual(committed(git), ['ours.md']);
});

test('--include may only name paths in the ledger, and needs a ledger', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'early.md'), 'x\n'); writeFileSync(join(dir, 'other.md'), 'y\n');
  const token = await begin(dir);
  const head = git('rev-parse', 'HEAD');
  const outside = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledgerFile(dir, ['early.md']), '--include', 'other.md']);
  assert.equal(outside.exitCode, 1);
  assert.match(outside.errs.join('\n'), /other\.md/);
  assert.match(outside.errs.join('\n'), /not in the ledger|only name paths in the ledger/);
  const bare = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--include', 'early.md']);
  assert.equal(bare.exitCode, 1);
  assert.match(bare.errs.join('\n'), /--paths-file/);
  const bad = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledgerFile(dir, ['early.md']), '--include', '../escape.md']);
  assert.equal(bad.exitCode, 1);
  assert.ok(tokenAlive(dir, token), 'every refusal keeps the token');
  assert.equal(git('rev-parse', 'HEAD'), head);
});

test('an --include path that is not dirty now adopts nothing and does not fail', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'early.md'), 'x\n');
  const token = await begin(dir);
  writeFileSync(join(dir, 'late.md'), 'y\n');
  const r = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledgerFile(dir, ['early.md', 'late.md', 'tracked.md']), '--include', 'tracked.md', '--include', 'early.md']);
  assert.equal(r.exitCode, undefined, r.errs.join('\n'));
  assert.deepEqual(committed(git), ['early.md', 'late.md']);
});

test('commitOp reports the refused paths as data, and the list is capped in the message but not in the result', async (t) => {
  const { dir } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const names = Array.from({ length: 25 }, (_, i) => `early-${String(i).padStart(2, '0')}.md`);
  for (const n of names) writeFileSync(join(dir, n), 'x\n');
  const token = await begin(dir);
  const r = commitOp(dir, { op: 'relink', title: 't', token, paths: names });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.deepEqual(r.preexisting, names);
  assert.match(r.reason, /25 path\(s\)/);
  assert.match(r.reason, /and 5 more/);
});

test('a ledger path that was dirty at open but is clean now (someone committed it) is not refused', async (t) => {
  const { dir, git } = tempRepo(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'early.md'), 'x\n');
  const token = await begin(dir);
  git('add', 'early.md');
  git('commit', '-q', '-m', 'another writer commits it');
  writeFileSync(join(dir, 'late.md'), 'y\n');
  const r = await run(commitMain, dir, ['--op', 'relink', '--title', 't', '--since', token, '--paths-file', ledgerFile(dir, ['early.md', 'late.md'])]);
  assert.equal(r.exitCode, undefined, r.errs.join('\n'));
  assert.deepEqual(committed(git), ['late.md']);
});
