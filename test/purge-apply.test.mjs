import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  applyPurge, applyRestore, readManifests, writeManifest, nextFreePurgeId, enrichPages, sha256,
  collectSeeds, main,
} from '../scripts/purge.mjs';
import { planPurge, buildManifest } from '../scripts/lib/purge.mjs';
import { buildGraph, computeGraphMetrics } from '../scripts/lib/graph.mjs';
import { computeHealth } from '../scripts/health.mjs';
import { recordDecline, loadDeclines } from '../scripts/lib/decline.mjs';

function tempVault() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-vault-'));
  mkdirSync(join(dir, 'wiki', 'concepts'), { recursive: true });
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  writeFileSync(join(dir, 'wiki', 'concepts', 'Foo.md'),
    '---\ntype: concept\nsources: ["[[raw/clippings/Src-abc1234.md]]"]\n---\n# Foo\n\nbody\n');
  writeFileSync(join(dir, 'raw', 'clippings', 'Src-abc1234.md'),
    '---\ntitle: "Src"\nsource: https://example.com/a\nsource-hash: abc1234deadbeef\n---\ntext\n');
  // Every real vault has an index.md (the vault-schema.md contract) -- main's
  // --apply commit always stages it, and git fails a whole
  // --pathspec-from-file add/commit outright (exit 128) if any listed path
  // matches nothing at all. Present here so the `main` CLI tests below reach
  // a realistic vault, not one only the lower-level applyPurge/applyRestore
  // tests above were shaped for.
  writeFileSync(join(dir, 'index.md'), '# Index\n');
  return dir;
}

test('applyPurge moves files under .recycle preserving their original paths', () => {
  const v = tempVault();
  try {
    const r = applyPurge(v, {
      id: '2026-08-08-topic',
      entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }],
    });
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Foo.md')), false);
    assert.equal(existsSync(join(v, '.recycle', '2026-08-08-topic', 'wiki', 'concepts', 'Foo.md')), true);
    assert.equal(r.moved, 1);
    assert.deepEqual(r.touched,
      ['wiki/concepts/Foo.md', '.recycle/2026-08-08-topic/wiki/concepts/Foo.md']);
    assert.deepEqual(r.failed, []);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// A resurrection must never overwrite the original capture.
test('applyPurge parks a resurrection in resurrected-N rather than overwriting', () => {
  const v = tempVault();
  try {
    const manifest = { id: 'id', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] };
    applyPurge(v, manifest);
    writeFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'came back different\n');
    const r = applyPurge(v, manifest);
    assert.equal(
      readFileSync(join(v, '.recycle', 'id', 'wiki', 'concepts', 'Foo.md'), 'utf8').includes('# Foo'),
      true, 'original capture untouched');
    assert.equal(
      readFileSync(join(v, '.recycle', 'id', 'resurrected-1', 'wiki', 'concepts', 'Foo.md'), 'utf8'),
      'came back different\n');
    // touched must carry the ACTUAL diverted destination, not the primary
    // slot — a mutant that pushes only e.from (dropping the destination)
    // leaves every other test in this file passing, because none of them
    // assert touched on a diverted move. Without the real destination here,
    // the caller cannot stage where the resurrection actually landed, and a
    // re-binned resurrection would be moved on disk but never committed.
    assert.deepEqual(r.touched,
      ['wiki/concepts/Foo.md', '.recycle/id/resurrected-1/wiki/concepts/Foo.md']);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// A hash-matched resurrection is a re-clip under a NEW filename, so it never
// collides. Without asResurrection it lands at the bin's top level,
// indistinguishable from a file the original purge moved there and absent from
// that folder's manifest.json — and anything auditing resurrections by scanning
// resurrected-*/ misses every re-clip.
test('a hash-matched resurrection lands in resurrected-N even though it does not collide', () => {
  const v = tempVault();
  try {
    applyPurge(v, { id: 'id', entries: [{ layer: 'raw', from: 'raw/clippings/Src-abc1234.md', sha256: 'x' }] });
    writeFileSync(join(v, 'raw', 'clippings', 'Src-zzz9999.md'),
      '---\ntitle: "Src"\nsource-hash: abc1234deadbeef\n---\ntext\n');
    applyPurge(v, { id: 'id', entries: [{ from: 'raw/clippings/Src-zzz9999.md' }] }, { asResurrection: true });
    assert.equal(
      existsSync(join(v, '.recycle', 'id', 'resurrected-1', 'raw', 'clippings', 'Src-zzz9999.md')), true);
    assert.equal(
      existsSync(join(v, '.recycle', 'id', 'raw', 'clippings', 'Src-zzz9999.md')), false,
      'must not sit at the bin top level beside the original capture');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Confirmed on Windows: a file held open with a read-only, no-delete-share
// handle (antivirus, the Windows Search indexer, a sync client) makes
// renameSync throw EBUSY. Reproducing that exact OS-level lock here would make
// the suite depend on spawning a real process and timing its handle
// acquisition — slow and flaky. This reproduces the same FAILURE SHAPE
// deterministically instead: mkdirSync (the first step inside moveInto) fails
// because a path component of the destination is occupied by a plain file
// instead of a directory. Either way the assertion is the same — one bad
// entry must not abort the batch, must be reported, and must leave its
// source untouched.
test('a locked or otherwise unmoveable entry is reported in failed, not thrown, and does not block the rest of the batch', () => {
  const v = tempVault();
  try {
    writeFileSync(join(v, 'wiki', 'concepts', 'Bar.md'), 'bar body\n');
    // Occupy the destination directory slot with a FILE, so mkdirSync(...,
    // {recursive:true}) for Bar.md's bin path fails deterministically.
    mkdirSync(join(v, '.recycle', 'id'), { recursive: true });
    writeFileSync(join(v, '.recycle', 'id', 'wiki'), 'blocking file, not a directory\n');

    const r = applyPurge(v, {
      id: 'id',
      entries: [
        { from: 'raw/clippings/Src-abc1234.md' }, // unaffected, must still move
        { from: 'wiki/concepts/Bar.md' },          // blocked
      ],
    });

    assert.equal(r.moved, 1);
    assert.deepEqual(r.touched,
      ['raw/clippings/Src-abc1234.md', '.recycle/id/raw/clippings/Src-abc1234.md']);
    assert.equal(r.failed.length, 1);
    assert.equal(r.failed[0].from, 'wiki/concepts/Bar.md');
    assert.equal(typeof r.failed[0].reason, 'string');
    assert.ok(r.failed[0].reason.length > 0);
    // Atomic per file: the failed entry's source is left exactly in place.
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Bar.md')), true);
    assert.equal(readFileSync(join(v, 'wiki', 'concepts', 'Bar.md'), 'utf8'), 'bar body\n');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('the bin is invisible to buildGraph', () => {
  const v = tempVault();
  try {
    applyPurge(v, { id: 'id', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] });
    const { pages } = buildGraph(v);
    assert.equal(pages.some((p) => p.path.includes('.recycle')), false);
    assert.equal(pages.some((p) => p.path === 'wiki/concepts/Foo.md'), false);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Every bin path must fail the anchored wiki/ filters the other readers use.
test('bin paths fail the anchored wiki/ filters', () => {
  const v = tempVault();
  try {
    const r = applyPurge(v, { id: 'id', entries: [{ from: 'wiki/concepts/Foo.md' }] });
    const binPath = r.touched[1];
    assert.equal(/^wiki\//.test(binPath), false);
    assert.equal(/^wiki\/(concepts|syntheses)\//.test(binPath), false);
    assert.equal(binPath.startsWith('.'), true);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('applyPurge skips an entry whose file is not there', () => {
  const v = tempVault();
  try {
    const r = applyPurge(v, { id: 'id', entries: [{ from: 'wiki/concepts/Missing.md' }] });
    assert.equal(r.moved, 0);
    assert.deepEqual(r.touched, []);
    assert.deepEqual(r.failed, []);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('applyRestore puts every entry back where it came from', () => {
  const v = tempVault();
  try {
    const before = readFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'utf8');
    const manifest = { id: 'id', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] };
    applyPurge(v, manifest);
    const r = applyRestore(v, manifest);
    assert.equal(readFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'utf8'), before);
    assert.equal(r.restored, 1);
    assert.deepEqual(r.missing, []);
    // A restore is otherwise a purely local working-tree change: the caller
    // needs exactly what moved to stage a commit, the same reasoning as
    // applyPurge.touched.
    assert.deepEqual(r.touched, ['.recycle/id/wiki/concepts/Foo.md', 'wiki/concepts/Foo.md']);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Restore must never be the destructive operation purge was designed not to be.
test('applyRestore refuses to clobber a file already at the original path', () => {
  const v = tempVault();
  try {
    const manifest = { id: 'id', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] };
    applyPurge(v, manifest);
    writeFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'newer work\n');
    const r = applyRestore(v, manifest);
    assert.equal(r.restored, 0);
    assert.deepEqual(r.skipped, ['wiki/concepts/Foo.md']);
    assert.deepEqual(r.touched, []);
    assert.equal(readFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'utf8'), 'newer work\n');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// A file genuinely never purged (never in the primary slot, never in any
// resurrected-N/) has nothing to restore and must be reported, not silently
// dropped.
test('applyRestore reports an entry with no bin copy anywhere as missing', () => {
  const v = tempVault();
  try {
    const manifest = { id: 'id', entries: [{ from: 'wiki/concepts/Never-Purged.md' }] };
    const r = applyRestore(v, manifest);
    assert.equal(r.restored, 0);
    assert.deepEqual(r.missing, ['wiki/concepts/Never-Purged.md']);
    assert.deepEqual(r.touched, []);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Reproduces the reviewer's exact chain: a 3-entry purge crashes after moving
// entry 1 (the manifest is already written — the real CLI writes it before
// moving files — so it correctly lists all 3). Entries 2 and 3 are still live
// at their original paths. A subsequent reconcile pass re-bins them — this
// simulates the version of that pass that (incorrectly) forces every re-bin
// through asResurrection, landing entries 2 and 3 in resurrected-1/ even
// though their primary slots were never occupied. Before the fix, applyRestore
// only checked the primary slot, so it would silently return
// { restored: 1, skipped: [] } — a bare "restored 1" success message while 2
// files stayed gone. Every one of the 3 must now come back, or be reported.
test('a partial purge, reconciled into resurrected-N, still restores in full instead of stranding files', () => {
  const v = tempVault();
  try {
    writeFileSync(join(v, 'wiki', 'concepts', 'Bar.md'), 'bar body\n');
    const manifest = {
      id: 'id',
      entries: [
        { from: 'wiki/concepts/Foo.md' },
        { from: 'raw/clippings/Src-abc1234.md' },
        { from: 'wiki/concepts/Bar.md' },
      ],
    };
    // Entry 1: the pre-crash work that completed normally.
    applyPurge(v, { id: 'id', entries: [manifest.entries[0]] });
    // Entries 2 and 3: still live, then force-diverted by the buggy reconcile.
    applyPurge(v, { id: 'id', entries: [manifest.entries[1]] }, { asResurrection: true });
    applyPurge(v, { id: 'id', entries: [manifest.entries[2]] }, { asResurrection: true });

    const r = applyRestore(v, manifest);
    assert.equal(r.restored, 3);
    assert.deepEqual(r.skipped, []);
    assert.deepEqual(r.missing, []);
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Foo.md')), true);
    assert.equal(existsSync(join(v, 'raw', 'clippings', 'Src-abc1234.md')), true);
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Bar.md')), true);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('readManifests returns every manifest in the bin, sorted by id', () => {
  const v = tempVault();
  try {
    writeManifest(v, { id: '2026-09-01-beta', topic: 'b', entries: [] });
    writeManifest(v, { id: '2026-08-01-alpha', topic: 'a', entries: [] });
    const { manifests, unreadable } = readManifests(v);
    assert.deepEqual(manifests.map((m) => m.id), ['2026-08-01-alpha', '2026-09-01-beta']);
    assert.deepEqual(unreadable, []);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// On NTFS, raw fs.readdirSync order is case-insensitive alphabetical
// ('apple-id' before 'Zebra-id'), while JS's default .sort() is byte-order
// ('Zebra-id' before 'apple-id', since 'Z' (0x5A) < 'a' (0x61)). Every other
// readManifests test here uses same-shaped lowercase ids, so on this platform
// the raw directory order already happens to agree with sorted order and
// cannot tell "we sorted" apart from "the filesystem happened to". This one
// forces disagreement between the two, so it fails if `.sort()` is removed.
test('readManifests sorts by JS byte order, not raw directory order', () => {
  const v = tempVault();
  try {
    writeManifest(v, { id: 'apple-id', topic: 'apple', entries: [] });
    writeManifest(v, { id: 'Zebra-id', topic: 'zebra', entries: [] });
    assert.deepEqual(readManifests(v).manifests.map((m) => m.id), ['Zebra-id', 'apple-id']);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('readManifests on a vault with no bin returns an empty list', () => {
  const v = tempVault();
  try {
    assert.deepEqual(readManifests(v), { manifests: [], unreadable: [] });
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// A corrupt manifest.json was previously indistinguishable from an absent
// one — both silently contributed nothing. That means its entries never
// re-bin on resurrection and its declines never replay, permanently, while a
// caller iterating only the returned array sees a clean, empty-looking pass.
// unreadable makes that failure visible instead of swallowing it.
test('readManifests reports a corrupt manifest.json in unreadable rather than silently dropping it', () => {
  const v = tempVault();
  try {
    writeManifest(v, { id: '2026-08-01-good', topic: 'good', entries: [] });
    mkdirSync(join(v, '.recycle', '2026-08-02-bad'), { recursive: true });
    writeFileSync(join(v, '.recycle', '2026-08-02-bad', 'manifest.json'), '{ not valid json');
    const { manifests, unreadable } = readManifests(v);
    assert.deepEqual(manifests.map((m) => m.id), ['2026-08-01-good']);
    assert.deepEqual(unreadable, ['.recycle/2026-08-02-bad/manifest.json']);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Two topics that slugify identically on the same day must not share a folder.
test('nextFreePurgeId suffixes rather than reusing an occupied bin folder', () => {
  const v = tempVault();
  try {
    assert.equal(nextFreePurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety');
    writeManifest(v, { id: '2026-08-08-ai-safety', topic: 'AI safety', entries: [] });
    assert.equal(nextFreePurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety-2');
    writeManifest(v, { id: '2026-08-08-ai-safety-2', topic: 'AI-safety', entries: [] });
    assert.equal(nextFreePurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety-3');
    assert.deepEqual(readManifests(v).manifests.map((m) => m.topic).sort(), ['AI safety', 'AI-safety']);
    // A suffixed id still yields the right date via slice(0, 10) — this
    // exercises the module's own function rather than asserting a fact about
    // JavaScript string slicing in isolation.
    assert.equal(nextFreePurgeId(v, '2026-08-08-ai-safety').slice(0, 10), '2026-08-08');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// buildGraph does not read `source:`; the manifest needs the URL to record a
// decline, so apply-time enrichment reads it off the clipping.
test('enrichPages reads the source url off a clipping', () => {
  const v = tempVault();
  try {
    const pages = enrichPages(v, buildGraph(v).pages);
    const clip = pages.find((p) => p.path === 'raw/clippings/Src-abc1234.md');
    assert.equal(clip.url, 'https://example.com/a');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('enrichPages leaves wiki pages untouched', () => {
  const v = tempVault();
  try {
    const pages = enrichPages(v, buildGraph(v).pages);
    const page = pages.find((p) => p.path === 'wiki/concepts/Foo.md');
    assert.equal(page.url, undefined);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// 256 of the live vault's captured `source:` values are not URLs — local file
// paths from docx/pdf clippings. Letting one flow into p.url would put a
// user's local directory layout into manifest.declines, a git-tracked,
// cross-machine-synced file, and replay it as a "decline" on every machine.
test('enrichPages excludes a non-http source: value (a local file path) from url', () => {
  const v = tempVault();
  try {
    writeFileSync(join(v, 'raw', 'clippings', 'Local-abc.md'),
      '---\ntitle: "Local"\nsource: C:\\Users\\me\\paper.pdf\nsource-hash: aaa1111bbb2222\n---\ntext\n');
    const pages = enrichPages(v, buildGraph(v).pages);
    const clip = pages.find((p) => p.path === 'raw/clippings/Local-abc.md');
    assert.equal(clip.url, undefined);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// The old `\S+?` capture group cannot match a value containing a space at
// all (a local path like `My Documents\paper.pdf`), so it silently produced
// no match. Confirming this doesn't regress once unified with clip.mjs's
// value-shaped regex.
test('enrichPages tolerates a source: value containing a space', () => {
  const v = tempVault();
  try {
    writeFileSync(join(v, 'raw', 'clippings', 'Spacey-abc.md'),
      '---\ntitle: "Spacey"\nsource: https://example.com/a page with spaces\nsource-hash: aaa1111bbb2223\n---\ntext\n');
    const pages = enrichPages(v, buildGraph(v).pages);
    const clip = pages.find((p) => p.path === 'raw/clippings/Spacey-abc.md');
    assert.equal(clip.url, 'https://example.com/a page with spaces');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('sha256 is stable and content-derived', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
  assert.match(sha256('abc'), /^[0-9a-f]{64}$/);
});

// ---- collectSeeds ----

test('collectSeeds takes wiki pages by rank and drops raw hits', async () => {
  const fakeSearch = async () => ({
    tier: 'test',
    results: [
      { path: 'wiki/concepts/Topic.md', score: 0.0163 },
      { path: 'raw/clippings/Src-abc1234.md', score: 0.0161 },
      { path: 'wiki/concepts/Second.md', score: 0.0158 },
    ],
  });
  assert.deepEqual(await collectSeeds('topic', { searchImpl: fakeSearch }),
    ['wiki/concepts/Topic.md', 'wiki/concepts/Second.md']);
});

// RRF scores sit near 1/(60+rank). A threshold that looks reasonable for a
// cosine similarity discards everything and purge reports "nothing to plan",
// which reads like an empty topic rather than a broken filter.
test('collectSeeds does not threshold on score', async () => {
  const fakeSearch = async () => ({ tier: 'test', results: [{ path: 'wiki/concepts/A.md', score: 0.0164 }] });
  assert.deepEqual(await collectSeeds('topic', { searchImpl: fakeSearch }), ['wiki/concepts/A.md']);
});

test('collectSeeds caps the seed count', async () => {
  const results = Array.from({ length: 50 }, (_, i) => ({ path: `wiki/concepts/P${i}.md`, score: 1 / (61 + i) }));
  const seeds = await collectSeeds('topic', { searchImpl: async () => ({ tier: 't', results }), maxSeeds: 3 });
  assert.equal(seeds.length, 3);
  assert.equal(seeds[0], 'wiki/concepts/P0.md');
});

// ---- main (CLI) ----

function gitInit(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

function commitAll(dir, message) {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

// Runs main() against a real vault, pointing WIKI_MASTER_VAULT at it (saved and
// restored), capturing console output and process.exitCode instead of letting
// either leak into the rest of the suite.
async function runMain(vaultPath, argv, opts = {}) {
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
    await main(argv, opts);
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

const fooSearch = async () => ({ tier: 'test', results: [{ path: 'wiki/concepts/Foo.md', score: 0.0163 }] });

// M1: the `if (mode !== '--apply')` guard. A plan run must never touch disk —
// no move, no .recycle/, regardless of what the plan would do.
test('main --plan moves nothing to disk', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const r = await runMain(v, ['--plan', 'Foo'], { searchImpl: fooSearch });
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Foo.md')), true);
    assert.equal(existsSync(join(v, 'raw', 'clippings', 'Src-abc1234.md')), true);
    assert.equal(existsSync(join(v, '.recycle')), false);
    assert.equal(r.exitCode, undefined);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// M2: the `if (plan.blocking.length)` refusal. Bar.md's only citation (Foo) is
// entirely inside the purge set, so purging Foo would leave Bar's claim with
// no evidence — guardrail #2. --apply must refuse outright: nothing moves,
// no manifest, no .recycle/, and exitCode communicates the refusal.
test('main --apply refuses to move anything when a survivor would lose all provenance', async () => {
  const v = mkdtempSync(join(tmpdir(), 'wm-cli-vault-'));
  try {
    mkdirSync(join(v, 'wiki', 'concepts'), { recursive: true });
    writeFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), '---\ntype: concept\n---\n# Foo\n\nbody\n');
    writeFileSync(join(v, 'wiki', 'concepts', 'Bar.md'),
      '---\ntype: concept\nsources: ["[[Foo]]"]\n---\n# Bar\n\nbody\n');
    writeFileSync(join(v, 'index.md'), '# Index\n');
    gitInit(v);
    commitAll(v, 'initial');

    const r = await runMain(v, ['--apply', 'Foo'], { searchImpl: fooSearch });

    assert.equal(r.exitCode, 1);
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Foo.md')), true);
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Bar.md')), true);
    assert.equal(existsSync(join(v, '.recycle')), false);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// M3: the `if (failed.length)` stop-before-commit guard.
//
// A real move failure could not be driven through `main --apply` from
// outside. Two mechanisms were tried and both dead-end structurally, not for
// lack of a good enough trick:
//   1. A pre-existing landmine planted under the bin id `main` would choose
//      is always dodged by nextFreePurgeId's own collision-avoidance (it
//      treats the occupied folder as "taken" and picks the next one instead).
//   2. applyPurge's own new guard (below) against overwriting the purge's
//      manifest.json can be MADE to fire by calling applyPurge directly (see
//      the direct-level test below) -- but never through `main`, because
//      writeManifest always runs before applyPurge in that flow, so by the
//      time applyPurge sees a "manifest.json" entry, `.recycle/<id>/manifest.json`
//      already exists on disk and the ORDINARY existsSync-collision check
//      (checked first) has already diverted it into resurrected-N/ --
//      silently succeeding, never reaching the new guard at all. Confirmed
//      empirically: calling applyPurge directly on this exact fixture (no
//      prior writeManifest) reports `failed: [...]`; going through `main`
//      reports a clean, fully committed purge instead.
// So this tests the WIRING of the guard via the one injection seam `main`
// already has a precedent for (`searchImpl`): an injected `applyPurge` that
// fails on demand, independent of what real-world condition would cause
// applyPurge to report a failure. That underlying condition is covered by
// the "a locked or otherwise unmoveable entry..." test in this file and its
// G3 re-run in the mutation table.
test('main --apply stops before committing when applyPurge reports a failed move', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: v, encoding: 'utf8' }).trim();
    const failingApplyPurge = () => ({
      moved: 0, touched: [], failed: [{ from: 'wiki/concepts/Foo.md', reason: 'simulated failure' }],
    });

    const r = await runMain(v, ['--apply', 'Foo'], { searchImpl: fooSearch, applyPurge: failingApplyPurge });

    assert.equal(r.exitCode, 1);
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: v, encoding: 'utf8' }).trim();
    assert.equal(after, before, 'a purge with a failed move must not be committed');
    assert.ok(r.errs.some((l) => l.includes('could not be moved')));
    assert.ok(r.errs.some((l) => l.includes('simulated failure')));
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Guard B, direct: a vault page reachable at the literal relative path
// "manifest.json" would land at the bin's top level, same as the purge's own
// manifest.json -- and Windows renameSync overwrites an existing destination
// file rather than erroring, so without this the purge's own manifest is
// silently replaced (its entries never re-bin, its declines never replay,
// and nothing says so). Exercised directly against applyPurge, matching how
// the rest of this file tests applyPurge's guards -- see the M3 comment
// above for why this cannot also be exercised through `main`.
test('applyPurge refuses a move that would overwrite the purge manifest', () => {
  const v = tempVault();
  try {
    writeFileSync(join(v, 'manifest.json'), '{}\n');
    const manifest = { id: 'id', entries: [{ from: 'manifest.json' }, { from: 'wiki/concepts/Foo.md' }] };
    const r = applyPurge(v, manifest);
    assert.equal(r.moved, 1);
    assert.equal(existsSync(join(v, 'manifest.json')), true, 'the source must be left in place, not moved');
    assert.deepEqual(r.failed, [{ from: 'manifest.json', reason: 'destination would overwrite the purge manifest' }]);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// M4: the `--restore` unknown-id guard. Must report and set exitCode, never
// crash on a manifest that doesn't exist.
test('main --restore with an unknown manifest id reports and does not crash', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const r = await runMain(v, ['--restore', 'nonexistent-id']);
    assert.equal(r.exitCode, 1);
    assert.ok(r.errs.some((l) => l.includes('no manifest with id')));
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// M5: `asResurrection: r.reason === 'source-hash'`, exercised through
// `--reconcile`. Simulates a purge that crashed after writeManifest but
// before the move: the manifest exists, but Foo.md is still live at its
// original path. Reconcile must match it by PATH and re-bin it into its
// proper primary slot -- forcing it into resurrected-N/ (the bug this guard
// fixes) would strand it somewhere applyRestore never looks first.
test('reconcile puts a path-matched crash-recovery file in its proper slot, not resurrected-N', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const manifest = {
      id: '2026-01-01-crash', topic: 'crash', declines: [],
      entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }],
    };
    writeManifest(v, manifest); // written, as if the crash happened right after this
    const r = await runMain(v, ['--reconcile']);
    assert.equal(existsSync(join(v, '.recycle', '2026-01-01-crash', 'wiki', 'concepts', 'Foo.md')), true);
    assert.equal(
      existsSync(join(v, '.recycle', '2026-01-01-crash', 'resurrected-1', 'wiki', 'concepts', 'Foo.md')), false);
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Foo.md')), false);
    assert.equal(r.exitCode, undefined);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// M6: the commit staging set. `main` must stage and commit exactly what the
// purge touched -- an unrelated, already-dirty file in the vault (someone's
// own in-progress edit) must not ride along in the purge's commit.
test('an unrelated pre-staged file is not swept into the purge commit', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: v, encoding: 'utf8' }).trim();
    writeFileSync(join(v, 'wiki', 'concepts', 'Draft.md'), 'work in progress\n');
    execFileSync('git', ['add', 'wiki/concepts/Draft.md'], { cwd: v });

    const r = await runMain(v, ['--apply', 'Foo'], { searchImpl: fooSearch });

    // A genuinely new commit, not a stale match against the initial commit
    // (which also added Foo.md) -- the real hazard this test exists to catch.
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: v, encoding: 'utf8' }).trim();
    assert.notEqual(after, before, 'the purge must have produced a new commit');
    assert.ok(r.logs.some((l) => l.startsWith('committed ')), 'main must report the commit');
    const files = execFileSync('git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: v, encoding: 'utf8' });
    assert.equal(/Draft\.md/.test(files), false, 'the unrelated draft must not ride along in the purge commit');
    assert.match(files, /\.recycle\/.*Foo\.md/, 'the purge move itself must be in this commit');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: v, encoding: 'utf8' });
    assert.match(status, /Draft\.md/, 'and it must remain exactly as dirty as it was, neither committed nor lost');
    assert.equal(r.exitCode, undefined);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// ---- review round 2: C1, C2, I1, I2, I3 ----

// C1: re-running --apply against a topic already purged is a real, reachable
// case (a stale search hit for a page that's gone). planPurge's own
// known.has(p) filter makes plan.purge empty even though seedPaths is not --
// main must recognize that and write NOTHING, rather than a second manifest
// with zero entries, a "purged 0 file(s)" log entry, and a commit containing
// no purge at all.
test('re-running --apply after the topic is already purged writes no second manifest and commits nothing', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const first = await runMain(v, ['--apply', 'Foo'], { searchImpl: fooSearch });
    assert.ok(first.logs.some((l) => l.startsWith('committed ')));
    const { manifests: before } = readManifests(v);
    assert.equal(before.length, 1);
    const headAfterFirst = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: v, encoding: 'utf8' }).trim();

    // The same stale search hit again -- Foo.md no longer exists in the vault.
    const second = await runMain(v, ['--apply', 'Foo'], { searchImpl: fooSearch });

    assert.ok(second.logs.some((l) => l.includes('the closure is empty')));
    const { manifests: after } = readManifests(v);
    assert.equal(after.length, 1, 'no second manifest must be written');
    const headAfterSecond = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: v, encoding: 'utf8' }).trim();
    assert.equal(headAfterSecond, headAfterFirst, 'no new commit for an empty closure');
    assert.equal(second.exitCode, undefined);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// C2: --reconcile is the recovery path a stalled --apply is told to run in
// place of a second --apply. It must actually commit what it re-bins, or
// running it leaves the exact working-tree-only state this whole feature
// exists to prevent -- just reached via the "fix" instead of the crash.
test('reconcile commits what it re-bins, leaving a clean working tree', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const manifest = {
      id: '2026-01-02-crash', topic: 'crash', declines: [],
      entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }],
    };
    writeManifest(v, manifest); // simulates a crash right after the manifest was written
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: v, encoding: 'utf8' }).trim();

    const r = await runMain(v, ['--reconcile']);

    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: v, encoding: 'utf8' }).trim();
    assert.notEqual(after, before, 'reconcile must produce a commit');
    assert.ok(r.logs.some((l) => l.startsWith('committed ')));
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: v, encoding: 'utf8' });
    assert.equal(status.trim(), '', 'the tree must be clean -- nothing left uncommitted by reconcile');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// I1: an aborted apply (a move failed, nothing committed) must not still
// record a decline or write a log entry -- both describe a move that, for a
// failed entry, never actually happened. A decline recorded anyway silently
// makes /wiki-discover skip a source the user still has, for up to 180 days.
test('an aborted apply leaves declined.json and log/ untouched', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const failingApplyPurge = () => ({
      moved: 0, touched: [], failed: [{ from: 'wiki/concepts/Foo.md', reason: 'simulated failure' }],
    });

    const r = await runMain(v, ['--apply', 'Foo'], { searchImpl: fooSearch, applyPurge: failingApplyPurge });

    assert.equal(r.exitCode, 1);
    assert.equal(existsSync(join(v, '.wiki-master', 'declined.json')), false);
    assert.equal(existsSync(join(v, 'log')), false);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// I2: --restore is advertised as the inverse of purge. A file coming back
// while its URL stays declined for up to 180 days is not a true inverse --
// /wiki-discover would keep silently skipping a source the user has back.
test('--restore clears the decline this purge itself recorded', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    await runMain(v, ['--apply', 'Foo'], { searchImpl: fooSearch });
    const { manifests } = readManifests(v);
    const manifest = manifests[0];
    assert.deepEqual(manifest.declines, ['https://example.com/a']);
    assert.ok(loadDeclines(v).some((d) => d.url === 'https://example.com/a'), 'the purge must have declined it');

    const r = await runMain(v, ['--restore', manifest.id]);

    assert.ok(r.logs.some((l) => l.includes('cleared 1 decline')));
    assert.equal(loadDeclines(v).some((d) => d.url === 'https://example.com/a'), false);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// I2: scoped to exactly this purge's own reason tag -- a decline on the SAME
// url, recorded independently (by the user, or by a different purge run)
// after this purge, must survive a restore that only undoes THIS purge.
test('--restore does not clear a same-url decline recorded for a different reason', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    await runMain(v, ['--apply', 'Foo'], { searchImpl: fooSearch });
    const { manifests } = readManifests(v);
    const manifest = manifests[0];
    // The user independently re-declines the same url for their own reason,
    // after the purge -- this must NOT be cleared just because the url matches.
    recordDecline(v, 'https://example.com/a', 'declined by the user, unrelated to the purge');

    const r = await runMain(v, ['--restore', manifest.id]);

    assert.equal(r.logs.some((l) => l.includes('cleared')), false);
    const entry = loadDeclines(v).find((d) => d.url === 'https://example.com/a');
    assert.ok(entry, 'the independently-recorded decline must survive');
    assert.equal(entry.reason, 'declined by the user, unrelated to the purge');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// I3: an empty search result is indistinguishable from a dead Obsidian CLI
// unless something checks. The lazy canary (assertRunning) is probed only
// once an empty result is about to drive the "nothing to plan" decision --
// covering both what it decides when Obsidian is healthy and when it isn't,
// in both --plan and --apply (the check runs before the two modes diverge).
const emptySearch = async () => ({ tier: 'test', results: [] });

test('an empty search result with a healthy Obsidian reports nothing to plan (--plan)', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const r = await runMain(v, ['--plan', 'Nonexistent Topic'],
      { searchImpl: emptySearch, assertRunning: () => {} });
    assert.ok(r.logs.some((l) => l.includes('nothing to plan')));
    assert.equal(r.exitCode, undefined);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('an empty search result with a dead Obsidian refuses to trust it (--apply)', async () => {
  const v = tempVault();
  try {
    gitInit(v);
    commitAll(v, 'initial');
    const r = await runMain(v, ['--apply', 'Nonexistent Topic'], {
      searchImpl: emptySearch,
      assertRunning: () => { throw new Error('Obsidian CLI unavailable.'); },
    });
    assert.equal(r.exitCode, 1);
    assert.ok(r.errs.some((l) => l.includes('cannot trust this empty result')));
    assert.equal(existsSync(join(v, '.recycle')), false);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// ---- end to end: realistic fixture vault ----
//
// Everything above is tested against synthetic in-memory page arrays or
// minimal temp vaults built inline. This section runs the real pipeline
// (buildGraph -> enrichPages -> planPurge -> buildManifest -> writeManifest
// -> applyPurge, then buildGraph/computeGraphMetrics/computeHealth again)
// against a fixture vault on disk shaped like a real purge meets: a shared
// clipping cited by both a topic page and an off-topic page, an
// exclusively-cited clipping, and an outside page that merely mentions the
// topic. The fixture is copied to a fresh temp dir per test and never
// mutated in place.

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'purge-vault');

function fixtureCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-purge-e2e-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const TOPIC_SEEDS = ['wiki/concepts/Topic Concept.md', 'wiki/sources/Topic Source.md'];

test('end to end: purging the topic keeps the shared clipping and its off-topic dependent', () => {
  const v = fixtureCopy();
  try {
    const pages = enrichPages(v, buildGraph(v).pages);
    const plan = planPurge({
      pages,
      seedPaths: TOPIC_SEEDS,
    });
    const hashes = Object.fromEntries(plan.purge.map((p) => [p, sha256(readFileSync(join(v, p), 'utf8'))]));
    const manifest = buildManifest({
      id: '2026-08-08-topic', topic: 'topic', date: '2026-08-08',
      purge: plan.purge, collateral: plan.collateral, pages, hashes,
    });
    writeManifest(v, manifest);
    applyPurge(v, manifest);

    assert.equal(existsSync(join(v, 'raw', 'clippings', 'Shared-bbb2222.md')), true, 'shared evidence survives');
    assert.equal(existsSync(join(v, 'wiki', 'syntheses', 'Offtopic.md')), true, 'off-topic page survives');
    assert.equal(existsSync(join(v, 'raw', 'clippings', 'Only-aaa1111.md')), false, 'exclusive evidence is purged');
    assert.ok(manifest.declines.includes('https://example.com/only'));
    assert.ok(!manifest.declines.includes('https://example.com/shared'));
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// The purged clipping's exclusion from the vault is not enough on its own --
// the ingest backlog (unsummarizedSources) is what /wiki-ingest reads to
// decide what still needs summarizing. A clipping left behind after a purge
// would be reported there forever, and the next /wiki-ingest run would
// resurrect the topic it was just purged for. Seeded with only Topic Concept
// (not Topic Source), so the closure still purges the exclusively-cited
// clipping without touching the shared one.
test('end to end: the purged clipping leaves the ingest backlog', () => {
  const v = fixtureCopy();
  try {
    const pages = enrichPages(v, buildGraph(v).pages);
    const beforeMetrics = computeGraphMetrics(buildGraph(v));
    assert.ok(beforeMetrics.unsummarizedSources.includes('raw/clippings/Only-aaa1111.md'),
      'sanity: the clipping starts life in the backlog (nothing under wiki/sources/ has ingested it)');

    const plan = planPurge({ pages, seedPaths: ['wiki/concepts/Topic Concept.md'] });
    assert.ok(plan.purge.includes('raw/clippings/Only-aaa1111.md'), 'sanity: the clipping is in this closure');
    const hashes = Object.fromEntries(plan.purge.map((p) => [p, sha256(readFileSync(join(v, p), 'utf8'))]));
    const manifest = buildManifest({
      id: '2026-08-08-topic-backlog', topic: 'topic', date: '2026-08-08',
      purge: plan.purge, collateral: plan.collateral, pages, hashes,
    });
    writeManifest(v, manifest);
    applyPurge(v, manifest);

    const afterMetrics = computeGraphMetrics(buildGraph(v));
    assert.equal(afterMetrics.unsummarizedSources.includes('raw/clippings/Only-aaa1111.md'), false,
      'a purged clipping must not linger in the ingest backlog');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// The most likely test in this file to reveal a real defect: it measures the
// vault's actual structural health (orphans, dead-ends, broken links) rather
// than the purge's own bookkeeping. Purging Topic Concept and Topic Source
// leaves Outside Page.md — collateral, per plan.collateral — with a body
// wikilink to a page that no longer exists. Repair (stripping that dangling
// link, matching spec §9's "collateral needs its references repaired")
// happens after the purge and before the second health check.
test('end to end: health score does not drop after purge + reference repair', () => {
  const v = fixtureCopy();
  try {
    const before = computeHealth(computeGraphMetrics(buildGraph(v)));

    const pages = enrichPages(v, buildGraph(v).pages);
    const plan = planPurge({ pages, seedPaths: TOPIC_SEEDS });
    assert.deepEqual(plan.collateral, ['wiki/concepts/Outside Page.md']);
    const hashes = Object.fromEntries(plan.purge.map((p) => [p, sha256(readFileSync(join(v, p), 'utf8'))]));
    const manifest = buildManifest({
      id: '2026-08-08-topic-health', topic: 'topic', date: '2026-08-08',
      purge: plan.purge, collateral: plan.collateral, pages, hashes,
    });
    writeManifest(v, manifest);
    applyPurge(v, manifest);

    // Confirm the purge actually left real damage behind, so the repair step
    // below is doing real work and this test isn't vacuous.
    const midMetrics = computeGraphMetrics(buildGraph(v));
    assert.ok(
      midMetrics.brokenLinks.some((b) => b.source === 'wiki/concepts/Outside Page.md' && b.target === 'Topic Concept'),
      'purge left a real dangling link on the collateral page, pre-repair'
    );

    // Reference repair: strip dangling wikilinks to purged pages from the
    // collateral pages the plan named. index.md is not touched here — it is
    // a SYSTEM_FILES entry excluded from computeGraphMetrics as a link
    // source, so its own stale catalog entries do not affect the score, and
    // full regeneration is index-gen.mjs's job, not this test's.
    const purgedTitles = new Set(
      plan.purge.filter((p) => p.startsWith('wiki/')).map((p) => p.split('/').pop().replace(/\.md$/i, ''))
    );
    for (const c of plan.collateral) {
      const file = join(v, c);
      let text = readFileSync(file, 'utf8');
      for (const title of purgedTitles) {
        const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`\\[\\[${esc}(\\|[^\\]]*)?\\]\\]`, 'g'), '');
      }
      writeFileSync(file, text);
    }

    const after = computeHealth(computeGraphMetrics(buildGraph(v)));
    assert.ok(after.score >= before.score,
      `expected health not to drop: before ${before.score}, after ${after.score}`);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// The bin must be invisible to the whole metrics pipeline, not just to a
// synthetic single-file check: buildGraph must never see a .recycle/ path,
// and every path applyPurge actually wrote to must fail both anchored
// filters the rest of the codebase uses to mean "this is live wiki content."
test('end to end: the bin is invisible to the whole metrics pipeline', () => {
  const v = fixtureCopy();
  try {
    const pages = enrichPages(v, buildGraph(v).pages);
    const plan = planPurge({ pages, seedPaths: TOPIC_SEEDS });
    const hashes = Object.fromEntries(plan.purge.map((p) => [p, sha256(readFileSync(join(v, p), 'utf8'))]));
    const manifest = buildManifest({
      id: '2026-08-08-topic-bin', topic: 'topic', date: '2026-08-08',
      purge: plan.purge, collateral: plan.collateral, pages, hashes,
    });
    writeManifest(v, manifest);
    const { touched } = applyPurge(v, manifest);

    const binPaths = touched.filter((_, i) => i % 2 === 1);
    assert.ok(binPaths.length > 0, 'sanity: something actually moved');
    for (const bp of binPaths) {
      assert.equal(/^wiki\//.test(bp), false, `${bp} must not pass the anchored wiki/ filter`);
      assert.equal(/^wiki\/(concepts|syntheses)\//.test(bp), false, `${bp} must not pass the anchored wiki/(concepts|syntheses)/ filter`);
    }

    const after = buildGraph(v).pages;
    assert.equal(after.some((p) => p.path.includes('.recycle')), false, 'buildGraph must never surface a bin path');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Reconcile is the OTHER reader of the fixture vault's shape: a manifest
// written for this exact closure must round-trip through readManifests and
// restore every purged file back to exactly where it started, with the
// off-topic survivor and shared clipping never having moved at all. This
// covers the full plan -> apply -> restore lifecycle against a realistic
// vault rather than the single-file fixtures the applyRestore tests above use.
test('end to end: restore puts the full closure back and leaves the survivors untouched', () => {
  const v = fixtureCopy();
  try {
    const pages = enrichPages(v, buildGraph(v).pages);
    const plan = planPurge({ pages, seedPaths: TOPIC_SEEDS });
    const hashes = Object.fromEntries(plan.purge.map((p) => [p, sha256(readFileSync(join(v, p), 'utf8'))]));
    const manifest = buildManifest({
      id: '2026-08-08-topic-restore', topic: 'topic', date: '2026-08-08',
      purge: plan.purge, collateral: plan.collateral, pages, hashes,
    });
    writeManifest(v, manifest);
    applyPurge(v, manifest);

    const { manifests } = readManifests(v);
    const found = manifests.find((m) => m.id === '2026-08-08-topic-restore');
    assert.ok(found, 'the written manifest must be readable back');

    const r = applyRestore(v, found);
    assert.equal(r.restored, plan.purge.length);
    assert.deepEqual(r.missing, []);
    for (const p of plan.purge) {
      assert.equal(existsSync(join(v, p)), true, `${p} must be back at its original path`);
    }
    assert.equal(existsSync(join(v, 'raw', 'clippings', 'Shared-bbb2222.md')), true);
    assert.equal(existsSync(join(v, 'wiki', 'syntheses', 'Offtopic.md')), true);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('the purge-vault fixture on disk is never mutated by these tests', () => {
  const status = execFileSync('git', ['status', '--short', '--', 'test/fixtures/purge-vault'],
    { cwd: dirname(dirname(fileURLToPath(import.meta.url))), encoding: 'utf8' });
  // Modified/deleted entries ('M', 'D', ' M', etc.) would show here; a freshly
  // added, never-yet-committed fixture shows as '??' or 'A ' and is fine --
  // this only guards against IN-PLACE MUTATION of the fixture's own content.
  const suspicious = status.split('\n').filter((l) => l.trim() && !/^\?\?|^A /.test(l));
  assert.deepEqual(suspicious, [], `fixture must not be mutated by tests:\n${status}`);
});
