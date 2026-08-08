import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyPurge, applyRestore, readManifests, writeManifest, claimPurgeId, enrichPages, sha256,
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
    applyPurge(v, manifest);
    assert.equal(
      readFileSync(join(v, '.recycle', 'id', 'wiki', 'concepts', 'Foo.md'), 'utf8').includes('# Foo'),
      true, 'original capture untouched');
    assert.equal(
      readFileSync(join(v, '.recycle', 'id', 'resurrected-1', 'wiki', 'concepts', 'Foo.md'), 'utf8'),
      'came back different\n');
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
    assert.equal(readFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'utf8'), 'newer work\n');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('readManifests returns every manifest in the bin, sorted by id', () => {
  const v = tempVault();
  try {
    writeManifest(v, { id: '2026-09-01-beta', topic: 'b', entries: [] });
    writeManifest(v, { id: '2026-08-01-alpha', topic: 'a', entries: [] });
    assert.deepEqual(readManifests(v).map((m) => m.id), ['2026-08-01-alpha', '2026-09-01-beta']);
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
    assert.deepEqual(readManifests(v).map((m) => m.id), ['Zebra-id', 'apple-id']);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('readManifests on a vault with no bin returns an empty list', () => {
  const v = tempVault();
  try {
    assert.deepEqual(readManifests(v), []);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Two topics that slugify identically on the same day must not share a folder.
test('claimPurgeId suffixes rather than reusing an occupied bin folder', () => {
  const v = tempVault();
  try {
    assert.equal(claimPurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety');
    writeManifest(v, { id: '2026-08-08-ai-safety', topic: 'AI safety', entries: [] });
    assert.equal(claimPurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety-2');
    writeManifest(v, { id: '2026-08-08-ai-safety-2', topic: 'AI-safety', entries: [] });
    assert.equal(claimPurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety-3');
    assert.deepEqual(readManifests(v).map((m) => m.topic).sort(), ['AI safety', 'AI-safety']);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('a suffixed id still yields the right date via slice(0, 10)', () => {
  assert.equal('2026-08-08-ai-safety-2'.slice(0, 10), '2026-08-08');
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

test('sha256 is stable and content-derived', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
  assert.match(sha256('abc'), /^[0-9a-f]{64}$/);
});
