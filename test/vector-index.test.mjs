import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeVectors, decodeVectors, planRefresh, neededHashes, queryChunks, queryPages, coverage,
} from '../scripts/lib/vector-index.mjs';

test('encodeVectors/decodeVectors round-trip through a Buffer', () => {
  const map = {
    aaa: [0.5, -0.25, 1, 0, 0.125],
    bbb: [1, 1, 1, 1, 1],
    ccc: [-1, 0.5, 0.5, -0.5, 0.25],
  };
  const { buffer, idx } = encodeVectors(map);
  assert.ok(Buffer.isBuffer(buffer));
  const decoded = decodeVectors(buffer, idx);
  for (const h of Object.keys(map)) {
    assert.deepEqual(Array.from(decoded[h]), map[h]);
  }
});

test('encodeVectors of an empty map round-trips to an empty result', () => {
  const { buffer, idx } = encodeVectors({});
  assert.equal(buffer.length, 0);
  assert.deepEqual(decodeVectors(buffer, idx), {});
});

test('an unchanged vault plans zero work', () => {
  const manifest = {
    'wiki/a.md': { mtimeMs: 1000, size: 500, chunks: [] },
    'wiki/b.md': { mtimeMs: 2000, size: 700, chunks: [] },
  };
  const files = [
    { path: 'wiki/a.md', mtimeMs: 1000, size: 500 },
    { path: 'wiki/b.md', mtimeMs: 2000, size: 700 },
  ];
  const plan = planRefresh(manifest, files);
  assert.deepEqual(plan.changed, []);
  assert.equal(plan.unchanged.length, 2);
  assert.deepEqual(plan.removed, []);
});

test('planRefresh flags a file changed when its mtimeMs differs', () => {
  const manifest = { 'wiki/a.md': { mtimeMs: 1000, size: 500, chunks: [] } };
  const files = [{ path: 'wiki/a.md', mtimeMs: 1001, size: 500 }];
  const plan = planRefresh(manifest, files);
  assert.equal(plan.changed.length, 1);
  assert.equal(plan.changed[0].path, 'wiki/a.md');
  assert.deepEqual(plan.unchanged, []);
});

// Two edits that happen to leave mtimeMs untouched (e.g. a sync tool that
// preserves timestamps) must still be caught by a SIZE difference -- if
// planRefresh only compared mtime, an edited file with a byte-identical
// timestamp would silently keep stale chunks forever.
test('planRefresh flags a file changed when only its size differs, mtimeMs unchanged', () => {
  const manifest = { 'wiki/a.md': { mtimeMs: 1000, size: 500, chunks: [] } };
  const files = [{ path: 'wiki/a.md', mtimeMs: 1000, size: 501 }];
  const plan = planRefresh(manifest, files);
  assert.equal(plan.changed.length, 1);
  assert.equal(plan.changed[0].path, 'wiki/a.md');
  assert.deepEqual(plan.unchanged, []);
});

test('planRefresh treats a file absent from the manifest as changed', () => {
  const manifest = {};
  const files = [{ path: 'wiki/new.md', mtimeMs: 1000, size: 500 }];
  const plan = planRefresh(manifest, files);
  assert.equal(plan.changed.length, 1);
  assert.equal(plan.changed[0].path, 'wiki/new.md');
});

test('planRefresh reports a manifest entry with no matching file as removed', () => {
  const manifest = { 'wiki/gone.md': { mtimeMs: 1000, size: 500, chunks: [] } };
  const files = [];
  const plan = planRefresh(manifest, files);
  assert.deepEqual(plan.removed, ['wiki/gone.md']);
  assert.deepEqual(plan.changed, []);
});

test('neededHashes returns only hashes with no vector yet', () => {
  const needed = neededHashes(['h1', 'h2', 'h3'], ['h1', 'h3']);
  assert.deepEqual(needed, ['h2']);
});

test('neededHashes is empty when every chunk hash already has a vector', () => {
  assert.deepEqual(neededHashes(['h1', 'h2'], ['h1', 'h2', 'h3']), []);
});

test('a page scores as its best chunk, reporting that chunk\'s line, even when the best is not the first chunk', () => {
  const vectors = {
    h1: [1, 0, 0],
    h2: [0, 1, 0],
    h3: [0, 0, 1], // matches the query exactly -- the third chunk of page A
  };
  const chunkMeta = [
    { hash: 'h1', path: 'wiki/a.md', startLine: 1 },
    { hash: 'h2', path: 'wiki/a.md', startLine: 40 },
    { hash: 'h3', path: 'wiki/a.md', startLine: 90 },
  ];
  const results = queryChunks([0, 0, 1], vectors, chunkMeta, { topN: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'wiki/a.md');
  assert.equal(results[0].startLine, 90);
  assert.ok(Math.abs(results[0].score - 1) < 1e-9);
});

test('two pages with tied scores are ordered deterministically', () => {
  const vectors = { h1: [1, 0], h2: [1, 0] };
  const chunkMeta = [
    { hash: 'h1', path: 'wiki/zeta.md', startLine: 1 },
    { hash: 'h2', path: 'wiki/alpha.md', startLine: 1 },
  ];
  const r1 = queryChunks([1, 0], vectors, chunkMeta, { topN: 5 });
  const r2 = queryChunks([1, 0], vectors, chunkMeta, { topN: 5 });
  assert.deepEqual(r1.map((r) => r.path), r2.map((r) => r.path));
  assert.deepEqual(r1.map((r) => r.path), ['wiki/alpha.md', 'wiki/zeta.md']);
});

test('querying an empty index returns [] rather than throwing', () => {
  assert.deepEqual(queryChunks([1, 0, 0], {}, [], { topN: 5 }), []);
});

test('coverage reports files, chunks, embedded and missing counts', () => {
  const manifest = {
    'wiki/a.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h1', startLine: 1, endLine: 5 }, { hash: 'h2', startLine: 6, endLine: 10 }] },
    'wiki/b.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h3', startLine: 1, endLine: 5 }] },
  };
  const haveHashes = ['h1', 'h3'];
  const result = coverage(manifest, haveHashes);
  assert.deepEqual(result, { files: 2, chunks: 3, embedded: 2, missing: 1 });
});

// Collation via localeCompare depends on the machine's ICU locale, so two
// machines would order identical-scoring hits differently. lib/purge.mjs
// settled on relational comparators after exactly this bug.
test('tied scores break by byte order, not locale collation', () => {
  const v = [1, 0, 0];
  const vectors = { a: v, b: v, c: v };
  const meta = [
    { hash: 'a', path: 'wiki/concepts/Zebra.md', startLine: 1 },
    { hash: 'b', path: 'wiki/concepts/apple.md', startLine: 1 },
    { hash: 'c', path: 'wiki/concepts/Apple.md', startLine: 1 },
  ];
  const r = queryChunks(v, vectors, meta, { topN: 3 });
  // Byte order puts uppercase before lowercase; a locale-aware collator
  // typically groups Apple/apple together ahead of Zebra.
  assert.deepEqual(r.map((h) => h.path),
    ['wiki/concepts/Apple.md', 'wiki/concepts/Zebra.md', 'wiki/concepts/apple.md']);
});

// ── queryPages: mean-of-chunks ranking (a sibling of queryChunks, not a
// replacement -- see the design-change note in vector-index.mjs) ──────────

test('queryPages scores a page as the cosine of the L2-normalized mean of its embedded chunk vectors', () => {
  const query = [1, 0];
  const vectors = { h1: [1, 0], h2: [0, 1] };
  const manifest = {
    'wiki/a.md': { mtimeMs: 1, size: 1, chunks: [
      { hash: 'h1', startLine: 1, endLine: 1 },
      { hash: 'h2', startLine: 5, endLine: 5 },
    ] },
  };
  const results = queryPages(query, vectors, manifest, { topN: 5 });
  assert.equal(results.length, 1);
  // mean = [0.5, 0.5] -> normalized [1/sqrt2, 1/sqrt2] -> cos with [1,0] = 1/sqrt2
  assert.ok(Math.abs(results[0].score - Math.SQRT1_2) < 1e-9);
});

// The property that makes mean beat best-chunk (measured: mean rank 2.6 vs.
// 5.0 against the real index -- see queryPages' own comment): a page that
// matches moderately THROUGHOUT should outrank a page with a single
// exact-match chunk buried among otherwise off-topic ones. Under best-chunk
// ranking (queryChunks) the single exact match would win instead -- this is
// the regression a mean-vs-max mixup would silently reintroduce.
test('queryPages ranks a consistently-relevant page above one with a single strong chunk among off-topic ones', () => {
  const query = [1, 0];
  const vectors = {
    // page A: two off-topic chunks (orthogonal) plus one exact match
    a1: [0, 1], a2: [0, 1], a3: [1, 0],
    // page B: three moderately-relevant chunks, consistently
    b1: [0.6, 0.8], b2: [0.6, 0.8], b3: [0.6, 0.8],
  };
  const manifest = {
    'wiki/a.md': { mtimeMs: 1, size: 1, chunks: [
      { hash: 'a1', startLine: 1, endLine: 2 },
      { hash: 'a2', startLine: 10, endLine: 12 },
      { hash: 'a3', startLine: 40, endLine: 42 }, // the single exact match
    ] },
    'wiki/b.md': { mtimeMs: 1, size: 1, chunks: [
      { hash: 'b1', startLine: 1, endLine: 2 },
      { hash: 'b2', startLine: 10, endLine: 12 },
      { hash: 'b3', startLine: 40, endLine: 42 },
    ] },
  };
  const results = queryPages(query, vectors, manifest, { topN: 5 });
  assert.deepEqual(results.map((r) => r.path), ['wiki/b.md', 'wiki/a.md'],
    'consistently-relevant B outranks A despite A containing a perfect single-chunk match');
  // The mean decides ranking, but the BEST chunk still supplies the line --
  // page A's line must point at its actual best (exact-match) chunk, not
  // wherever the mean happens to fall.
  const a = results.find((r) => r.path === 'wiki/a.md');
  assert.equal(a.startLine, 40, 'startLine still comes from the single best-matching chunk, not the mean');
});

test('queryPages skips chunks with no vector yet, and excludes a page with none embedded at all', () => {
  const query = [1, 0];
  const vectors = { h1: [1, 0] }; // h2 deliberately missing -- not yet embedded
  const manifest = {
    'wiki/partial.md': { mtimeMs: 1, size: 1, chunks: [
      { hash: 'h1', startLine: 1, endLine: 1 },
      { hash: 'h2', startLine: 5, endLine: 5 },
    ] },
    'wiki/none.md': { mtimeMs: 1, size: 1, chunks: [
      { hash: 'h3', startLine: 1, endLine: 1 },
    ] },
  };
  const results = queryPages(query, vectors, manifest, { topN: 5 });
  assert.deepEqual(results.map((r) => r.path), ['wiki/partial.md']);
});

test('queryPages on an empty manifest returns [] rather than throwing', () => {
  assert.deepEqual(queryPages([1, 0, 0], {}, {}, { topN: 5 }), []);
});
