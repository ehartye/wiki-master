import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isGitRepo, commitPaths, uncommittedElsewhere } from '../scripts/lib/git.mjs';

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-git-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

test('isGitRepo is true inside a repo and false outside one', () => {
  const repo = tempRepo();
  const plain = mkdtempSync(join(tmpdir(), 'wm-plain-'));
  try {
    assert.equal(isGitRepo(repo), true);
    assert.equal(isGitRepo(plain), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

// The bug this feature exists to fix: a working-tree change that never becomes a
// commit is not a change anything else can see. A purge stages a MOVE — a
// deletion at the original path and an addition under .recycle/ — and the bin's
// leading dot must not hide it from staging.
test('commitPaths stages a move, including into a dot-prefixed folder', () => {
  const repo = tempRepo();
  try {
    writeFileSync(join(repo, 'a.md'), 'hello\n');
    commitPaths(repo, ['a.md'], 'initial');
    mkdirSync(join(repo, '.recycle', 'id', 'wiki'), { recursive: true });
    writeFileSync(join(repo, '.recycle', 'id', 'wiki', 'a.md'), 'hello\n');
    rmSync(join(repo, 'a.md'));
    const r = commitPaths(repo, ['a.md', '.recycle/id/wiki/a.md'], 'purge: topic');
    assert.equal(r.committed, true);
    const files = execFileSync('git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' });
    assert.match(files, /a\.md/);
    assert.match(files, /\.recycle\/id\/wiki\/a\.md/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// The reason this is commitPaths and not commitAll. A vault with auto-commit
// disabled carries the user's in-progress work; a purge must not label it as
// part of the purge.
test('commitPaths leaves unrelated working-tree changes alone', () => {
  const repo = tempRepo();
  try {
    writeFileSync(join(repo, 'a.md'), 'hello\n');
    writeFileSync(join(repo, 'unrelated.md'), 'draft\n');
    commitPaths(repo, ['a.md', 'unrelated.md'], 'initial');
    writeFileSync(join(repo, 'unrelated.md'), 'draft, still being written\n');
    writeFileSync(join(repo, 'a.md'), 'purged\n');
    const r = commitPaths(repo, ['a.md'], 'purge: topic');
    assert.equal(r.committed, true);
    const files = execFileSync('git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' });
    assert.match(files, /a\.md/);
    assert.equal(/unrelated\.md/.test(files), false, 'the user\'s draft must not ride along');
    assert.deepEqual(uncommittedElsewhere(repo), ['unrelated.md']);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// Modeled on a real filename in the live vault. NTFS forbids " < > : \ | ? * in
// filenames, so no vault on Windows can contain a straight double quote — an
// earlier draft of this test used one and could not create its own fixture.
// Em-dash, ampersand and apostrophe are what actually occur, and a topic purge
// can move hundreds of such files; NUL-delimited stdin sidesteps both the
// quoting and the argv-length questions.
test('commitPaths handles filenames with spaces, em-dashes, ampersands and apostrophes', () => {
  const repo = tempRepo();
  try {
    const odd = "Weeks & Ruppanner — Typology of US Parents' Mental Loads.md";
    writeFileSync(join(repo, odd), 'x\n');
    const r = commitPaths(repo, [odd], 'add odd name');
    assert.equal(r.committed, true);
    assert.deepEqual(uncommittedElsewhere(repo), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// core.quotePath=false stops the octal escaping; the outer quote pair survives
// it, so uncommittedElsewhere must strip that too or a non-ASCII path comes back
// wrapped and never matches anything the caller compares it against.
test('uncommittedElsewhere does not mangle a non-ASCII filename', () => {
  const repo = tempRepo();
  try {
    writeFileSync(join(repo, 'seed.md'), 'x\n');
    commitPaths(repo, ['seed.md'], 'initial');
    const odd = 'Gottman — R is for Repair.md';
    writeFileSync(join(repo, odd), 'x\n');
    assert.deepEqual(uncommittedElsewhere(repo), [odd]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('commitPaths reports committed:false when the named paths are unchanged', () => {
  const repo = tempRepo();
  try {
    writeFileSync(join(repo, 'a.md'), 'hello\n');
    commitPaths(repo, ['a.md'], 'initial');
    assert.deepEqual(commitPaths(repo, ['a.md'], 'again'), { committed: false, reason: 'nothing to commit' });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('commitPaths refuses politely when the directory is not a repo', () => {
  const plain = mkdtempSync(join(tmpdir(), 'wm-plain-'));
  try {
    assert.deepEqual(commitPaths(plain, ['a.md'], 'x'), { committed: false, reason: 'not a git repository' });
    assert.deepEqual(uncommittedElsewhere(plain), []);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});
