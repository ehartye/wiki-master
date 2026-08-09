import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeVectors, decodeVectors, planRefresh, neededHashes, queryChunks, coverage,
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
