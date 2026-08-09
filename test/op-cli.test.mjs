import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as beginMain } from '../scripts/op-begin.mjs';
import { main as commitMain } from '../scripts/op-commit.mjs';

// Mirrors test/git.test.mjs's tempRepo, plus the .gitignore every real
// wiki-master vault carries (scripts/init.mjs writes one): without it, the
// token file op-begin writes under .wiki-master/ops/ would itself show up as
// an untracked file and get swept into the very commit it exists to avoid
// polluting.
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-op-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '.wiki-master/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  return dir;
}

function tokenFiles(dir) {
  const opsDir = join(dir, '.wiki-master', 'ops');
  if (!existsSync(opsDir)) return [];
  return readdirSync(opsDir);
}

// Runs a script's main() against a temp vault, pointing WIKI_MASTER_VAULT at
// it (saved and restored), capturing console output and process.exitCode
// instead of letting either leak into the rest of the suite. Mirrors
// test/purge-apply.test.mjs's runMain.
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
    await fn(argv);
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
  assert.equal(r.logs.length, 1, 'op-begin prints exactly the token, nothing else');
  return r.logs[0].trim();
}

function committedFiles(dir) {
  return execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: dir, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}

// Test 1: the core claim.
test('an op commits exactly the files it touched', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'a.md'), 'new page\n');
    writeFileSync(join(dir, 'wiki', 'b.md'), 'another page\n');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'two pages', '--since', token]);
    assert.equal(r.exitCode, undefined);
    const files = committedFiles(dir);
    assert.deepEqual(files.sort(), ['wiki/a.md', 'wiki/b.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Test 2: the `git add -A` failure this exists to avoid. A file dirty before
// the op must not be swept into its commit, and must be reported so the user
// knows it is still theirs to deal with.
test('a file dirty before the op is not committed, and is reported', async () => {
  const dir = tempRepo();
  try {
    writeFileSync(join(dir, 'draft.md'), 'chapter one\n');
    execFileSync('git', ['add', 'draft.md'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'seed draft'], { cwd: dir });
    writeFileSync(join(dir, 'draft.md'), 'chapter one, still being written\n'); // dirty BEFORE op-begin

    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'a.md'), 'new page\n');

    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'one page', '--since', token]);
    assert.equal(r.exitCode, undefined);
    const files = committedFiles(dir);
    assert.deepEqual(files, ['wiki/a.md']);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    assert.match(status, /^ M draft\.md$/m, 'the pre-dirty file must remain uncommitted');
    assert.ok(r.logs.some((l) => l.includes('draft.md')), 'op-commit must report the file it left alone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Test 3: commit narrowing bit once already — even a file the user pre-staged
// (not merely dirty) must not ride along.
test('a file the user pre-staged is not committed', async () => {
  const dir = tempRepo();
  try {
    writeFileSync(join(dir, 'draft.md'), 'chapter one\n');
    execFileSync('git', ['add', 'draft.md'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'seed draft'], { cwd: dir });
    writeFileSync(join(dir, 'draft.md'), 'chapter one, revised\n');
    execFileSync('git', ['add', 'draft.md'], { cwd: dir }); // pre-staged before op-begin

    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'a.md'), 'new page\n');

    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'one page', '--since', token]);
    assert.equal(r.exitCode, undefined);
    const files = committedFiles(dir);
    assert.deepEqual(files, ['wiki/a.md']);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    assert.match(status, /^M {2}draft\.md$/m, 'the pre-staged file must remain staged, not committed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Test 4: no empty "ingest" commits.
test('an op that changed nothing creates no commit', async () => {
  const dir = tempRepo();
  try {
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const token = await begin(dir, 'ingest');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'nothing happened', '--since', token]);
    assert.equal(r.exitCode, undefined);
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(after, before, 'no commit should have been made');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Test 5: --pathspec-from-file atomicity bit once already — a new file that
// was never committed (untracked, then it appears) must commit fine on its
// own, not sink alongside a path that no longer resolves.
test('a never-committed new file commits fine', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
    writeFileSync(join(dir, 'raw', 'clippings', 'New.md'), 'clip\n');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'one clip', '--since', token]);
    assert.equal(r.exitCode, undefined);
    assert.deepEqual(committedFiles(dir), ['raw/clippings/New.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Test 6: an unbracketed op must not look successful.
test('a missing token fails loudly with exitCode 1', async () => {
  const dir = tempRepo();
  try {
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'x', '--since', 'no-such-token']);
    assert.equal(r.exitCode, 1);
    assert.ok(r.errs.length, 'must say something on stderr');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt token file fails loudly with exitCode 1', async () => {
  const dir = tempRepo();
  try {
    mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
    writeFileSync(join(dir, '.wiki-master', 'ops', 'bad.json'), 'not json{{{');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'x', '--since', 'bad']);
    assert.equal(r.exitCode, 1);
    assert.ok(r.errs.length, 'must say something on stderr');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Test 7: a vault need not be a git repo.
test('not a git repo produces a clear message and exits 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-op-plain-'));
  try {
    const token = await begin(dir, 'ingest');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'x', '--since', token]);
    assert.equal(r.exitCode, undefined);
    assert.ok(r.logs.some((l) => /not a git repository/i.test(l)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Test 8: no leaked scratch state.
test('the token file is deleted after a successful commit', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    assert.deepEqual(tokenFiles(dir), [`${token}.json`]);
    mkdirSync(join(dir, 'wiki'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'a.md'), 'new page\n');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'one page', '--since', token]);
    assert.equal(r.exitCode, undefined);
    assert.deepEqual(tokenFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
