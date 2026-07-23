import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semanticSearch, mergeRRF, qmdAvailable, search, qmdSearch, keywordSearch } from '../scripts/search.mjs';
import { hash } from '../scripts/lib/embed-cache.mjs';

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

// Found live against the real vault: a long page (~8.6K chars) made Ollama
// return HTTP 500 ("the input length exceeds the context length") -- an
// embedding-model context-window limit, not a wiki-master bug, but one
// oversized page must not take the whole search down with it.
test('semanticSearch skips a page whose embedding fails and still ranks the rest', async () => {
  const flaky = async (text) => {
    if (text === 'query') return [1, 0];
    if (text === 'too-long') throw new Error('the input length exceeds the context length');
    return VEC[text];
  };
  const pages = [
    { path: 'oversized.md', body: 'too-long' },
    { path: 'b.md', body: 'same' },
  ];
  const results = await semanticSearch('query', pages, { embedFn: flaky });
  assert.deepEqual(results.map((r) => r.path), ['b.md'], 'the failing page is skipped, not fatal');
});

// The 23-pages-invisible problem: an oversized body fails every run because the
// failure is never cached. Truncate-on-failure retries with the body's opening
// slice and caches the result under the FULL body hash, so the page becomes
// semantically searchable and later runs (and drift.mjs, sharing the cache) hit
// the cached vector instead of re-failing.
test('semanticSearch retries an oversized failing body truncated, ranks it, and caches under the full-body hash', async () => {
  const oversized = 'L'.repeat(20);
  const embedded = [];
  const sizeLimited = async (text) => {
    embedded.push(text);
    if (text.length > 10) throw new Error('the input length exceeds the context length');
    return [1, 0];
  };
  const cache = {};
  const results = await semanticSearch('query', [{ path: 'big.md', body: oversized }],
    { embedFn: sizeLimited, cache, truncateAt: 10 });
  assert.deepEqual(results.map((r) => r.path), ['big.md'], 'the oversized page is ranked, not skipped');
  assert.ok(embedded.includes(oversized.slice(0, 10)), 'the retry embeds the truncated prefix');
  assert.ok(cache[hash(oversized)], 'the vector is cached under the FULL body hash (the drift.mjs-shared key)');
});

test('semanticSearch does not retry a short body whose embedding fails (failure cannot be length)', async () => {
  let bodyAttempts = 0;
  const failsOnBody = async (text) => {
    if (text === 'query') return [1, 0];
    bodyAttempts++;
    throw new Error('connection refused');
  };
  const results = await semanticSearch('query', [{ path: 'short.md', body: 'tiny' }],
    { embedFn: failsOnBody, truncateAt: 10 });
  assert.deepEqual(results, [], 'the page is skipped');
  assert.equal(bodyAttempts, 1, 'no pointless retry with an identical (already short) body');
});

test('semanticSearch skips the page when the truncated retry also fails, still ranking the rest', async () => {
  const alwaysFailsBodies = async (text) => {
    if (text === 'query') return [1, 0];
    if (text === 'same') return VEC.same;
    throw new Error('Ollama embeddings HTTP 500');
  };
  const results = await semanticSearch('query', [
    { path: 'doomed.md', body: 'D'.repeat(20) },
    { path: 'b.md', body: 'same' },
  ], { embedFn: alwaysFailsBodies, truncateAt: 10 });
  assert.deepEqual(results.map((r) => r.path), ['b.md'], 'the doubly-failing page is skipped, not fatal');
});

test('semanticSearch still throws if the QUERY itself cannot be embedded (nothing to rank against)', async () => {
  const alwaysFails = async () => { throw new Error('boom'); };
  await assert.rejects(() => semanticSearch('query', [{ path: 'a.md', body: 'x' }], { embedFn: alwaysFails }));
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

// Found live the first time tier 1 actually ran: `qmd search` (no query
// expansion -- that is the multi-GB model this integration avoids) returned []
// for a natural-language query the hybrid tier answers well, and the ladder
// presented "(qmd)" with zero results as the final answer. From an optional
// accelerator, an empty answer is not an answer.
test('search: an empty qmd result set falls through to the next tier instead of answering with nothing', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    qmdProbe: () => true,
    qmdRun: async () => [],
    ollamaAvailable: async () => true,
    semanticRun: async () => [{ path: 's.md', score: 0.9 }],
  });
  assert.equal(r.tier, 'hybrid', 'zero qmd hits must not preempt a tier that can answer');
  assert.deepEqual(new Set(r.results.map((x) => x.path)), new Set(['k.md', 's.md']));
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

// Real shape, confirmed live against `qmd search "..." --json` (not guessed from
// docs): a bare JSON array of {docid, score, file: "qmd://<collection>/<path>",
// line, title, snippet}. This fixture is the actual output captured during
// implementation (collection name substituted for "wiki-master").
const REAL_QMD_OUTPUT = JSON.stringify([
  {
    docid: '#461bef',
    score: 0.44,
    file: 'qmd://wiki-master/wiki/sources/Provenance.md',
    line: 2,
    title: 'Provenance',
    snippet: '@@ -1,3 @@ (0 before, 0 after)\n# Provenance\n...',
  },
]);

test('qmdSearch strips the qmd://<collection>/ URI prefix down to a vault-relative path', () => {
  const results = qmdSearch('provenance', { execImpl: () => REAL_QMD_OUTPUT });
  assert.deepEqual(results, [{ path: 'wiki/sources/Provenance.md', score: 0.44 }]);
});

test('qmdSearch invokes `qmd search` (never `query`/`vsearch`) to avoid their multi-GB model downloads', () => {
  let calledWith = '';
  qmdSearch('provenance', { execImpl: (cmd) => { calledWith = cmd; return '[]'; } });
  assert.match(calledWith, /^qmd search /, 'must use the lightweight `search` subcommand');
  assert.doesNotMatch(calledWith, /qmd (query|vsearch)/);
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

test('qmdSearch drops entries with no usable file field rather than returning a garbage path', () => {
  const malformed = JSON.stringify([{ docid: '#x', score: 0.1 }]); // no `file` field
  const results = qmdSearch('q', { execImpl: () => malformed });
  assert.deepEqual(results, []);
});

// Found live under the documented setup (`qmd collection add <vault>/wiki`):
// qmd's file URIs are COLLECTION-relative, so hits come back as
// "qmd://wiki-master/sources/X.md" -- missing the wiki/ prefix every other
// tier's vault-relative paths carry. The 0.7.0 fixture above was captured from
// a vault-rooted collection, which masked this; both roots must normalize to
// the same vault-relative shape.
// Found live: qmd slugifies filenames inside its URIs -- "Foale — A
// Listener-Centred Approach.md" comes back as "Foale-A-Listener-Centred-
// Approach.md", a path that does not exist on disk. Punctuation runs (spaces,
// em-dashes, commas) collapse to single hyphens, so naive reversal is
// ambiguous (real filenames legitimately contain hyphens); the only safe
// mapping is resolving against the actual vault file list.
test('qmdSearch resolves slugified qmd filenames back to the real on-disk vault paths', () => {
  const vaultFiles = [
    'wiki/sources/Foale — A Listener-Centred Approach.md',
    'wiki/concepts/Second Brain.md',
    'wiki/syntheses/bid-master-dq-md.md', // real hyphens: must map to itself
  ];
  const hits = JSON.stringify([
    { docid: '#a', score: 0.9, file: 'qmd://wiki-master/sources/Foale-A-Listener-Centred-Approach.md' },
    { docid: '#b', score: 0.8, file: 'qmd://wiki-master/concepts/Second-Brain.md' },
    { docid: '#c', score: 0.7, file: 'qmd://wiki-master/syntheses/bid-master-dq-md.md' },
    { docid: '#d', score: 0.6, file: 'qmd://wiki-master/concepts/Not-In-The-Vault.md' },
  ]);
  const results = qmdSearch('q', { execImpl: () => hits, vaultFiles });
  assert.deepEqual(results.map((r) => r.path), [
    'wiki/sources/Foale — A Listener-Centred Approach.md',
    'wiki/concepts/Second Brain.md',
    'wiki/syntheses/bid-master-dq-md.md',
    'wiki/concepts/Not-In-The-Vault.md', // unresolvable: passed through, not dropped
  ]);
});

test('qmdSearch normalizes collection-relative hits to vault-relative wiki/ paths', () => {
  const collectionRelative = JSON.stringify([
    { docid: '#a', score: 0.85, file: 'qmd://wiki-master/sources/Some Source.md' },
    { docid: '#b', score: 0.8, file: 'qmd://wiki-master/concepts/Some Concept.md' },
  ]);
  const results = qmdSearch('q', { execImpl: () => collectionRelative });
  assert.deepEqual(results.map((r) => r.path),
    ['wiki/sources/Some Source.md', 'wiki/concepts/Some Concept.md']);
});
