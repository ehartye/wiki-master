import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { syncVault, main as syncMain } from '../scripts/wiki-sync.mjs';
import { obsidianGitAutoCommit } from '../scripts/lib/obsidian-git.mjs';

// Three machines share one vault through one remote. A bare repository plus
// clones of it is the same shape: each clone is a machine, `origin` is the remote.
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function machine(remote, name) {
  const dir = mkdtempSync(join(tmpdir(), `wm-sync-${name}-`));
  execFileSync('git', ['clone', '-q', remote, dir]);
  sh(dir, 'config', 'user.email', `${name}@example.com`);
  sh(dir, 'config', 'user.name', name);
  return dir;
}

function world() {
  const root = mkdtempSync(join(tmpdir(), 'wm-sync-root-'));
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const a = machine(remote, 'a');
  writeFileSync(join(a, '.gitignore'), '.wiki-master/\n');
  writeFileSync(join(a, 'shared.md'), 'one\ntwo\nthree\n');
  sh(a, 'add', '-A');
  sh(a, 'commit', '-q', '-m', 'initial');
  sh(a, 'push', '-q', '-u', 'origin', 'HEAD:main');
  sh(a, 'branch', '-q', '--set-upstream-to=origin/main');
  const b = machine(remote, 'b');
  return { root, remote, a, b, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function commitFile(dir, file, text, message = `edit ${file}`) {
  writeFileSync(join(dir, file), text);
  sh(dir, 'add', file);
  sh(dir, 'commit', '-q', '-m', message);
}

const remoteHead = (remote) => sh(remote, 'rev-parse', 'main');

test('already in sync: nothing pulled, nothing pushed, and it says so', async () => {
  const w = world();
  try {
    const r = await syncVault(w.a);
    assert.equal(r.ok, true);
    assert.equal(r.pulled, 0);
    assert.equal(r.pushed, 0);
    assert.equal(r.inSync, true);
  } finally { w.cleanup(); }
});

test('local commits are pushed and the upstream state is verified', async () => {
  const w = world();
  try {
    commitFile(w.a, 'one.md', 'a\n');
    commitFile(w.a, 'two.md', 'b\n');
    const r = await syncVault(w.a);
    assert.equal(r.ok, true);
    assert.equal(r.pushed, 2);
    assert.equal(r.inSync, true);
    assert.equal(remoteHead(w.remote), sh(w.a, 'rev-parse', 'HEAD'));
  } finally { w.cleanup(); }
});

test('commits made on another machine are pulled', async () => {
  const w = world();
  try {
    commitFile(w.b, 'from-b.md', 'b\n');
    sh(w.b, 'push', '-q');
    const r = await syncVault(w.a);
    assert.equal(r.ok, true);
    assert.equal(r.pulled, 1);
    assert.equal(r.pushed, 0);
    assert.ok(existsSync(join(w.a, 'from-b.md')));
  } finally { w.cleanup(); }
});

test('diverged work on different files is rebased, not merged, and both sides survive', async () => {
  const w = world();
  try {
    commitFile(w.b, 'from-b.md', 'b\n');
    sh(w.b, 'push', '-q');
    commitFile(w.a, 'from-a.md', 'a\n');
    const r = await syncVault(w.a);
    assert.equal(r.ok, true);
    assert.equal(r.pulled, 1);
    assert.equal(r.pushed, 1);
    assert.equal(r.inSync, true);
    assert.equal(sh(w.a, 'rev-list', '--merges', '--count', 'HEAD'), '0', 'no merge commit');
    assert.equal(remoteHead(w.remote), sh(w.a, 'rev-parse', 'HEAD'));
    assert.ok(existsSync(join(w.a, 'from-b.md')) && existsSync(join(w.a, 'from-a.md')));
  } finally { w.cleanup(); }
});

test('a conflict aborts the rebase, names the files, and loses nothing', async () => {
  const w = world();
  try {
    commitFile(w.b, 'shared.md', 'one\nTWO FROM B\nthree\n');
    sh(w.b, 'push', '-q');
    commitFile(w.a, 'shared.md', 'one\nTWO FROM A\nthree\n');
    const head = sh(w.a, 'rev-parse', 'HEAD');
    const r = await syncVault(w.a);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'conflict');
    assert.deepEqual(r.conflicts, ['shared.md']);
    assert.equal(sh(w.a, 'rev-parse', 'HEAD'), head, 'the local commit is still there');
    assert.equal(sh(w.a, 'status', '--porcelain'), '', 'no conflict markers left in the tree');
    assert.equal(existsSync(join(w.a, '.git', 'rebase-merge')) || existsSync(join(w.a, '.git', 'rebase-apply')), false);
    assert.notEqual(remoteHead(w.remote), head, 'nothing was pushed');
  } finally { w.cleanup(); }
});

test('an uncommitted edit to an unrelated file survives a pull', async () => {
  const w = world();
  try {
    commitFile(w.b, 'from-b.md', 'b\n');
    sh(w.b, 'push', '-q');
    writeFileSync(join(w.a, 'mine.md'), 'in progress\n');
    writeFileSync(join(w.a, 'shared.md'), 'one\ntwo\nthree\nlocal edit\n');
    const r = await syncVault(w.a);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(readFileSync(join(w.a, 'mine.md'), 'utf8'), 'in progress\n');
    assert.match(sh(w.a, 'status', '--porcelain'), /shared\.md/);
    assert.ok(existsSync(join(w.a, 'from-b.md')));
  } finally { w.cleanup(); }
});

test('an uncommitted edit that overlaps incoming changes stops before touching anything', async () => {
  const w = world();
  try {
    commitFile(w.b, 'shared.md', 'one\ntwo\nthree\nfrom b\n');
    sh(w.b, 'push', '-q');
    writeFileSync(join(w.a, 'shared.md'), 'one\ntwo\nthree\nunfinished work\n');
    const head = sh(w.a, 'rev-parse', 'HEAD');
    const r = await syncVault(w.a);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'overlap');
    assert.deepEqual(r.overlap, ['shared.md']);
    assert.equal(sh(w.a, 'rev-parse', 'HEAD'), head);
    assert.equal(readFileSync(join(w.a, 'shared.md'), 'utf8'), 'one\ntwo\nthree\nunfinished work\n');
    assert.equal(sh(w.a, 'stash', 'list'), '', 'no stash was created');
  } finally { w.cleanup(); }
});

test('a push that loses a race is retried once after another fetch and rebase', async () => {
  const w = world();
  try {
    const c = machine(w.remote, 'c');
    commitFile(w.a, 'from-a.md', 'a\n');
    let raced = 0;
    const r = await syncVault(w.a, {
      hooks: {
        beforePush() {
          if (raced++) return;
          commitFile(c, 'from-c.md', 'c\n');
          sh(c, 'push', '-q');
        },
      },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.retried, true);
    assert.equal(r.inSync, true);
    assert.equal(remoteHead(w.remote), sh(w.a, 'rev-parse', 'HEAD'));
    assert.ok(existsSync(join(w.a, 'from-c.md')));
  } finally { w.cleanup(); }
});

test('a push that keeps losing reports the rejection instead of looping', async () => {
  const w = world();
  try {
    const c = machine(w.remote, 'c');
    commitFile(w.a, 'from-a.md', 'a\n');
    let n = 0;
    const r = await syncVault(w.a, {
      hooks: {
        beforePush() {
          commitFile(c, `from-c-${n++}.md`, 'c\n');
          sh(c, 'pull', '-q', '--rebase');
          sh(c, 'push', '-q');
        },
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'push-rejected');
    assert.equal(n, 2, 'one attempt and one retry, no more');
  } finally { w.cleanup(); }
});

test('no upstream is reported, not guessed at', async () => {
  const w = world();
  try {
    sh(w.a, 'checkout', '-q', '-b', 'scratch');
    const r = await syncVault(w.a);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'no-upstream');
  } finally { w.cleanup(); }
});

test('a vault that is not a git repository is local-only, not a failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-sync-plain-'));
  try {
    const r = await syncVault(dir);
    assert.equal(r.ok, true);
    assert.equal(r.skipped, 'not a git repository');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unfinished rebase is not built on', async () => {
  const w = world();
  try {
    mkdirSync(join(w.a, '.git', 'rebase-merge'));
    const r = await syncVault(w.a);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'rebase-in-progress');
  } finally { w.cleanup(); }
});

function openOperation(dir, token = 'abcdef0123456789') {
  mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
  writeFileSync(join(dir, '.wiki-master', 'ops', `${token}.json`), JSON.stringify({ op: 'relink', dirty: [] }));
  return token;
}

test('open operations are reported, and a plain sync still proceeds', async () => {
  const w = world();
  try {
    const token = openOperation(w.a);
    commitFile(w.a, 'one.md', 'a\n');
    const r = await syncVault(w.a);
    assert.equal(r.ok, true);
    assert.deepEqual(r.openOperations, [token]);
    assert.equal(r.pushed, 1);
  } finally { w.cleanup(); }
});

test('--commit-local commits hand edits in one scoped commit, then syncs', async () => {
  const w = world();
  try {
    writeFileSync(join(w.a, 'hand-edit.md'), 'typed in Obsidian\n');
    mkdirSync(join(w.a, 'wiki'));
    writeFileSync(join(w.a, 'wiki', 'new.md'), 'new page\n');
    writeFileSync(join(w.a, 'shared.md'), 'one\ntwo\nthree\nedited\n');
    const r = await syncVault(w.a, { commitLocal: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([...r.committedLocal.paths].sort(), ['hand-edit.md', 'shared.md', 'wiki/new.md']);
    assert.match(sh(w.a, 'log', '-1', '--format=%s'), /^sync: local edits/);
    assert.equal(sh(w.a, 'status', '--porcelain'), '');
    assert.equal(r.pushed, 1);
    assert.equal(remoteHead(w.remote), sh(w.a, 'rev-parse', 'HEAD'));
  } finally { w.cleanup(); }
});

test('--commit-local with nothing dirty makes no commit', async () => {
  const w = world();
  try {
    const head = sh(w.a, 'rev-parse', 'HEAD');
    const r = await syncVault(w.a, { commitLocal: true });
    assert.equal(r.ok, true);
    assert.equal(r.committedLocal, null);
    assert.equal(sh(w.a, 'rev-parse', 'HEAD'), head);
  } finally { w.cleanup(); }
});

test('--commit-local refuses while an operation is open, because it cannot tell whose files are dirty', async () => {
  const w = world();
  try {
    openOperation(w.a);
    writeFileSync(join(w.a, 'in-flight.md'), 'an operation is writing this\n');
    const head = sh(w.a, 'rev-parse', 'HEAD');
    const r = await syncVault(w.a, { commitLocal: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'operation-open');
    assert.equal(sh(w.a, 'rev-parse', 'HEAD'), head);
    assert.match(sh(w.a, 'status', '--porcelain'), /in-flight\.md/);
  } finally { w.cleanup(); }
});

test('a held index lock on --commit-local fails loudly and leaves the files', async () => {
  const w = world();
  try {
    writeFileSync(join(w.a, 'hand-edit.md'), 'typed in Obsidian\n');
    writeFileSync(join(w.a, '.git', 'index.lock'), '');
    const r = await syncVault(w.a, { commitLocal: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'commit-failed');
    assert.match(r.reason, /index\.lock/);
    assert.ok(existsSync(join(w.a, 'hand-edit.md')));
  } finally { w.cleanup(); }
});

function writeObsidianGit(dir, settings) {
  const pluginDir = join(dir, '.obsidian', 'plugins', 'obsidian-git');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'data.json'), JSON.stringify(settings));
}

test('obsidianGitAutoCommit lists the settings that make the plugin commit or push on its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-og-'));
  try {
    assert.equal(obsidianGitAutoCommit(dir), null, 'no plugin, no finding');
    writeObsidianGit(dir, { autoSaveInterval: 10, autoBackupAfterFileChange: true, autoPushInterval: 0, autoPullInterval: 5 });
    assert.deepEqual(obsidianGitAutoCommit(dir).enabled.sort(), ['autoBackupAfterFileChange', 'autoSaveInterval']);
    writeObsidianGit(dir, { autoSaveInterval: 0, autoBackupAfterFileChange: false, autoPushInterval: 30 });
    assert.deepEqual(obsidianGitAutoCommit(dir).enabled, ['autoPushInterval']);
    writeObsidianGit(dir, { autoSaveInterval: 0, autoBackupAfterFileChange: false, autoPushInterval: 0, autoPullInterval: 5 });
    assert.deepEqual(obsidianGitAutoCommit(dir).enabled, [], 'pull-only is the supported configuration');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unreadable plugin config is treated as unknown, not as off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-og-'));
  try {
    const pluginDir = join(dir, '.obsidian', 'plugins', 'obsidian-git');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'data.json'), '{broken');
    const r = obsidianGitAutoCommit(dir);
    assert.equal(r.unreadable, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the sync result carries the plugin warning so the caller can show it', async () => {
  const w = world();
  try {
    writeObsidianGit(w.a, { autoSaveInterval: 10, autoBackupAfterFileChange: true });
    const r = await syncVault(w.a);
    assert.equal(r.ok, true);
    assert.deepEqual(r.obsidianGit.enabled.sort(), ['autoBackupAfterFileChange', 'autoSaveInterval']);
  } finally { w.cleanup(); }
});

async function runMain(dir, argv) {
  const prev = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = dir;
  const logs = [];
  const errs = [];
  const [origLog, origErr] = [console.log, console.error];
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  process.exitCode = undefined;
  try { await syncMain(argv); } finally {
    var exitCode = process.exitCode;
    process.exitCode = undefined;
    console.log = origLog;
    console.error = origErr;
    if (prev === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prev;
  }
  return { logs, errs, exitCode };
}

test('the CLI exits 0 and reports the verified state after a push', async () => {
  const w = world();
  try {
    commitFile(w.a, 'one.md', 'a\n');
    const r = await runMain(w.a, []);
    assert.equal(r.exitCode, undefined);
    assert.ok(r.logs.some(l => /pushed 1/.test(l)), r.logs.join('|'));
    assert.ok(r.logs.some(l => /in sync with origin\/main/.test(l)), r.logs.join('|'));
  } finally { w.cleanup(); }
});

test('the CLI exits 1 and names the conflicting files', async () => {
  const w = world();
  try {
    commitFile(w.b, 'shared.md', 'one\nTWO FROM B\nthree\n');
    sh(w.b, 'push', '-q');
    commitFile(w.a, 'shared.md', 'one\nTWO FROM A\nthree\n');
    const r = await runMain(w.a, []);
    assert.equal(r.exitCode, 1);
    assert.ok(r.errs.some(l => /conflict/i.test(l)) && r.errs.some(l => /shared\.md/.test(l)), r.errs.join('|'));
  } finally { w.cleanup(); }
});

test('the CLI warns about the plugin settings that make Obsidian Git commit on its own', async () => {
  const w = world();
  try {
    writeObsidianGit(w.a, { autoSaveInterval: 10, autoBackupAfterFileChange: true });
    const r = await runMain(w.a, []);
    assert.ok(r.logs.concat(r.errs).some(l => /autoBackupAfterFileChange/.test(l)), r.logs.join('|'));
  } finally { w.cleanup(); }
});

test('success is verified against the remote with a fresh fetch, not against our own push', async () => {
  const w = world();
  try {
    commitFile(w.a, 'from-a.md', 'a\n');
    // A push that reports success but never reached the remote.
    const r = await syncVault(w.a, { hooks: { pushImpl: () => ({ pushed: true }) } });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'not-in-sync');
  } finally { w.cleanup(); }
});

test('work another machine pushes right after ours is reported, not called a failure', async () => {
  const w = world();
  try {
    const c = machine(w.remote, 'c');
    commitFile(w.a, 'from-a.md', 'a\n');
    const r = await syncVault(w.a, {
      hooks: {
        afterPush() {
          sh(c, 'pull', '-q', '--rebase');
          commitFile(c, 'from-c.md', 'c\n');
          sh(c, 'push', '-q');
        },
      },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.pushed, 1);
    assert.equal(r.inSync, false);
    assert.equal(r.behindAfter, 1);
  } finally { w.cleanup(); }
});

function leakedOperation(dir, token, hoursAgo) {
  mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
  const startedAt = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  writeFileSync(join(dir, '.wiki-master', 'ops', `${token}.json`), JSON.stringify({ op: 'ingest', startedAt, dirty: [] }));
}

test('an old operation still blocks --commit-local until explicitly cleaned up', async () => {
  const w = world();
  try {
    leakedOperation(w.a, '069b07798a127734', 24 * 40);
    writeFileSync(join(w.a, 'hand-edit.md'), 'typed in Obsidian\n');
    const r = await syncVault(w.a, { commitLocal: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'operation-open');
    assert.deepEqual(r.staleOperations, ['069b07798a127734']);
    assert.deepEqual(r.openOperations, ['069b07798a127734']);
  } finally { w.cleanup(); }
});

test('a recent operation still blocks --commit-local even when a stale one is also lying around', async () => {
  const w = world();
  try {
    leakedOperation(w.a, '069b07798a127734', 24 * 40);
    leakedOperation(w.a, 'fbb32b3279c474d7', 2);
    writeFileSync(join(w.a, 'in-flight.md'), 'being written\n');
    const r = await syncVault(w.a, { commitLocal: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'operation-open');
    assert.deepEqual(r.openOperations, ['069b07798a127734', 'fbb32b3279c474d7']);
  } finally { w.cleanup(); }
});

test('the staleness cut-off is configurable and an unparsable start time falls back to the file time', async () => {
  const w = world();
  try {
    leakedOperation(w.a, 'aaaaaaaaaaaaaaaa', 5);
    mkdirSync(join(w.a, '.wiki-master', 'ops'), { recursive: true });
    writeFileSync(join(w.a, '.wiki-master', 'ops', 'bbbbbbbbbbbbbbbb.json'), '{broken');
    const r = await syncVault(w.a, { staleOperationHours: 4 });
    assert.deepEqual(r.staleOperations, ['aaaaaaaaaaaaaaaa']);
    assert.deepEqual(r.openOperations, ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'], 'all extant tokens count as open');
  } finally { w.cleanup(); }
});

test('the CLI names abandoned operation tokens so they can be cleaned up', async () => {
  const w = world();
  try {
    leakedOperation(w.a, '069b07798a127734', 24 * 40);
    const r = await runMain(w.a, []);
    assert.ok(r.logs.some(l => /abandoned/.test(l) && /069b07798a127734/.test(l)), r.logs.join('|'));
  } finally { w.cleanup(); }
});
