import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// scripts/lib/git.mjs ran git with its stderr still attached to the parent while also capturing it, so a failed
// call printed git's message once raw and again inside the reason the caller built (wiki-sync's `reason:` line),
// and the raw copy could not be captured by a test. A failed call now reports git's message once, in the reason.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function repoWithoutUpstream(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-gitstderr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'T');
  writeFileSync(join(dir, 'f.md'), 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

// Runs a library call in a child process so the parent's real stderr can be observed.
function inChild(dir, body) {
  const script = join(dir, '..', `probe-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  writeFileSync(script, `import * as g from ${JSON.stringify(new URL('../scripts/lib/git.mjs', import.meta.url).href)};\nconst out = (${body})(${JSON.stringify(dir)}, g);\nconsole.log(JSON.stringify(out));\n`);
  try {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 60000, env });
  } finally { rmSync(script, { force: true }); }
}

test('a failed git call puts git\'s message in the reason and nothing on the process stderr', (t) => {
  const dir = repoWithoutUpstream(t);
  const r = inChild(dir, '(cwd, g) => g.push(cwd)'); // no remote at all: git push fails
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.pushed, false);
  assert.match(result.reason, /No configured push destination/, 'git\'s own message is in the reason');
  assert.equal(r.stderr, '', `git's stderr leaked to the parent:\n${r.stderr}`);
});

test("the reason carries git's message exactly once", (t) => {
  const dir = repoWithoutUpstream(t);
  const r = inChild(dir, '(cwd, g) => g.push(cwd)');
  const { reason } = JSON.parse(r.stdout);
  assert.equal((reason.match(/No configured push destination/g) ?? []).length, 1, reason);
});

test('a successful call, exit codes and the returned shapes are unchanged', (t) => {
  const dir = repoWithoutUpstream(t);
  const r = inChild(dir, '(cwd, g) => ({ repo: g.isGitRepo(cwd), up: g.upstreamOf(cwd), dirty: g.dirtyPaths(cwd), rebase: g.rebaseInProgress(cwd) })');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { repo: true, up: null, dirty: [], rebase: false });
  assert.equal(r.stderr, '');
});

test('a commit that git refuses reports the hook\'s message once and prints nothing itself', (t) => {
  const dir = repoWithoutUpstream(t);
  const hook = join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(dir, 'g.md'), 'y\n');
  const r = inChild(dir, '(cwd, g) => g.commitPaths(cwd, ["g.md"], "msg")');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.failed, true);
  assert.match(result.reason, /hook says no/);
  assert.equal(r.stderr, '', `hook output leaked to stderr:\n${r.stderr}`);
});
