import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planClippingDedupe, existingClippingWithHash } from '../scripts/lib/dedupe.mjs';

// A re-clip pass that does not check for existing content writes a second file
// for a source the vault already holds. The duplicate is byte-identical by
// construction (same source-hash) and uncited, so it shows up as "unparsed raw
// sources" forever. Removing it is safe ONLY when the group has a clear keeper.

const clip = (path, sourceHash) => ({ path, sourceHash });

test('removes the uncited twin and keeps the cited original', () => {
  const pages = [clip('raw/clippings/A.md', 'h1'), clip('raw/clippings/A-abc1234.md', 'h1')];
  const r = planClippingDedupe(pages, (p) => p === 'raw/clippings/A.md');
  assert.deepEqual(r.remove, ['raw/clippings/A-abc1234.md']);
  assert.deepEqual(r.refused, []);
});

test('removes every uncited copy in a group of three', () => {
  const pages = ['raw/clippings/A.md', 'raw/clippings/A-abc1234.md', 'raw/clippings/A-abc1234-2.md'].map((p) => clip(p, 'h1'));
  const r = planClippingDedupe(pages, (p) => p === 'raw/clippings/A.md');
  assert.deepEqual(r.remove.sort(), ['raw/clippings/A-abc1234-2.md', 'raw/clippings/A-abc1234.md']);
});

// The vault deliberately holds several byte-identical clippings when a paper was
// bookmarked more than once (separate Academia.edu uploads), and the summary
// documents that in a dedup note by citing all of them. Never silently undo it.
test('refuses a group where every copy is cited', () => {
  const pages = [clip('raw/clippings/A.md', 'h1'), clip('raw/clippings/A (1).md', 'h1')];
  const r = planClippingDedupe(pages, () => true);
  assert.deepEqual(r.remove, []);
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0].reason, /every copy is cited/);
});

test('refuses a group where no copy is cited — there is no keeper to prove correct', () => {
  const pages = [clip('raw/clippings/A.md', 'h1'), clip('raw/clippings/A-abc1234.md', 'h1')];
  const r = planClippingDedupe(pages, () => false);
  assert.deepEqual(r.remove, []);
  assert.match(r.refused[0].reason, /no copy is cited/);
});

test('ignores clippings whose hash is unique', () => {
  const pages = [clip('raw/clippings/A.md', 'h1'), clip('raw/clippings/B.md', 'h2')];
  assert.deepEqual(planClippingDedupe(pages, () => false).remove, []);
});

test('ignores clippings carrying no hash — nothing proves them identical', () => {
  const pages = [clip('raw/clippings/A.md', null), clip('raw/clippings/B.md', undefined)];
  const r = planClippingDedupe(pages, () => false);
  assert.deepEqual(r.remove, []);
  assert.deepEqual(r.refused, []);
});

// The guard that stops the duplicate being written at all. The previous defense
// keyed on the BINARY'S PATH, so moving the binaries out of the vault defeated
// it and a whole re-clip pass duplicated content the vault already held. Content
// hash is the location-independent identity — the same lesson the ingest-state
// join already learned.
const held = [
  { file: 'raw/clippings/A.md', hash: 'abc1234' },
  { file: 'raw/clippings/B.md', hash: 'def5678' },
];

test('existingClippingWithHash finds content the vault already holds', () => {
  assert.equal(existingClippingWithHash(held, 'def5678'), 'raw/clippings/B.md');
});

test('existingClippingWithHash matches regardless of hash case', () => {
  assert.equal(existingClippingWithHash(held, 'ABC1234'), 'raw/clippings/A.md');
});

test('existingClippingWithHash returns null for content not yet held', () => {
  assert.equal(existingClippingWithHash(held, '9999999'), null);
});

test('existingClippingWithHash never matches on a missing hash', () => {
  assert.equal(existingClippingWithHash([{ file: 'raw/clippings/C.md', hash: null }], null), null,
    'two unknowns are not the same content');
  assert.equal(existingClippingWithHash(held, ''), null);
});

test('is convergent: re-planning after the removal is a no-op', () => {
  const pages = [clip('raw/clippings/A.md', 'h1'), clip('raw/clippings/A-abc1234.md', 'h1')];
  const isCited = (p) => p === 'raw/clippings/A.md';
  const first = planClippingDedupe(pages, isCited);
  const after = pages.filter((p) => !first.remove.includes(p.path));
  assert.deepEqual(planClippingDedupe(after, isCited).remove, []);
});
