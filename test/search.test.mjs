import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  semanticSearch, mergeRRF, search, keywordSearch, loadChunkIndex, renderResult,
} from '../scripts/search.mjs';
import { encodeVectors } from '../scripts/lib/vector-index.mjs';
import { assessTiers } from '../scripts/lib/search-health.mjs';

// A trivial 2D embedding space so cosine similarity is hand-verifiable: vectors
// pointing the same direction as the query score 1; orthogonal score 0.
// semanticSearch is a thin wrapper around lib/vector-index.mjs's queryPages
// (mean-of-chunks page ranking -- see that module's own comment for why mean
// beats best-chunk); the ranking math itself is tested there. These tests
// cover the wrapper's own job: embed the query once, pass through manifest
// shape, return what queryPages returns.
test('semanticSearch embeds the query exactly once and delegates ranking to queryPages', async () => {
  const vectors = { h1: [1, 0], h2: [0, 1] };
  const manifest = {
    'a.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h1', startLine: 1, endLine: 1 }] },
    'b.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h2', startLine: 1, endLine: 1 }] },
  };
  let calls = 0;
  const embedFn = async () => { calls++; return [1, 0]; };
  const results = await semanticSearch('query', { vectors, manifest, embedFn, topN: 5 });
  assert.equal(calls, 1, 'the query is embedded exactly once, never per-chunk or per-page');
  assert.deepEqual(results.map((r) => r.path), ['a.md', 'b.md']);
  assert.equal(results[0].score, 1);
});

test('semanticSearch respects topN', async () => {
  const vectors = { h1: [1, 0], h2: [0.9, 0.1] };
  const manifest = {
    'a.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h1', startLine: 1, endLine: 1 }] },
    'b.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h2', startLine: 1, endLine: 1 }] },
  };
  const results = await semanticSearch('query', { vectors, manifest, embedFn: async () => [1, 0], topN: 1 });
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'a.md');
});

// The passage-level capability the chunk index exists to provide: even
// though ranking is by mean, the startLine that rides along still points at
// the page's single BEST-matching chunk, not wherever the mean happens to
// land -- see queryPages' own dedicated regression test for the mean-vs-max
// property this depends on.
test('semanticSearch carries the startLine of a page\'s best-matching chunk, not just its first', async () => {
  const vectors = { h1: [0, 1], h2: [1, 0] }; // h2 is the deep chunk, exact match
  const manifest = {
    'a.md': { mtimeMs: 1, size: 1, chunks: [
      { hash: 'h1', startLine: 1, endLine: 1 },
      { hash: 'h2', startLine: 87, endLine: 87 },
    ] },
  };
  const results = await semanticSearch('query', { vectors, manifest, embedFn: async () => [1, 0], topN: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'a.md');
  assert.equal(results[0].startLine, 87, 'the deeper, better-matching chunk\'s line wins, not the first chunk\'s');
});

test('semanticSearch on an empty index returns [] rather than throwing', async () => {
  const results = await semanticSearch('query', { vectors: {}, manifest: {}, embedFn: async () => [1, 0] });
  assert.deepEqual(results, []);
});

// A single oversized page can no longer take embedding down with it -- there
// is nothing left to retry or truncate. Chunks are built under the model's
// context window by construction (chunk.mjs), so an embed failure here is a
// real failure (Ollama down, bad query), not a size problem, and propagates.
test('semanticSearch propagates a failure embedding the query (nothing to rank against)', async () => {
  const embedFn = async () => { throw new Error('connection refused'); };
  await assert.rejects(() => semanticSearch('query', { vectors: {}, manifest: {}, embedFn }));
});

test('mergeRRF combines two ranked lists, deduplicated, by reciprocal rank', () => {
  const keyword = ['x.md', 'y.md'];
  const semantic = ['y.md', 'z.md'];
  const merged = mergeRRF([keyword, semantic]);
  const paths = merged.map((r) => r.path);
  assert.deepEqual(new Set(paths), new Set(['x.md', 'y.md', 'z.md']), 'every page appears exactly once');
  // y.md is ranked in BOTH lists (rank 2 keyword, rank 1 semantic) so it must
  // outscore x.md/z.md, each ranked in only one list.
  assert.equal(paths[0], 'y.md');
});

test('mergeRRF is deterministic given the same input', () => {
  const a = mergeRRF([['x.md', 'y.md'], ['y.md', 'z.md']]);
  const b = mergeRRF([['x.md', 'y.md'], ['y.md', 'z.md']]);
  assert.deepEqual(a, b);
});

// ── loadChunkIndex ──────────────────────────────────────────────────────
// Builds a throwaway .wiki-master-shaped directory (never the real vault) with
// a valid chunks.json/vectors.bin/vectors.idx.json trio, mirroring what
// index-embed.mjs writes.
function tempIndexDir(manifest, vectorMap) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-search-index-'));
  writeFileSync(join(dir, 'chunks.json'), JSON.stringify(manifest));
  const { buffer, idx } = encodeVectors(vectorMap);
  writeFileSync(join(dir, 'vectors.bin'), buffer);
  writeFileSync(join(dir, 'vectors.idx.json'), JSON.stringify(idx));
  return dir;
}

test('loadChunkIndex loads the manifest and vectors as-is and reports available: true', () => {
  const manifest = {
    'wiki/a.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h1', startLine: 3, endLine: 5 }] },
    'wiki/b.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h2', startLine: 1, endLine: 2 }] },
  };
  const dir = tempIndexDir(manifest, { h1: [1, 0], h2: [0, 1] });
  try {
    const index = loadChunkIndex(dir);
    assert.equal(index.available, true);
    assert.deepEqual(new Set(Object.keys(index.manifest)), new Set(['wiki/a.md', 'wiki/b.md']));
    assert.ok(index.vectors.h1 && index.vectors.h2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadChunkIndex reports available: false when the index files are absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-search-noindex-'));
  try {
    const index = loadChunkIndex(dir);
    assert.equal(index.available, false);
    assert.deepEqual(index.manifest, {});
    assert.deepEqual(index.vectors, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A manifest entry can exist for a file with no chunks yet (e.g. mid-refresh
// bookkeeping) -- that must not count as coverage, or a caller would report
// the semantic channel as available when it has nothing to rank.
test('loadChunkIndex reports available: false when the manifest has files but zero chunks', () => {
  const manifest = { 'wiki/empty.md': { mtimeMs: 1, size: 1, chunks: [] } };
  const dir = tempIndexDir(manifest, {});
  try {
    const index = loadChunkIndex(dir);
    assert.equal(index.available, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The regression this guards: the old whole-page path read and hashed all
// 1,820 vault files on every single query (211ms of avoidable work, design
// spec section 3). The chunk index's manifest already knows every path and
// line, so the query-time load must touch ONLY the three fixed files under
// .wiki-master/ -- never a wiki/ file directly.
test('loadChunkIndex reads only the three index files, never a vault wiki/ file', () => {
  const manifest = {
    'wiki/a.md': { mtimeMs: 1, size: 1, chunks: [{ hash: 'h1', startLine: 3, endLine: 5 }] },
  };
  const dir = tempIndexDir(manifest, { h1: [1, 0] });
  const seen = [];
  const readFileImpl = (p, enc) => { seen.push(String(p)); return enc !== undefined ? readFileSync(p, enc) : readFileSync(p); };
  try {
    const index = loadChunkIndex(dir, { readFileImpl });
    assert.equal(index.available, true);
    assert.ok(seen.length > 0, 'the spy actually observed reads');
    assert.ok(
      seen.every((p) => !p.replace(/\\/g, '/').includes('/wiki/')),
      `expected no reads under wiki/, saw: ${seen.join(', ')}`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── search() tiering ladder ─────────────────────────────────────────────

test('search: Ollama up and an index present -> hybrid tier, fusing keyword and chunk-semantic results', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    ollamaAvailable: async () => true,
    indexAvailable: async () => true,
    semanticRun: async () => [{ path: 's.md', score: 0.9, startLine: 12 }],
  });
  assert.equal(r.tier, 'hybrid');
  assert.deepEqual(new Set(r.results.map((x) => x.path)), new Set(['k.md', 's.md']));
});

test('search: Ollama down -> lexical tier, keyword results still return', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    ollamaAvailable: async () => false,
    indexAvailable: async () => true,
    semanticRun: async () => { throw new Error('should not be called'); },
  });
  assert.equal(r.tier, 'lexical');
  assert.deepEqual(r.results, [{ path: 'k.md' }]);
});

test('search: Ollama up but no index -> lexical tier and reports the index is missing', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    ollamaAvailable: async () => true,
    indexAvailable: async () => false,
    semanticRun: async () => { throw new Error('should not be called'); },
  });
  assert.equal(r.tier, 'lexical');
  assert.deepEqual(r.results, [{ path: 'k.md' }]);
  assert.match(r.note, /index/i);
  assert.match(r.note, /missing|absent|empty/i);
});

test('search: fused hybrid results carry the startLine the semantic channel supplied', async () => {
  const r = await search('q', {
    keywordSearch: async () => [],
    ollamaAvailable: async () => true,
    indexAvailable: async () => true,
    semanticRun: async () => [{ path: 's.md', score: 0.9, startLine: 42 }],
  });
  const hit = r.results.find((x) => x.path === 's.md');
  assert.equal(hit.startLine, 42);
});

test('search: a keyword-only hit (no semantic contribution) carries no startLine', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    ollamaAvailable: async () => true,
    indexAvailable: async () => true,
    semanticRun: async () => [{ path: 's.md', score: 0.9, startLine: 42 }],
  });
  const hit = r.results.find((x) => x.path === 'k.md');
  assert.equal(hit.startLine, undefined);
});

// Found live during implementation, against the real vault: the `obsidian` CLI's
// `search` command prints the plain-text sentence "No matches found." even when
// `format=json` is requested, which is not valid JSON -- a zero-hit search must
// not crash the tiering ladder that depends on this function.
test('keywordSearch treats the obsidian CLI\'s "No matches found." text as zero hits, not a crash', () => {
  const results = keywordSearch('nonexistent query', {
    obsidianJsonImpl: () => { throw new SyntaxError('Unexpected token N, "No matches found." is not valid JSON'); },
  });
  assert.deepEqual(results, []);
});

test('keywordSearch passes through real hits unchanged', () => {
  const results = keywordSearch('provenance', { obsidianJsonImpl: () => ['a.md', 'b.md'] });
  assert.deepEqual(results, ['a.md', 'b.md']);
});

// Found while wiring the health disclosure: with Ollama reachable but the
// model not pulled, embed() throws HTTP 404 (confirmed live), and search()'s
// hybrid branch called semanticRun with no guard -- an unhandled rejection
// that crashed the whole query instead of degrading. A crash is the opposite
// of the "never silent, always usable" goal this task exists for: the user
// gets NO results, not even keyword-only ones. This mirrors the qmd tier's
// own established philosophy (a tier that fails at runtime falls through,
// per the old search.mjs comment) applied to the new ladder.
test('search: a semantic channel that fails at runtime falls back to lexical instead of crashing', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    ollamaAvailable: async () => true,
    indexAvailable: async () => true,
    semanticRun: async () => { throw new Error('Ollama embeddings HTTP 404'); },
  });
  assert.equal(r.tier, 'lexical');
  assert.deepEqual(r.results, [{ path: 'k.md' }]);
  assert.match(r.note, /404|fail/i);
});

// ── renderResult: never-silent disclosure, stdout/stderr split ─────────────
// Pure formatting -- given a search() result and an assessTiers() verdict,
// decides what a caller sees on each stream. No I/O, so the "never silent"
// and "pipeability" guarantees are unit-testable without a live vault.

test('renderResult: a healthy hybrid search prints the one-liner to stderr and only paths to stdout', () => {
  const result = { tier: 'hybrid', results: [{ path: 'a.md' }, { path: 'b.md', startLine: 12 }] };
  const assessed = assessTiers({
    ollama: { reachable: true, modelPresent: true, model: 'nomic-embed-text' },
    index: { available: true, coverage: { chunks: 100, embedded: 100, missing: 0 }, filesChanged: 0 },
  });
  const { stdout, stderr } = renderResult(result, assessed, { chunks: 100, announceFull: false });
  assert.deepEqual(stdout, ['a.md', 'b.md:12'], 'stdout carries only the answer, so piping stays clean');
  assert.equal(stderr.length, 1);
  assert.equal(stderr[0], '(hybrid · 100 chunks)');
});

// The user's #1 complaint, directly: a degraded search must never look
// identical to a healthy one. The one-liner is the minimum a caller reads.
test('renderResult: a degraded search is never silent -- the one-liner always names the gap', () => {
  const result = { tier: 'lexical', results: [{ path: 'k.md' }] };
  const assessed = assessTiers({
    ollama: { reachable: false, modelPresent: false, model: 'nomic-embed-text' },
    index: { available: true, coverage: { chunks: 100, embedded: 100, missing: 0 }, filesChanged: 0 },
  });
  const { stdout, stderr } = renderResult(result, assessed, { chunks: 100, announceFull: false });
  assert.deepEqual(stdout, ['k.md']);
  assert.ok(stderr.length > 0, 'a degraded search must say something');
  assert.ok(stderr.some((l) => /ollama not running/.test(l)), 'the gap must be named, not just "degraded"');
});

test('renderResult: diagnostics never leak into stdout, even with a note and a full block', () => {
  const result = { tier: 'lexical', results: [{ path: 'k.md' }], note: 'semantic index missing -- run node scripts/index-embed.mjs' };
  const assessed = assessTiers({
    ollama: { reachable: true, modelPresent: true, model: 'nomic-embed-text' },
    index: { available: false, coverage: { chunks: 0, embedded: 0, missing: 0 }, filesChanged: 0 },
  });
  const { stdout, stderr } = renderResult(result, assessed, { chunks: 0, announceFull: true });
  assert.deepEqual(stdout, ['k.md'], 'stdout must contain nothing but result paths');
  assert.ok(stderr.length > 1, 'the full block is multiple lines');
  assert.ok(stderr.some((l) => /index-embed\.mjs/.test(l)));
});

test('renderResult: the first-in-window call prints the full block instead of the one-liner', () => {
  const result = { tier: 'lexical', results: [] };
  const assessed = assessTiers({
    ollama: { reachable: false, modelPresent: false, model: 'nomic-embed-text' },
    index: { available: true, coverage: { chunks: 100, embedded: 100, missing: 0 }, filesChanged: 0 },
  });
  const full = renderResult(result, assessed, { announceFull: true }).stderr;
  const oneLine = renderResult(result, assessed, { announceFull: false }).stderr;
  assert.ok(full.length > oneLine.length, 'the full block carries more than the one-liner');
  assert.equal(oneLine.length, 1, 'subsequent searches inside the window get exactly one line');
});
