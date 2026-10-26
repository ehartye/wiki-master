import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { syncVault, main as syncMain } from '../scripts/wiki-sync.mjs';
import { rebaseOntoUpstream, rebaseInProgress } from '../scripts/lib/git.mjs';
import { world, commitFile, sh, remoteHead } from './helpers/sync-world.mjs';

// A transient git index lock can stop `git rebase --autostash` before it starts. wiki-sync used to read every failed
// rebase as a content conflict: it listed no files ("unknown files"), tried to abort a rebase that had never begun
// ("the abort failed") and sent the agent toward a conflict recovery that did not apply. Whether a rebase started is
// repository state, so it is read from there, and a rebase that never started is reported as `rebase-failed`.

const lock = (dir) => join(dir, '.git', 'index.lock');
const NL = String.fromCharCode(10);
const threeLines = (mid) => ['one', mid, 'three', ''].join(NL);

// Machine b pushes a commit, machine a has a local commit (and optionally an uncommitted edit), and a's index is locked.
function lockedWorld({ dirty }) {
  const w = world();
  commitFile(w.b, 'from-b.md', 'b\n');
  sh(w.b, 'push', '-q');
  commitFile(w.a, 'from-a.md', 'a\n');
  if (dirty) writeFileSync(join(w.a, 'shared.md'), 'one\ntwo\nthree\nlocal edit\n');
  writeFileSync(lock(w.a), '');
  return w;
}

for (const dirty of [true, false]) {
  test(`a held index lock (${dirty ? 'dirty' : 'clean'} tree) is rebase-failed, not a conflict, and changes nothing`, async () => {
    const w = lockedWorld({ dirty });
    try {
      const head = sh(w.a, 'rev-parse', 'HEAD');
      const remoteBefore = remoteHead(w.remote);
      const r = await syncVault(w.a);
      assert.equal(r.ok, false);
      assert.equal(r.code, 'rebase-failed');
      assert.equal(r.phase, 'rebase');
      assert.match(r.stderr, /index\.lock/);
      assert.match(r.reason, /rebase/i);
      assert.match(r.reason, /index\.lock/);
      assert.doesNotMatch(r.reason, /abort failed|conflicts in|unknown files/);
      assert.deepEqual(r.conflicts ?? [], []);
      assert.equal(sh(w.a, 'rev-parse', 'HEAD'), head, 'HEAD is unchanged');
      assert.equal(remoteHead(w.remote), remoteBefore, 'nothing was pushed');
      assert.equal(rebaseInProgress(w.a), false);
      assert.ok(existsSync(lock(w.a)), 'the lock is not deleted');
      if (dirty) assert.equal(readFileSync(join(w.a, 'shared.md'), 'utf8'), 'one\ntwo\nthree\nlocal edit\n', 'the uncommitted edit is exactly as it was');
      assert.equal(sh(w.a, 'stash', 'list'), '', 'no stash was left behind');
    } finally { w.cleanup(); }
  });
}

test('after the lock goes away, the next sync pulls, pushes and verifies, and the edit survives', async () => {
  const w = lockedWorld({ dirty: true });
  try {
    assert.equal((await syncVault(w.a)).code, 'rebase-failed');
    rmSync(lock(w.a)); // the fixture removes its own lock; no code under test does
    const again = await syncVault(w.a);
    assert.equal(again.ok, true, again.reason);
    assert.equal(again.pulled, 1);
    assert.equal(again.pushed, 1);
    assert.equal(again.inSync, true);
    assert.equal(remoteHead(w.remote), sh(w.a, 'rev-parse', 'HEAD'));
    assert.match(sh(w.a, 'status', '--porcelain'), /M shared\.md/, 'the edit is still an uncommitted change');
    assert.equal(sh(w.a, 'stash', 'list'), '');
  } finally { w.cleanup(); }
});

test('a real content conflict is unchanged: the rebase starts, is aborted, and the files are listed', () => {
  const w = world();
  try {
    commitFile(w.b, 'shared.md', threeLines('B'));
    sh(w.b, 'push', '-q');
    commitFile(w.a, 'shared.md', threeLines('A'));
    sh(w.a, 'fetch', '-q');
    const r = rebaseOntoUpstream(w.a);
    assert.deepEqual([r.ok, r.started, r.aborted, r.conflicts], [false, true, true, ['shared.md']]);
  } finally { w.cleanup(); }
});

test('syncVault reports the conflict code with the file and the abort, and not rebase-failed', async () => {
  const w = world();
  try {
    commitFile(w.b, 'shared.md', 'one\nB\nthree\n');
    sh(w.b, 'push', '-q');
    commitFile(w.a, 'shared.md', 'one\nA\nthree\n');
    const r = await syncVault(w.a);
    assert.equal(r.code, 'conflict');
    assert.match(r.reason, /conflicts in shared\.md; the rebase was aborted/);
    assert.deepEqual(r.conflicts, ['shared.md']);
    assert.equal(r.started, undefined, 'the sync result does not carry started');
    assert.equal(rebaseInProgress(w.a), false);
  } finally { w.cleanup(); }
});

test('rebaseOntoUpstream under a lock, and with no upstream, returns the non-start shape and touches nothing', () => {
  const w = lockedWorld({ dirty: true });
  try {
    sh(w.a, 'fetch', '-q');
    const head = sh(w.a, 'rev-parse', 'HEAD');
    const r = rebaseOntoUpstream(w.a);
    assert.deepEqual([r.ok, r.started, r.conflicts, r.aborted], [false, false, [], false]);
    assert.match(r.reason, /index\.lock/);
    assert.equal(sh(w.a, 'rev-parse', 'HEAD'), head);
    rmSync(lock(w.a));
    sh(w.a, 'branch', '--unset-upstream');
    const none = rebaseOntoUpstream(w.a);
    assert.deepEqual([none.ok, none.started, none.conflicts, none.aborted], [false, false, [], false]);
  } finally { w.cleanup(); }
});

test('the reason quotes git\'s lines joined with " | ", capped at 400 characters, and says never to delete a lock', async () => {
  const w = world();
  try {
    commitFile(w.b, 'x.md', 'x\n'); sh(w.b, 'push', '-q');
    const long = ['fatal: first line', '', 'second line', 'z'.repeat(600)].join('\n');
    const r = await syncVault(w.a, { hooks: { rebaseImpl: () => ({ ok: false, started: false, conflicts: [], aborted: false, reason: long }) } });
    assert.equal(r.code, 'rebase-failed');
    const quoted = r.reason.match(/rebase[^:]*: (.*?)\. If another process/s)?.[1];
    assert.ok(quoted, r.reason);
    assert.ok(quoted.startsWith('fatal: first line | second line | zzz'), quoted);
    assert.equal(quoted.length, 400);
    assert.ok(quoted.endsWith('...'));
    assert.match(r.reason, /never delete a Git lock/i);
    assert.equal(r.stderr, long, 'the whole stderr stays on the result');
  } finally { w.cleanup(); }
});

test('a started rebase whose abort failed is still the conflict code, with "abort failed" and "unknown files"', async () => {
  const w = world();
  try {
    commitFile(w.b, 'x.md', 'x\n'); sh(w.b, 'push', '-q');
    const r = await syncVault(w.a, { hooks: { rebaseImpl: () => ({ ok: false, started: true, conflicts: [], aborted: false, reason: 'boom' }) } });
    assert.equal(r.code, 'conflict');
    assert.match(r.reason, /unknown files/);
    assert.match(r.reason, /abort failed/);
    const oldShape = await syncVault(w.a, { hooks: { rebaseImpl: () => ({ ok: false, conflicts: ['shared.md'], aborted: true, reason: 'boom' }) } });
    assert.equal(oldShape.code, 'conflict', 'a result without `started` is read as a started rebase');
  } finally { w.cleanup(); }
});

test('the CLI exits 1 with one error line that names the lock and the rebase, not a conflict', async () => {
  const w = lockedWorld({ dirty: false });
  const prevVault = process.env.WIKI_MASTER_VAULT;
  const { log, error } = console;
  const errs = []; const logs = [];
  console.error = (...a) => errs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' '));
  process.env.WIKI_MASTER_VAULT = w.a;
  process.exitCode = undefined;
  try {
    await syncMain([]);
    assert.equal(process.exitCode, 1);
    const text = errs.join('\n');
    assert.match(text, /index\.lock/);
    assert.match(text, /rebase/i);
    assert.doesNotMatch(text, /abort failed|conflicts in/);
  } finally {
    process.exitCode = undefined;
    console.error = error; console.log = log;
    if (prevVault === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prevVault;
    w.cleanup();
  }
});

test('the failure reports the lock file\'s age so a stale lock can be told from a live one', async () => {
  const w = lockedWorld({ dirty: false });
  try {
    const r = await syncVault(w.a);
    assert.equal(r.code, 'rebase-failed');
    assert.equal(typeof r.lockAgeSeconds, 'number');
    assert.ok(r.lockAgeSeconds >= 0 && r.lockAgeSeconds < 120);
    assert.match(r.reason, /index\.lock is \d+ s old/);
  } finally { w.cleanup(); }
});
