import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

// The refused sync from end to end, through the real command lines and real git: a bare remote, one vault checkout that two
// writers share, and a second machine that pushes the upstream change. Writer A has an open operation, has dirtied and recorded
// `index.md`, and the second machine has changed `index.md` upstream. Writer B syncs and is refused with exit 3 and a message
// that names the file and the operation, forbids the workaround and changes nothing. A then closes through `wiki-sync.mjs --op`,
// which commits and publishes its work, and B's next sync succeeds. Nothing here touches a real vault.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Twenty numbered lines, so a change at the top and a change at the bottom are far enough apart for git to merge both.
const BASE = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const A_EDIT = `${BASE}written by the open operation\n`;
const B_EDIT = BASE.replace('line 1\n', 'line 1 changed upstream\n');

function world() {
  const root = mkdtempSync(join(tmpdir(), 'wm-refusal-e2e-'));
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const clone = (name) => {
    const dir = join(root, name);
    execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', remote, dir], { stdio: ['ignore', 'pipe', 'ignore'] });
    sh(dir, 'config', 'user.email', `${name}@example.com`);
    sh(dir, 'config', 'user.name', name);
    return dir;
  };
  const vault = clone('vault');
  writeFileSync(join(vault, '.gitignore'), '.wiki-master/\n');
  writeFileSync(join(vault, 'index.md'), BASE);
  sh(vault, 'add', '-A');
  sh(vault, 'commit', '-q', '-m', 'initial');
  sh(vault, 'push', '-q', '-u', 'origin', 'HEAD:main');
  sh(vault, 'branch', '-q', '--set-upstream-to=origin/main');
  const other = clone('other');
  return { root, remote, vault, other, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function script(vault, name, argv) {
  return spawnSync(process.execPath, [join(SCRIPTS, name), ...argv], {
    cwd: vault, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, WIKI_MASTER_VAULT: vault, WIKI_MASTER_BROWSER: '/no/such/browser' },
  });
}

function begin(vault, op) {
  const r = script(vault, 'op-begin.mjs', ['--op', op]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function pushUpstream(w, text) {
  writeFileSync(join(w.other, 'index.md'), text);
  sh(w.other, 'add', 'index.md');
  sh(w.other, 'commit', '-q', '-m', 'upstream edit of index.md');
  sh(w.other, 'push', '-q');
}

const tokenFile = (vault, token) => join(vault, '.wiki-master', 'ops', `${token}.json`);
const refusalLines = (vault) => {
  const file = join(vault, '.wiki-master', 'op-refusals.jsonl');
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

// Everything a refusal must leave alone, read in one place so a before and an after compare whole.
const state = (w, token) => ({
  head: sh(w.vault, 'rev-parse', 'HEAD'),
  remote: sh(w.remote, 'rev-parse', 'main'),
  stash: sh(w.vault, 'stash', 'list'),
  status: sh(w.vault, 'status', '--porcelain', '--untracked-files=all'),
  index: readFileSync(join(w.vault, 'index.md'), 'utf8'),
  token: token === undefined ? null : readFileSync(tokenFile(w.vault, token), 'utf8'),
});

test('B is refused while A holds an open operation, nothing changes, and after A closes B syncs', () => {
  const w = world();
  try {
    // Writer A: an ingest operation that has written and recorded index.md but not closed.
    const token = begin(w.vault, 'ingest');
    writeFileSync(join(w.vault, 'index.md'), A_EDIT);
    const recorded = script(w.vault, 'op-ledger.mjs', ['add', '--since', token, 'index.md']);
    assert.equal(recorded.status, 0, recorded.stderr);
    // The second machine changed the same file upstream.
    pushUpstream(w, B_EDIT);

    // Writer B syncs the shared checkout.
    const before = state(w, token);
    const refused = script(w.vault, 'wiki-sync.mjs', []);
    assert.equal(refused.status, 3, `${refused.stdout}${refused.stderr}`);
    const lines = refused.stderr.split(/\r?\n/);
    assert.equal(lines[0], 'wiki-sync: uncommitted edits overlap incoming changes in index.md');
    assert.deepEqual(lines.slice(1, 5), [
      `index.md: recorded by operation ${token} (ingest)`,
      `Open operations: ${token} (ingest)`,
      `If you wrote these edits, finish your operation (wiki-sync.mjs --op ${token}) and sync again.`,
      'If you did not, leave them exactly as they are: do not reset, checkout, stash or delete them. Wait for their owner to close the operation, then sync again.',
    ], 'the refusal says it in this order, one thing per line');
    assert.doesNotMatch(refused.stderr, /commit them \(or finish the operation\)/, 'the advice that invited the workaround is gone');
    assert.deepEqual(state(w, token), before, 'HEAD, the remote, the stash, the working tree, the file and the token are all as they were');
    assert.equal(before.stash, '');
    assert.equal(before.index, A_EDIT);

    // The refusal is counted without a name, and health shows the count in both forms.
    const counted = refusalLines(w.vault);
    assert.equal(counted.length, 1);
    assert.equal(counted[0].kind, 'sync-overlap');
    assert.equal(counted[0].paths, 1);
    assert.equal(counted[0].op, 'wiki-sync');
    assert.ok(!JSON.stringify(counted).includes('index'), 'no file name in the record');
    const health = script(w.vault, 'health.mjs', []);
    assert.match(health.stdout, /^Recorded refusals: 1 \(pre-dirty 0, evidence 0, unscoped 0, sync-overlap 1\)\.$/m, health.stdout + health.stderr);
    assert.equal(JSON.parse(script(w.vault, 'health.mjs', ['--json']).stdout).opRefusals.syncOverlap, 1);

    // Asking again changes nothing either, and is counted again.
    const again = script(w.vault, 'wiki-sync.mjs', []);
    assert.equal(again.status, 3, again.stderr);
    assert.equal(again.stderr, refused.stderr, 'the same refusal');
    assert.deepEqual(state(w, token), before);
    assert.equal(refusalLines(w.vault).length, 2);

    // Writer A finishes its operation: its work is committed and published, merged over the upstream change.
    const closed = script(w.vault, 'wiki-sync.mjs', ['--op', token]);
    assert.equal(closed.status, 0, `${closed.stdout}${closed.stderr}`);
    assert.match(closed.stdout, new RegExp(`closed operation ${token}: committed`));
    assert.ok(!existsSync(tokenFile(w.vault, token)), 'the close removed the token');
    assert.equal(sh(w.vault, 'status', '--porcelain', '--untracked-files=all'), '', 'nothing is left uncommitted');
    assert.equal(sh(w.remote, 'rev-parse', 'main'), sh(w.vault, 'rev-parse', 'HEAD'), 'the close published');
    const merged = readFileSync(join(w.vault, 'index.md'), 'utf8');
    assert.ok(merged.startsWith('line 1 changed upstream\n'), 'the upstream change is there');
    assert.ok(merged.endsWith('written by the open operation\n'), 'and so is the operation\'s');

    // Writer B syncs again: nothing is open, nothing overlaps, and it succeeds.
    const synced = script(w.vault, 'wiki-sync.mjs', []);
    assert.equal(synced.status, 0, `${synced.stdout}${synced.stderr}`);
    assert.match(synced.stdout, /in sync with origin\/main/);
    assert.equal(refusalLines(w.vault).length, 2, 'a sync that is not refused records nothing');
  } finally { w.cleanup(); }
});

test('hand edits with no operation open are refused with the original advice, and committing them lets the sync go through', () => {
  const w = world();
  try {
    writeFileSync(join(w.vault, 'index.md'), A_EDIT);
    pushUpstream(w, B_EDIT);
    const before = state(w);
    const refused = script(w.vault, 'wiki-sync.mjs', []);
    assert.equal(refused.status, 3, `${refused.stdout}${refused.stderr}`);
    assert.equal(refused.stderr.trimEnd(), 'wiki-sync: uncommitted edits overlap incoming changes in index.md; commit them (or finish the operation) and sync again');
    assert.deepEqual(state(w), before);

    sh(w.vault, 'add', 'index.md');
    sh(w.vault, 'commit', '-q', '-m', 'hand edit');
    const synced = script(w.vault, 'wiki-sync.mjs', []);
    assert.equal(synced.status, 0, `${synced.stdout}${synced.stderr}`);
    assert.equal(sh(w.remote, 'rev-parse', 'main'), sh(w.vault, 'rev-parse', 'HEAD'));
  } finally { w.cleanup(); }
});

test('a file no open operation recorded is named as such, while the operation is still listed', () => {
  const w = world();
  try {
    const token = begin(w.vault, 'relink');
    writeFileSync(join(w.vault, 'index.md'), A_EDIT);
    pushUpstream(w, B_EDIT);
    const refused = script(w.vault, 'wiki-sync.mjs', []);
    assert.equal(refused.status, 3, refused.stderr);
    assert.match(refused.stderr, /^index\.md: not recorded by any open operation$/m);
    assert.doesNotMatch(refused.stderr, /recorded by operation/);
    assert.match(refused.stderr, new RegExp(`^Open operations: ${token} \\(relink\\)$`, 'm'));
    assert.match(refused.stderr, /do not reset, checkout, stash or delete them/);
    assert.ok(existsSync(tokenFile(w.vault, token)));
  } finally { w.cleanup(); }
});
