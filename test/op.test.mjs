import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirtySet, deltaPaths } from '../scripts/lib/op.mjs';

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
