import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as beginMain } from '../scripts/op-begin.mjs';
import { main as commitMain } from '../scripts/op-commit.mjs';

// A disposable git vault with the .gitignore every vault carries, so the token files under .wiki-master/ never count as dirt.
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-guard-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '.wiki-master/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  return dir;
}

async function run(fn, vaultPath, argv) {
  const prevVault = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = vaultPath;
  const logs = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => { logs.push(a.join(' ')); };
  console.error = (...a) => { errs.push(a.join(' ')); };
  process.exitCode = undefined;
  let exitCode;
  try {
    await fn(argv, {});
  } finally {
    exitCode = process.exitCode;
    process.exitCode = undefined;
    console.log = origLog;
    console.error = origErr;
    if (prevVault === undefined) delete process.env.WIKI_MASTER_VAULT;
    else process.env.WIKI_MASTER_VAULT = prevVault;
  }
  return { logs, errs, exitCode };
}

async function begin(vaultPath, op) {
  const r = await run(beginMain, vaultPath, ['--op', op]);
  assert.equal(r.exitCode, undefined, `op-begin should not fail: ${r.errs.join(' ')}`);
  return r.logs[0].trim();
}

const head = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
const committedFiles = (dir) => execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const tokenPath = (dir, token) => join(dir, '.wiki-master', 'ops', `${token}.json`);
const refusals = (dir) => {
  const file = join(dir, '.wiki-master', 'op-refusals.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

// Operations A and B are open; both have written a new file.
async function twoOpen() {
  const dir = tempRepo();
  const a = await begin(dir, 'ingest');
  const b = await begin(dir, 'relink');
  writeFileSync(join(dir, 'a-page.md'), 'written by A\n');
  writeFileSync(join(dir, 'b-page.md'), 'written by B\n');
  return { dir, a, b };
}

test('an unscoped close refuses while another operation is open, commits nothing and keeps the token', async () => {
  const { dir, a, b } = await twoOpen();
  try {
    const before = head(dir);
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 't', '--since', a]);
    assert.equal(r.exitCode, 1, `expected a refusal, got exit ${r.exitCode}; stdout: ${r.logs.join(' | ')}; committed: ${committedFiles(dir).join(', ')}`);
    const message = r.errs.join('\n');
    assert.match(message, /another operation is open/);
    assert.ok(message.includes(b), 'names the other operation token');
    assert.match(message, /op-ledger\.mjs show/);
    assert.equal(head(dir), before, 'no commit was made');
    assert.deepEqual(committedFiles(dir), ['.gitignore']);
    assert.ok(existsSync(tokenPath(dir, a)), 'the refused close keeps its token');
    assert.ok(existsSync(tokenPath(dir, b)), 'the other token is untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the guard message starts with the fixed sentence, names each other token with its operation, and the two scoping commands', async () => {
  const { dir, a, b } = await twoOpen();
  try {
    const c = await begin(dir, 'discover');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 't', '--since', a]);
    const message = r.errs.join('\n');
    assert.ok(message.startsWith('op-commit: this close has no --paths-file and another operation is open'), message);
    assert.ok(message.includes(`${b} (relink)`), message);
    assert.ok(message.includes(`${c} (discover)`), message);
    assert.ok(!message.includes(`${a} (`), 'the closing token is not listed as another');
    assert.match(message, /op-ledger\.mjs show/);
    assert.match(message, /--paths-file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a close with --paths-file naming only the closing operation file commits exactly that file and leaves the other dirty', async () => {
  const { dir, a, b } = await twoOpen();
  try {
    const scope = join(dir, '.wiki-master', 'scope.json');
    writeFileSync(scope, JSON.stringify(['a-page.md']));
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'a only', '--since', a, '--paths-file', scope]);
    assert.equal(r.exitCode, undefined, r.errs.join(' '));
    assert.deepEqual(committedFiles(dir), ['a-page.md']);
    assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }), /^\?\? b-page\.md$/m);
    assert.ok(!existsSync(tokenPath(dir, a)), 'the landed close removes its token');
    assert.ok(existsSync(tokenPath(dir, b)));
    assert.deepEqual(refusals(dir), [], 'a close that lands records nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('negative control: with no other operation open an unscoped close commits its delta', async () => {
  const dir = tempRepo();
  try {
    const a = await begin(dir, 'ingest');
    writeFileSync(join(dir, 'a-page.md'), 'written by A\n');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'alone', '--since', a]);
    assert.equal(r.exitCode, undefined, r.errs.join(' '));
    assert.deepEqual(committedFiles(dir), ['a-page.md']);
    assert.ok(!existsSync(tokenPath(dir, a)));
    assert.deepEqual(refusals(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a stale foreign token still counts as open', async () => {
  const dir = tempRepo();
  try {
    const a = await begin(dir, 'ingest');
    const old = 'abcdef0123456789';
    writeFileSync(tokenPath(dir, old), JSON.stringify({ op: 'relink', startedAt: '2020-01-01T00:00:00.000Z', dirty: [] }));
    writeFileSync(join(dir, 'a-page.md'), 'written by A\n');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 't', '--since', a]);
    assert.equal(r.exitCode, 1);
    assert.ok(r.errs.join('\n').includes(old));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
