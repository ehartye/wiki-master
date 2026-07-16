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
