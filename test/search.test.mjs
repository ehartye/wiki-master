import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semanticSearch, mergeRRF, qmdAvailable, search } from '../scripts/search.mjs';

// A trivial 2D embedding space so cosine similarity is hand-verifiable: vectors
// pointing the same direction as the query score 1; orthogonal score 0.
const VEC = { query: [1, 0], same: [1, 0], orthogonal: [0, 1], opposite: [-1, 0] };
const embedFn = async (text) => VEC[text];

test('semanticSearch ranks by cosine similarity, descending', async () => {
  const pages = [
    { path: 'a.md', body: 'orthogonal' },
    { path: 'b.md', body: 'same' },
    { path: 'c.md', body: 'opposite' },
  ];
  const results = await semanticSearch('query', pages, { embedFn });
  assert.deepEqual(results.map((r) => r.path), ['b.md', 'a.md', 'c.md']);
  assert.equal(results[0].score, 1);
});

test('semanticSearch respects topN', async () => {
  const pages = [
    { path: 'a.md', body: 'orthogonal' },
    { path: 'b.md', body: 'same' },
    { path: 'c.md', body: 'opposite' },
  ];
  const results = await semanticSearch('query', pages, { embedFn, topN: 1 });
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'b.md');
});

test('semanticSearch reuses the cache: an already-cached hash is never re-embedded', async () => {
  let calls = 0;
  const countingEmbed = async (text) => { calls++; return VEC[text]; };
  const cache = {};
  const pages = [{ path: 'a.md', body: 'same' }];
  await semanticSearch('query', pages, { embedFn: countingEmbed, cache });
  const callsAfterFirst = calls;
  await semanticSearch('query', pages, { embedFn: countingEmbed, cache });
  // Second run re-embeds the query (always fresh) but not the unchanged page body.
  assert.equal(calls, callsAfterFirst + 1, 'only the query re-embeds; the cached page body does not');
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

test('qmdAvailable reflects whether the probe command succeeds', () => {
  assert.equal(qmdAvailable(() => {}), true);
  assert.equal(qmdAvailable(() => { throw new Error('not found'); }), false);
});

test('search: qmd tier wins when qmd is available and succeeds', async () => {
  const r = await search('q', {
    keywordSearch: async () => { throw new Error('should not be called'); },
    qmdProbe: () => true,
    qmdRun: async () => [{ path: 'qmd-result.md' }],
    ollamaAvailable: async () => true,
    semanticRun: async () => { throw new Error('should not be called'); },
  });
  assert.equal(r.tier, 'qmd');
  assert.deepEqual(r.results, [{ path: 'qmd-result.md' }]);
});

test('search: falls back to hybrid when qmd is absent but Ollama is available', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    qmdProbe: () => false,
    qmdRun: async () => { throw new Error('should not be called'); },
    ollamaAvailable: async () => true,
    semanticRun: async () => [{ path: 's.md', score: 0.9 }],
  });
  assert.equal(r.tier, 'hybrid');
  assert.deepEqual(new Set(r.results.map((x) => x.path)), new Set(['k.md', 's.md']));
});

test('search: falls back to keyword-only when both qmd and Ollama are unavailable', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    qmdProbe: () => false,
    qmdRun: async () => { throw new Error('should not be called'); },
    ollamaAvailable: async () => false,
    semanticRun: async () => { throw new Error('should not be called'); },
  });
  assert.equal(r.tier, 'keyword');
  assert.deepEqual(r.results, [{ path: 'k.md' }]);
});

test('search: a qmd runtime failure (present but broken) falls through to the next tier', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    qmdProbe: () => true,
    qmdRun: async () => { throw new Error('qmd index corrupt'); },
    ollamaAvailable: async () => false,
    semanticRun: async () => { throw new Error('should not be called'); },
  });
  assert.equal(r.tier, 'keyword', 'a broken qmd degrades gracefully rather than erroring out');
});
