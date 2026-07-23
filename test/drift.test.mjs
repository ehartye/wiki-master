import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDrift } from '../scripts/drift.mjs';

// Fake embedder: map known strings to vectors so cosine is predictable.
const vectors = {
  'alpha body about neural scaling': [1, 0, 0],
  'source about neural scaling': [1, 0.05, 0],       // aligned -> not drifted
  'beta body about cooking recipes': [0, 1, 0],
  'source about neural scaling networks': [1, 0, 0], // orthogonal -> drifted
};
const fakeEmbed = async (t) => vectors[t] ?? [0, 0, 1];

test('computeDrift flags pages whose body diverges from their sources', async () => {
  const pages = [
    { path: 'alpha.md', body: 'alpha body about neural scaling',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling' }] },
    { path: 'beta.md', body: 'beta body about cooking recipes',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling networks' }] },
  ];
  const r = await computeDrift(pages, { embedFn: fakeEmbed, threshold: 0.5 });
  assert.deepEqual(r.drifted.map((d) => d.path), ['beta.md']);
  assert.equal(r.skipped, false);
});

test('computeDrift skips pages with no sources', async () => {
  const r = await computeDrift([{ path: 'x.md', body: 'x', sources: [] }], { embedFn: fakeEmbed });
  assert.deepEqual(r.drifted, []);
  assert.deepEqual(r.evaluated, []);
});

// search.mjs got this guard when the context-window 500 was found live;
// computeDrift never did -- one oversized page (or raw source, typically even
// longer) crashed the entire drift run. A failed page is recorded, not fatal,
// and never silent.
test('computeDrift records a page whose body embedding fails and still evaluates the rest', async () => {
  const failsOn = async (t) => {
    if (t === 'oversized body') throw new Error('Ollama embeddings HTTP 500');
    return fakeEmbed(t);
  };
  const pages = [
    { path: 'big.md', body: 'oversized body',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling' }] },
    { path: 'alpha.md', body: 'alpha body about neural scaling',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling' }] },
  ];
  const r = await computeDrift(pages, { embedFn: failsOn, threshold: 0.5 });
  assert.deepEqual(r.evaluated.map((e) => e.path), ['alpha.md'], 'the healthy page is still evaluated');
  assert.deepEqual(r.failed.map((f) => f.path), ['big.md'], 'the failing page is recorded, not fatal');
});

test('computeDrift records a page whose SOURCE embedding fails (raw sources run longest)', async () => {
  const failsOn = async (t) => {
    if (t === 'oversized raw source') throw new Error('Ollama embeddings HTTP 500');
    return fakeEmbed(t);
  };
  const pages = [
    { path: 'alpha.md', body: 'alpha body about neural scaling',
      sources: [{ path: 'huge-source.md', content: 'oversized raw source' }] },
  ];
  const r = await computeDrift(pages, { embedFn: failsOn, threshold: 0.5 });
  assert.deepEqual(r.evaluated, []);
  assert.deepEqual(r.failed.map((f) => f.path), ['alpha.md']);
});
