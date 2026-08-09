import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyPurge, applyRestore, readManifests, writeManifest, nextFreePurgeId, enrichPages, sha256,
} from '../scripts/purge.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

function tempVault() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-vault-'));
  mkdirSync(join(dir, 'wiki', 'concepts'), { recursive: true });
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  writeFileSync(join(dir, 'wiki', 'concepts', 'Foo.md'),
    '---\ntype: concept\nsources: ["[[raw/clippings/Src-abc1234.md]]"]\n---\n# Foo\n\nbody\n');
  writeFileSync(join(dir, 'raw', 'clippings', 'Src-abc1234.md'),
    '---\ntitle: "Src"\nsource: https://example.com/a\nsource-hash: abc1234deadbeef\n---\ntext\n');
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
