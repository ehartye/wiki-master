import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStale } from '../scripts/stale.mjs';

const today = new Date('2026-07-15');
const pages = [
  { path: 'alpha.md', reviewed: '2026-07-10', updated: '2026-07-10' }, // 5d fresh
  { path: 'beta.md', reviewed: '2026-01-05', updated: '2026-01-05' },  // ~191d rotten
  { path: 'gamma.md', reviewed: '2026-06-01', updated: '2026-06-20' }, // uses max -> 25d fresh
  { path: 'delta.md', reviewed: '2026-05-01', updated: '2026-05-01' }, // ~75d aging
  { path: 'eps.md', reviewed: '2026-03-01', updated: '2026-03-01' },   // ~136d stale
];

test('computeStale buckets by days since max(reviewed, updated)', () => {
  const r = computeStale(pages, { today });
  assert.deepEqual(r.buckets.fresh.map((p) => p.path).sort(), ['alpha.md', 'gamma.md']);
  assert.deepEqual(r.buckets.aging.map((p) => p.path), ['delta.md']);
  assert.deepEqual(r.buckets.stale.map((p) => p.path), ['eps.md']);
  assert.deepEqual(r.buckets.rotten.map((p) => p.path), ['beta.md']);
});

test('computeStale treats missing dates as rotten', () => {
  const r = computeStale([{ path: 'x.md' }], { today });
  assert.deepEqual(r.buckets.rotten.map((p) => p.path), ['x.md']);
});
