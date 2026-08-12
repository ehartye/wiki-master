import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main as beginMain } from '../scripts/op-begin.mjs';
import { main as commitMain, commitOp } from '../scripts/op-commit.mjs';

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
async function run(fn, vaultPath, argv, deps) {
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
    await fn(argv, deps);
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

// A hard-wrapped wikilink freshly introduced by the files this operation commits is
// reported at commit time, not just whenever someone later happens to run
// /wiki-health -- but never blocks the commit itself: op-commit has no existing
// "fail the commit" contract to extend safely, so this is visibility, matching
// health.mjs's own reporting-not-blocking convention.
test('commitOp reports a hard-wrapped wikilink among the files it just committed, but still commits', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki', 'concepts'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'concepts', 'citer.md'),
      '---\ntype: concept\nsources: []\n---\n# Citer\n\nSee [[Some\nThing]] for details.\n');
    const r = commitOp(dir, { op: 'ingest', title: 'one page', token });
    assert.equal(r.committed, true, 'the commit itself is never blocked');
    assert.deepEqual(r.wrappedLinks, [{ page: 'wiki/concepts/citer.md', target: 'Some\nThing' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commitOp reports no wrapped-link warnings for an ordinary commit', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki', 'concepts'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'concepts', 'citer.md'),
      '---\ntype: concept\nsources: []\n---\n# Citer\n\nSee [[Some Thing]] for details.\n');
    const r = commitOp(dir, { op: 'ingest', title: 'one page', token });
    assert.deepEqual(r.wrappedLinks, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a raw/ clipping that happens to contain a wrapped-looking span is never flagged — not scored content', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
    writeFileSync(join(dir, 'raw', 'clippings', 'weird.md'), 'Clipped text mentioning [[Some\nThing]] verbatim.\n');
    const r = commitOp(dir, { op: 'ingest', title: 'one clip', token });
    assert.deepEqual(r.wrappedLinks, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deleted file in the operation\'s diff does not crash the wrapped-link scan', async () => {
  const dir = tempRepo();
  mkdirSync(join(dir, 'wiki'), { recursive: true });
  writeFileSync(join(dir, 'wiki', 'gone.md'), 'bye\n');
  execFileSync('git', ['add', 'wiki/gone.md'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'add gone.md'], { cwd: dir });
  try {
    const token = await begin(dir, 'purge');
    rmSync(join(dir, 'wiki', 'gone.md'));
    const r = commitOp(dir, { op: 'purge', title: 'removed a page', token });
    assert.equal(r.committed, true);
    assert.deepEqual(r.wrappedLinks, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// End-to-end: the same warning is visible on the console a user/agent actually sees
// after running the real CLI, not just in commitOp's structured return value.
test('commitMain prints the wrapped-link warning after a successful commit', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki', 'concepts'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'concepts', 'citer.md'),
      '---\ntype: concept\nsources: []\n---\n# Citer\n\nSee [[Some\nThing]] for details.\n');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'one page', '--since', token]);
    assert.equal(r.exitCode, undefined);
    assert.ok(r.logs.some((l) => l.includes('hard-wrapped wikilink') && l.includes('repair-wrapped-links.mjs')));
    assert.ok(r.logs.some((l) => l.includes('wiki/concepts/citer.md')));
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

// The token is joined into a path and unlinkSync runs on it, so a `../` token
// would read and DELETE outside .wiki-master/ops/. op-begin only emits hex, but
// op-commit is invoked from skill markdown where an agent assembles the command
// line — the shape is checked rather than assumed.
test('a malformed token is refused before it reaches the filesystem', async () => {
  const dir = tempRepo();
  try {
    const victim = join(dir, 'important.md');
    writeFileSync(victim, 'do not delete me\n');
    execFileSync('git', ['add', 'important.md'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir });

    for (const bad of ['../../important', 'not-hex', '', 'abc/../../x']) {
      const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 't', '--since', bad]);
      assert.equal(r.exitCode, 1, `token ${JSON.stringify(bad)} must be refused`);
      assert.match(r.errs.join(' '), /malformed operation token|usage:/);
    }
    assert.equal(existsSync(victim), true, 'no traversal token may delete a file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- keeping the semantic index current -------------------------------------
//
// op-commit is the one place every mutating operation passes through, so it
// is where the index gets refreshed. The whole feature is advisory: it runs
// AFTER the commit has landed and must never be able to affect it. These
// tests are about that guarantee, not about embedding — planAutoRefresh's own
// decision table lives in test/auto-refresh.test.mjs.

// Deps that make the index look built and Ollama look healthy, so the refresh
// path is actually entered without a live Ollama anywhere near the suite.
function refreshDeps({ refreshImpl }) {
  return {
    readManifestImpl: () => ({ 'wiki/a.md': { chunks: [] } }),
    isAvailableImpl: async () => true,
    modelPresentImpl: async () => true,
    refreshImpl,
  };
}

test('a refresh that throws leaves the commit intact and the exit code clean', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'a.md'), 'new page\n');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'one page', '--since', token],
      refreshDeps({ refreshImpl: async () => { throw new Error('ollama died mid-embed'); } }));

    // The guarantee: the operation's own work is committed and reported as
    // success. A stale index is a smaller problem than an operation that
    // claims failure over work that actually landed.
    assert.equal(r.exitCode, undefined, 'a failed index refresh must not fail the commit');
    assert.deepEqual(committedFiles(dir), ['wiki/a.md']);
    assert.ok(r.logs.some((l) => /committed/.test(l)), 'the commit is still reported');
    // ...but it is never silent. A silently stale index is exactly the
    // failure mode 0.11.0 exists to prevent.
    assert.match(r.logs.concat(r.errs).join('\n'), /ollama died mid-embed/,
      'the refresh failure must still be surfaced');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a vault with no index is told how to build one, and no build is attempted', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'a.md'), 'new page\n');
    let attempted = false;
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'one page', '--since', token], {
      readManifestImpl: () => ({}),
      refreshImpl: async () => { attempted = true; return {}; },
    });
    assert.equal(r.exitCode, undefined);
    assert.equal(attempted, false, 'a cold build must never start as a side effect of a commit');
    assert.match(r.logs.concat(r.errs).join('\n'), /index-embed\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a successful refresh reports what it did', async () => {
  const dir = tempRepo();
  try {
    const token = await begin(dir, 'ingest');
    mkdirSync(join(dir, 'wiki'), { recursive: true });
    writeFileSync(join(dir, 'wiki', 'a.md'), 'new page\n');
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'one page', '--since', token],
      refreshDeps({
        refreshImpl: async () => ({
          filesChanged: 2, chunksEmbedded: 7, chunksPruned: 1, chunksTotal: 5518, elapsedMs: 210,
        }),
      }));
    assert.equal(r.exitCode, undefined);
    const out = r.logs.concat(r.errs).join('\n');
    assert.match(out, /2 file/);
    assert.match(out, /7 chunk/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A vault that isn't a git repo still has an index that goes stale. The
// refresh is keyed to the operation having run, not to a commit having
// landed — commitOp returns early for a non-repo vault, so this is the case
// most likely to get skipped by accident.
test('a non-git vault still refreshes its index', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-op-plain-idx-'));
  try {
    const token = await begin(dir, 'ingest');
    let attempted = false;
    const r = await run(commitMain, dir, ['--op', 'ingest', '--title', 'x', '--since', token],
      refreshDeps({ refreshImpl: async () => { attempted = true; return { filesChanged: 0, chunksEmbedded: 0, chunksPruned: 0, chunksTotal: 3, elapsedMs: 12 }; } }));
    assert.equal(r.exitCode, undefined);
    assert.equal(attempted, true, 'an index outside a git repo goes stale like any other');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
