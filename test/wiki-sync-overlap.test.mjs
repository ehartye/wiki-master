import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { beginOp } from '../scripts/op-begin.mjs';
import { recordWritten } from '../scripts/lib/op-ledger.mjs';
import { refusalsFile } from '../scripts/lib/op-refusals.mjs';

// A sync that refuses because uncommitted edits overlap incoming changes says which open operation recorded the edited files,
// says not to reset, check out, stash or delete what you did not write, exits 3, changes nothing and leaves a counts-only
// line in the refusal record. Every case runs the real command line as a child process (the exit code is the thing under
// test) against a bare remote and clones in a temp directory. The real vault is never touched.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// `a` is the vault under test, `b` another machine that pushes the upstream change.
function world() {
  const root = mkdtempSync(join(tmpdir(), 'wm-overlap-root-'));
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const clone = (name) => {
    const dir = mkdtempSync(join(root, `${name}-`));
    execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', remote, dir], { stdio: ['ignore', 'pipe', 'ignore'] });
    sh(dir, 'config', 'user.email', `${name}@example.com`);
    sh(dir, 'config', 'user.name', name);
    return dir;
  };
  const a = clone('a');
  writeFileSync(join(a, '.gitignore'), '.wiki-master/\n');
  writeFileSync(join(a, 'index.md'), 'one\ntwo\n');
  writeFileSync(join(a, 'clean.md'), 'clean\n');
  writeFileSync(join(a, 'shared.md'), 'one\ntwo\nthree\n');
  sh(a, 'add', '-A');
  sh(a, 'commit', '-q', '-m', 'initial');
  sh(a, 'push', '-q', '-u', 'origin', 'HEAD:main');
  sh(a, 'branch', '-q', '--set-upstream-to=origin/main');
  const b = clone('b');
  return { root, remote, a, b, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const upstreamEdit = (w, file, text) => {
  writeFileSync(join(w.b, file), text);
  sh(w.b, 'add', file);
  sh(w.b, 'commit', '-q', '-m', `edit ${file}`);
  sh(w.b, 'push', '-q');
};
const DIRTY = 'one\ntwo\nunfinished work\n';
const dirtyIndex = (w) => writeFileSync(join(w.a, 'index.md'), DIRTY);
const tokenFile = (dir, token) => join(dir, '.wiki-master', 'ops', `${token}.json`);
const syncCli = (dir, ...argv) => spawnSync(process.execPath, [join(SCRIPTS, 'wiki-sync.mjs'), ...argv], {
  cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, WIKI_MASTER_VAULT: dir, WIKI_MASTER_BROWSER: '/no/such/browser' },
});
const records = (dir) => (existsSync(refusalsFile(dir)) && statSync(refusalsFile(dir)).isFile()
  ? readFileSync(refusalsFile(dir), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// The criterion 1 fixture: upstream changed index.md, the local index.md is dirty, and an open operation recorded it.
function refusedWithRecordingOperation() {
  const w = world();
  const token = beginOp(w.a, 'ingest');
  dirtyIndex(w);
  recordWritten(w.a, token, ['index.md']);
  upstreamEdit(w, 'index.md', 'one\ntwo\nfrom b\n');
  return { w, token };
}

test('the refusal exits 3 and names the file, the operation that recorded it, the prohibition and the wait', () => {
  const { w, token } = refusedWithRecordingOperation();
  try {
    const head = sh(w.a, 'rev-parse', 'HEAD');
    const remoteBefore = sh(w.remote, 'rev-parse', 'main');
    const r = syncCli(w.a);
    assert.equal(r.status, 3, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^wiki-sync: uncommitted edits overlap incoming changes in index\.md$/m);
    assert.match(r.stderr, new RegExp(`^index\\.md: recorded by operation ${token} \\(ingest\\)$`, 'm'));
    assert.match(r.stderr, new RegExp(`^Open operations: ${token} \\(ingest\\)$`, 'm'));
    assert.match(r.stderr, new RegExp(`^If you wrote these edits, finish your operation \\(wiki-sync\\.mjs --op ${token}\\) and sync again\\.$`, 'm'));
    assert.match(r.stderr, /^If you did not, leave them exactly as they are: do not reset, checkout, stash or delete them\. Wait for their owner to close the operation, then sync again\.$/m);
    assert.doesNotMatch(r.stderr, /commit them \(or finish the operation\)/, 'the advice that invited the workaround is gone');
    assert.equal(sh(w.a, 'rev-parse', 'HEAD'), head, 'HEAD unchanged');
    assert.equal(sh(w.a, 'stash', 'list'), '', 'no stash');
    assert.equal(readFileSync(join(w.a, 'index.md'), 'utf8'), DIRTY, 'the file keeps its bytes');
    assert.ok(existsSync(tokenFile(w.a, token)), 'the open token is untouched');
    assert.equal(sh(w.remote, 'rev-parse', 'main'), remoteBefore, 'nothing was pushed');
  } finally { w.cleanup(); }
});

test('an overlapping file no open operation recorded says so, and the open operations are still listed', () => {
  const w = world();
  try {
    const token = beginOp(w.a, 'relink');
    dirtyIndex(w);
    upstreamEdit(w, 'index.md', 'one\ntwo\nfrom b\n');
    const r = syncCli(w.a);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /^index\.md: not recorded by any open operation$/m);
    assert.doesNotMatch(r.stderr, /recorded by operation/);
    assert.match(r.stderr, new RegExp(`^Open operations: ${token} \\(relink\\)$`, 'm'));
    assert.match(r.stderr, /do not reset, checkout, stash or delete them/);
    assert.ok(existsSync(tokenFile(w.a, token)));
  } finally { w.cleanup(); }
});

test('a file is attributed only to the operation whose ledger names it; a ledger entry for a file that is not dirty attributes nothing', () => {
  const w = world();
  try {
    const owner = beginOp(w.a, 'ingest');
    const bystander = beginOp(w.a, 'relink');
    dirtyIndex(w);
    recordWritten(w.a, owner, ['index.md']);
    recordWritten(w.a, bystander, ['clean.md']); // recorded, but the file is not dirty
    upstreamEdit(w, 'index.md', 'one\ntwo\nfrom b\n');
    const r = syncCli(w.a);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, new RegExp(`^index\\.md: recorded by operation ${owner} \\(ingest\\)$`, 'm'));
    assert.doesNotMatch(r.stderr, new RegExp(`recorded by operation[^\\n]*${bystander}`), 'the bystander recorded nothing that is dirty');
    assert.doesNotMatch(r.stderr, /clean\.md/);
    const listed = r.stderr.split(/\r?\n/).find((l) => l.startsWith('Open operations: '));
    assert.deepEqual(listed.slice('Open operations: '.length).split(', ').sort(), [`${owner} (ingest)`, `${bystander} (relink)`].sort(), 'every open operation is listed, owner or not');
  } finally { w.cleanup(); }
});

test('an operation whose only recorded file is clean attributes nothing to an overlapping hand edit', () => {
  const w = world();
  try {
    const token = beginOp(w.a, 'ingest');
    recordWritten(w.a, token, ['clean.md']);
    dirtyIndex(w);
    upstreamEdit(w, 'index.md', 'one\ntwo\nfrom b\n');
    const r = syncCli(w.a);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /^index\.md: not recorded by any open operation$/m);
    assert.doesNotMatch(r.stderr, /clean\.md/);
  } finally { w.cleanup(); }
});

test('several overlapping files each get their own line', () => {
  const w = world();
  try {
    const token = beginOp(w.a, 'ingest');
    dirtyIndex(w);
    writeFileSync(join(w.a, 'shared.md'), 'one\ntwo\nthree\nlocal\n');
    recordWritten(w.a, token, ['index.md']);
    writeFileSync(join(w.b, 'shared.md'), 'one\ntwo\nthree\nremote\n');
    sh(w.b, 'add', 'shared.md');
    sh(w.b, 'commit', '-q', '-m', 'edit shared');
    upstreamEdit(w, 'index.md', 'one\ntwo\nfrom b\n');
    const r = syncCli(w.a);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /^wiki-sync: uncommitted edits overlap incoming changes in index\.md, shared\.md$/m);
    assert.match(r.stderr, new RegExp(`^index\\.md: recorded by operation ${token} \\(ingest\\)$`, 'm'));
    assert.match(r.stderr, /^shared\.md: not recorded by any open operation$/m);
  } finally { w.cleanup(); }
});

test('with no operation open the original advice stays, and the refusal still exits 3', () => {
  const w = world();
  try {
    dirtyIndex(w);
    upstreamEdit(w, 'index.md', 'one\ntwo\nfrom b\n');
    const head = sh(w.a, 'rev-parse', 'HEAD');
    const r = syncCli(w.a);
    assert.equal(r.status, 3, r.stderr);
    assert.ok(r.stderr.trimEnd().endsWith('commit them (or finish the operation) and sync again'), r.stderr);
    assert.match(r.stderr, /uncommitted edits overlap incoming changes in index\.md/);
    assert.doesNotMatch(r.stderr, /Open operations:/);
    assert.doesNotMatch(r.stderr, /do not reset/);
    assert.equal(sh(w.a, 'rev-parse', 'HEAD'), head);
    assert.equal(readFileSync(join(w.a, 'index.md'), 'utf8'), DIRTY);
  } finally { w.cleanup(); }
});

test('exit 3 belongs to this refusal only: a clean sync exits 0 and pushes, a conflicting rebase and a rejected push exit 1', () => {
  // No overlap: a different file is dirty, the sync pulls, pushes the local commit and exits 0, leaving the edit alone.
  const ok = world();
  try {
    const token = beginOp(ok.a, 'ingest');
    writeFileSync(join(ok.a, 'draft.md'), 'draft\n');
    recordWritten(ok.a, token, ['draft.md']);
    upstreamEdit(ok, 'index.md', 'one\ntwo\nfrom b\n');
    writeFileSync(join(ok.a, 'mine.md'), 'mine\n');
    sh(ok.a, 'add', 'mine.md');
    sh(ok.a, 'commit', '-q', '-m', 'local');
    const r = syncCli(ok.a);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(sh(ok.remote, 'rev-parse', 'main'), sh(ok.a, 'rev-parse', 'HEAD'), 'the local commit was pushed');
    assert.equal(readFileSync(join(ok.a, 'draft.md'), 'utf8'), 'draft\n');
    assert.deepEqual(records(ok.a), [], 'a sync that is not refused records nothing');
  } finally { ok.cleanup(); }

  // A committed local change that conflicts with the upstream one: the rebase conflicts, nothing is dirty, exit 1.
  const conflict = world();
  try {
    upstreamEdit(conflict, 'shared.md', 'one\ntwo\nremote\n');
    writeFileSync(join(conflict.a, 'shared.md'), 'one\ntwo\nlocal\n');
    sh(conflict.a, 'add', 'shared.md');
    sh(conflict.a, 'commit', '-q', '-m', 'local edit');
    const r = syncCli(conflict.a);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /conflicts in shared\.md/);
    assert.deepEqual(records(conflict.a), [], 'a conflict is not an overlap refusal');
  } finally { conflict.cleanup(); }

  // The remote refuses the push: exit 1.
  const rejected = world();
  try {
    const hook = join(rejected.remote, 'hooks', 'pre-receive');
    mkdirSync(dirname(hook), { recursive: true });
    writeFileSync(hook, '#!/bin/sh\necho refused by the remote >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    writeFileSync(join(rejected.a, 'mine.md'), 'mine\n');
    sh(rejected.a, 'add', 'mine.md');
    sh(rejected.a, 'commit', '-q', '-m', 'local');
    const r = syncCli(rejected.a);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /uncommitted edits overlap/);
    assert.deepEqual(records(rejected.a), []);
  } finally { rejected.cleanup(); }
});

test('the refusal leaves one counts-only line in the record, and health shows it in both forms', () => {
  const { w, token } = refusedWithRecordingOperation();
  try {
    const health = (...args) => spawnSync(process.execPath, [join(SCRIPTS, 'health.mjs'), ...args], {
      env: { ...process.env, WIKI_MASTER_VAULT: w.a }, encoding: 'utf8',
    });
    assert.doesNotMatch(health().stdout, /Recorded refusals/, 'nothing recorded yet, so no line');
    assert.equal(syncCli(w.a).status, 3);
    const raw = readFileSync(refusalsFile(w.a), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one line');
    const one = JSON.parse(lines[0]);
    assert.equal(one.kind, 'sync-overlap');
    assert.equal(one.paths, 1);
    assert.deepEqual(Object.keys(one).sort(), ['at', 'kind', 'op', 'paths']);
    assert.ok(Number.isFinite(Date.parse(one.at)));
    assert.ok(!raw.includes('index.md') && !raw.includes('index') && !raw.includes(token), 'no file name or token in the record');
    const shown = health();
    assert.match(shown.stdout, /^Recorded refusals: 1 \(pre-dirty 0, evidence 0, unscoped 0, sync-overlap 1\)\.$/m, shown.stdout + shown.stderr);
    const json = JSON.parse(health('--json').stdout);
    assert.equal(json.opRefusals.syncOverlap, 1);
    assert.equal(json.opRefusals.total, 1);

    writeFileSync(refusalsFile(w.a), '');
    assert.doesNotMatch(health().stdout, /Recorded refusals/, 'an empty record prints no line');
    rmSync(refusalsFile(w.a));
    assert.doesNotMatch(health().stdout, /Recorded refusals/, 'an absent record prints no line');
  } finally { w.cleanup(); }
});

test('a record file that cannot be appended to changes neither the message nor the exit code', () => {
  const normalise = (text, tokens) => tokens.reduce((out, tok, i) => out.split(tok).join(`<token${i}>`), text);

  const control = refusedWithRecordingOperation();
  let controlText;
  try {
    const r = syncCli(control.w.a);
    assert.equal(r.status, 3, r.stderr);
    assert.equal(records(control.w.a).length, 1, 'the control records its refusal');
    controlText = normalise(r.stderr, [control.token]);
  } finally { control.w.cleanup(); }

  const blocked = refusedWithRecordingOperation();
  try {
    mkdirSync(refusalsFile(blocked.w.a), { recursive: true });
    const head = sh(blocked.w.a, 'rev-parse', 'HEAD');
    const r = syncCli(blocked.w.a);
    assert.equal(r.status, 3, `a directory in the record place must not change the exit code: ${r.stderr}`);
    assert.equal(normalise(r.stderr, [blocked.token]), controlText, 'nor the message');
    assert.equal(sh(blocked.w.a, 'rev-parse', 'HEAD'), head);
    assert.equal(readFileSync(join(blocked.w.a, 'index.md'), 'utf8'), DIRTY);
    assert.deepEqual(readdirSync(refusalsFile(blocked.w.a)), [], 'nothing was written into the directory');
  } finally { blocked.w.cleanup(); }
});
