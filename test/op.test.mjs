import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirtySet, deltaPaths } from '../scripts/lib/op.mjs';
import { refreshAfterOp } from '../scripts/op-commit.mjs';

// Porcelain lines are fixed-width `XY <path>` and the leading space in " M path"
// is meaningful. A blanket trim eats it and shifts every column — this exact bug
// shipped once in lib/git.mjs before being caught.
test('dirtySet parses porcelain without eating the leading status column', () => {
  const out = dirtySet(' M wiki/a.md\n?? wiki/b.md\nA  wiki/c.md\n');
  assert.deepEqual([...out].sort(), ['wiki/a.md', 'wiki/b.md', 'wiki/c.md']);
});

test('dirtySet strips the quote pair git adds around non-ASCII paths', () => {
  assert.deepEqual([...dirtySet(' M "Gottman — R.md"\n')], ['Gottman — R.md']);
});

test('dirtySet on a clean tree is empty', () => {
  assert.deepEqual([...dirtySet('')], []);
});

// The whole point: work the user already had in flight is never attributed to
// the operation.
test('deltaPaths excludes what was already dirty', () => {
  const before = new Set(['wiki/draft.md']);
  const after = new Set(['wiki/draft.md', 'wiki/new.md']);
  assert.deepEqual(deltaPaths(before, after), ['wiki/new.md']);
});

test('deltaPaths is sorted, for the same cross-machine reason planPurge sorts', () => {
  const r = deltaPaths(new Set(), new Set(['wiki/b.md', 'wiki/a.md']));
  assert.deepEqual(r, ['wiki/a.md', 'wiki/b.md']);
});

test('deltaPaths on no change is empty', () => {
  assert.deepEqual(deltaPaths(new Set(['x']), new Set(['x'])), []);
});

// refreshAfterOp's contract is that it "is never silent -- a silently stale
// index is precisely the failure mode the 0.11.0 search-health work exists to
// prevent". A partial build broke exactly that: the op-commit tail was the only
// place the degradation surfaced, and it printed the same clean-looking notice
// whether or not chunks had failed (#70).
test('refreshAfterOp reports an incomplete index build rather than a clean-looking notice', async () => {
  const partial = {
    filesChanged: 3, chunksEmbedded: 110, chunksTotal: 113, chunksPruned: 0,
    chunksFailed: 3, failures: [{ hash: 'abcdef0123456789', chars: 6489, error: 'Ollama embeddings HTTP 500 -- the input length exceeds the context length' }],
    elapsedMs: 1000,
  };
  const r = await refreshAfterOp('/x', {
    readManifestImpl: () => ({ 'wiki/a.md': {} }),
    isAvailableImpl: async () => true,
    modelPresentImpl: async () => true,
    refreshImpl: async () => partial,
  });
  assert.equal(r.refreshed, true);
  assert.match(r.notice, /3 chunk\(s\) failed/i, 'the failure count reaches the notice');

  // A complete build stays exactly as terse as it was.
  const clean = await refreshAfterOp('/x', {
    readManifestImpl: () => ({ 'wiki/a.md': {} }),
    isAvailableImpl: async () => true,
    modelPresentImpl: async () => true,
    refreshImpl: async () => ({ ...partial, chunksFailed: 0, failures: [] }),
  });
  assert.doesNotMatch(clean.notice, /failed/i);
});
