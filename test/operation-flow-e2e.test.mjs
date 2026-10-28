import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

// The whole operation flow with two writers sharing one vault checkout, driven through the real command lines and real git:
// a bare remote and one clone of it. Writer A (ingest) and writer B (relink) are both open and both have written pages. A's
// close without a scope is refused, A's scoped close lands without B's work, and wiki-sync then publishes it and says that B
// still has unpublished work. B then closes and publishes through `wiki-sync --op`. The refusal counts are read back through
// health. Nothing here touches a real vault.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function world() {
  const root = mkdtempSync(join(tmpdir(), 'wm-flow-'));
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const v = join(root, 'vault');
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', remote, v], { stdio: ['ignore', 'pipe', 'ignore'] });
  sh(v, 'config', 'user.email', 'flow@example.com');
  sh(v, 'config', 'user.name', 'flow');
  writeFileSync(join(v, '.gitignore'), '.wiki-master/\n');
  mkdirSync(join(v, 'wiki', 'authored', 'p1'), { recursive: true });
  writeFileSync(join(v, 'wiki/authored/p1/overview.md'), '---\ntype: authored\nstatus: draft\nsources: []\nai-generated: true\nproject: p1\nkind: overview\n---\n\nAn overview with enough words in it to be a substantive page for the integrity scan to read.\n');
  sh(v, 'add', '-A');
  sh(v, 'commit', '-q', '-m', 'initial');
  sh(v, 'push', '-q', '-u', 'origin', 'HEAD:main');
  sh(v, 'branch', '-q', '--set-upstream-to=origin/main');
  return { root, remote, v, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function script(v, name, argv) {
  return spawnSync(process.execPath, [join(SCRIPTS, name), ...argv], {
    cwd: v, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, WIKI_MASTER_VAULT: v, WIKI_MASTER_BROWSER: '/no/such/browser' },
  });
}

function begin(v, op) {
  const r = script(v, 'op-begin.mjs', ['--op', op]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function write(v, name, text) {
  mkdirSync(dirname(join(v, name)), { recursive: true });
  writeFileSync(join(v, name), text);
}

function record(v, token, ...paths) {
  const r = script(v, 'op-ledger.mjs', ['add', '--since', token, ...paths]);
  assert.equal(r.status, 0, r.stderr);
}

const A1 = 'wiki/authored/p1/a-one.md';
const A2 = 'wiki/authored/p1/a-two.md';
const B1 = 'wiki/authored/p1/b-one.md';
const B2 = 'wiki/authored/p1/b-two.md';
const PRE = 'wiki/authored/p1/pre-dirty.md';

const remoteHead = (remote) => sh(remote, 'rev-parse', 'main');
const headFiles = (dir, ref = 'HEAD') => sh(dir, 'show', '--name-only', '--format=', ref).split(/\r?\n/).filter(Boolean).sort();
const dirtyList = (v) => sh(v, 'status', '--porcelain', '--untracked-files=all');
const tokenFile = (v, token) => join(v, '.wiki-master', 'ops', `${token}.json`);
const ledgerFile = (v, token) => join(v, '.wiki-master', 'ops', `${token}.paths.jsonl`);
const refusalLines = (v) => {
  const file = join(v, '.wiki-master', 'op-refusals.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const healthJson = (v) => JSON.parse(script(v, 'health.mjs', ['--json']).stdout);

test('two writers: an unscoped close is refused, the scoped close lands without the other writer, and the counts match', () => {
  const w = world();
  try {
    const v = w.v;
    // A path that was dirty before either operation opened: B will name it in a ledger by mistake.
    write(v, PRE, 'dirty before\n');
    const tokenA = begin(v, 'ingest');
    const tokenB = begin(v, 'relink');
    write(v, A1, 'written by A\n');
    write(v, A2, 'written by A\n');
    write(v, B1, 'written by B\n');
    write(v, B2, 'written by B, never recorded\n');
    record(v, tokenA, A1, A2);
    record(v, tokenB, B1);

    // 1. A's close without a scope is refused while B is open.
    const headBefore = sh(v, 'rev-parse', 'HEAD');
    const refused = script(v, 'op-commit.mjs', ['--op', 'ingest', '--title', 'a unscoped', '--since', tokenA]);
    assert.equal(refused.status, 1, `${refused.stdout}${refused.stderr}`);
    assert.ok(refused.stderr.includes('another operation is open'), refused.stderr);
    assert.ok(refused.stderr.includes(tokenB), refused.stderr);
    assert.ok(refused.stderr.includes('op-ledger.mjs show'), refused.stderr);
    assert.equal(sh(v, 'rev-parse', 'HEAD'), headBefore, 'nothing was committed');
    assert.ok(existsSync(tokenFile(v, tokenA)) && existsSync(tokenFile(v, tokenB)), 'both tokens survive the refusal');

    // 2. The refusal was counted, with a number and no name.
    const first = refusalLines(v);
    assert.equal(first.length, 1);
    assert.equal(first[0].kind, 'unscoped');
    assert.equal(first[0].paths, 4, 'the four new pages the close would have committed; the pre-dirty one was already dirty at op-begin');
    const raw = readFileSync(join(v, '.wiki-master', 'op-refusals.jsonl'), 'utf8');
    for (const name of ['a-one', 'b-one', 'b-two', 'pre-dirty']) assert.ok(!raw.includes(name), `the record holds no name (${name})`);

    // 3. A scopes the close from its recorded ledger and it lands with exactly A's pages.
    const scope = join(v, '.wiki-master', 'scope-a.json');
    const shown = script(v, 'op-ledger.mjs', ['show', '--since', tokenA, '--out', scope]);
    assert.equal(shown.status, 0, shown.stderr);
    const landed = script(v, 'op-commit.mjs', ['--op', 'ingest', '--title', 'a scoped', '--since', tokenA, '--paths-file', scope]);
    assert.equal(landed.status, 0, `${landed.stdout}${landed.stderr}`);
    assert.deepEqual(headFiles(v), [A1, A2].sort());
    for (const theirs of [B1, B2, PRE]) assert.ok(!headFiles(v).includes(theirs), `${theirs} is not in A's commit`);
    assert.ok(dirtyList(v).includes('b-one.md') && dirtyList(v).includes('b-two.md'), 'B\'s work is still dirty');
    assert.ok(!existsSync(tokenFile(v, tokenA)) && !existsSync(ledgerFile(v, tokenA)), 'A\'s token and ledger are gone');
    assert.ok(existsSync(tokenFile(v, tokenB)), 'B\'s token is untouched');
    assert.equal(refusalLines(v).length, 1, 'a close that lands records nothing');

    // 4. A plain sync publishes A and says that B has recorded work not committed, without failing.
    const synced = script(v, 'wiki-sync.mjs', []);
    assert.equal(synced.status, 0, synced.stderr);
    assert.ok(synced.stdout.includes(`operation ${tokenB} (relink) has 1 recorded path(s) not committed`), synced.stdout);
    assert.ok(synced.stdout.includes(`node scripts/wiki-sync.mjs --op ${tokenB}`), synced.stdout);
    assert.deepEqual(headFiles(w.remote, 'main'), [A1, A2].sort(), 'only A\'s pages were published');
    assert.equal(remoteHead(w.remote), sh(v, 'rev-parse', 'HEAD'));

    // 5. B names a path that was dirty before op-begin; the close is refused as pre-dirty and published as nothing.
    const badScope = join(v, '.wiki-master', 'scope-b-bad.json');
    writeFileSync(badScope, JSON.stringify([B1, PRE]));
    const remoteBefore = remoteHead(w.remote);
    const preRefused = script(v, 'wiki-sync.mjs', ['--op', tokenB, '--paths-file', badScope]);
    assert.equal(preRefused.status, 1);
    assert.ok(preRefused.stderr.startsWith('not committed:'), preRefused.stderr);
    assert.equal(remoteHead(w.remote), remoteBefore);
    assert.ok(existsSync(tokenFile(v, tokenB)), 'the refused close keeps the token');

    // 6. B closes and publishes with its recorded ledger: only the page B recorded.
    const closed = script(v, 'wiki-sync.mjs', ['--op', tokenB, '--title', 'b recorded']);
    assert.equal(closed.status, 0, `${closed.stdout}${closed.stderr}`);
    assert.match(closed.stdout, new RegExp(`^closed operation ${tokenB}: committed [0-9a-f]{7} \\(1 file\\(s\\)\\)`));
    assert.deepEqual(headFiles(w.remote, 'main'), [B1]);
    assert.equal(remoteHead(w.remote), sh(v, 'rev-parse', 'HEAD'));
    assert.ok(!existsSync(tokenFile(v, tokenB)));
    assert.ok(dirtyList(v).includes('b-two.md') && dirtyList(v).includes('pre-dirty.md'), 'the unrecorded and pre-dirty pages were never swept up');

    // 7. The counts: one unscoped, one pre-dirty, none for evidence, and health says so without calling it a defect.
    const kinds = refusalLines(v).map((r) => r.kind).sort();
    assert.deepEqual(kinds, ['pre-dirty', 'unscoped']);
    const json = healthJson(v);
    assert.deepEqual(json.opRefusals, { total: 2, preDirty: 1, evidence: 0, unscoped: 1 });
    const text = script(v, 'health.mjs', []);
    assert.match(text.stdout, /^Recorded op-commit refusals: 2 \(pre-dirty 1, evidence 0, unscoped 1\)\.$/m, text.stdout);
  } finally { w.cleanup(); }
});

test('an unscoped wiki-sync --op is refused while another writer is open: not committed, nothing pushed, both tokens kept, one refusal counted', () => {
  const w = world();
  try {
    const v = w.v;
    const tokenA = begin(v, 'ingest');
    const tokenB = begin(v, 'relink');
    write(v, B1, 'written by B\n');
    const remoteBefore = remoteHead(w.remote);
    const localBefore = sh(v, 'rev-parse', 'HEAD');
    const r = script(v, 'wiki-sync.mjs', ['--op', tokenA]);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.startsWith('not committed:'), r.stderr);
    assert.ok(r.stderr.includes('another operation is open') && r.stderr.includes(tokenB), r.stderr);
    assert.equal(remoteHead(w.remote), remoteBefore, 'the remote is unchanged');
    assert.equal(sh(v, 'rev-parse', 'HEAD'), localBefore, 'nothing was committed locally');
    assert.ok(existsSync(tokenFile(v, tokenA)) && existsSync(tokenFile(v, tokenB)));
    assert.deepEqual(refusalLines(v).map((l) => [l.kind, l.paths]), [['unscoped', 1]]);
  } finally { w.cleanup(); }
});

test('with a single writer open, the unscoped close still lands and nothing is counted', () => {
  const w = world();
  try {
    const v = w.v;
    const tokenA = begin(v, 'ingest');
    write(v, A1, 'written by A\n');
    const r = script(v, 'op-commit.mjs', ['--op', 'ingest', '--title', 'alone', '--since', tokenA]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.deepEqual(headFiles(v), [A1]);
    assert.deepEqual(refusalLines(v), []);
    assert.doesNotMatch(script(v, 'health.mjs', []).stdout, /Recorded op-commit refusals/);
  } finally { w.cleanup(); }
});
