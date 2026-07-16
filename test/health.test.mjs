import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealth, parseListOutput, isContent } from '../scripts/health.mjs';

// Injected raw CLI data mirroring the fixture vault.
const deps = {
  orphans: ['wiki/entities/orphan-entity.md'],
  deadEnds: ['wiki/concepts/beta.md', 'wiki/entities/orphan-entity.md'],
  brokenLinks: [],
  backlinkCounts: {
    'wiki/concepts/alpha.md': 1,
    'wiki/concepts/beta.md': 1,
    'wiki/syntheses/hub-stub.md': 8,
    'wiki/entities/orphan-entity.md': 0,
  },
  wordCounts: {
    'wiki/concepts/alpha.md': 20,
    'wiki/concepts/beta.md': 18,
    'wiki/syntheses/hub-stub.md': 1,
    'wiki/entities/orphan-entity.md': 6,
  },
};

test('computeHealth flags the seeded orphan, dead-ends, and hub-stub', () => {
  const r = computeHealth(deps);
  assert.deepEqual(r.orphans, ['wiki/entities/orphan-entity.md']);
  assert.equal(r.deadEnds.length, 2);
  assert.deepEqual(r.hubStubs, ['wiki/syntheses/hub-stub.md']);
  assert.equal(r.brokenLinks.length, 0);
});

test('computeHealth returns a bounded 0-100 score below 100 when issues exist', () => {
  const r = computeHealth(deps);
  assert.ok(r.score < 100 && r.score >= 0);
});

test('computeHealth returns 100 for a clean vault', () => {
  const r = computeHealth({
    orphans: [], deadEnds: [], brokenLinks: [],
    backlinkCounts: { 'a.md': 1, 'b.md': 1 },
    wordCounts: { 'a.md': 50, 'b.md': 50 },
  });
  assert.equal(r.score, 100);
  assert.deepEqual(r.hubStubs, []);
});

test('parseListOutput drops the CLI "No ... found" empty-message', () => {
  assert.deepEqual(parseListOutput('\nNo unresolved links found.'), []);
  assert.deepEqual(parseListOutput('No orphans found.'), []);
  assert.deepEqual(
    parseListOutput('\nwiki/concepts/a.md\nwiki/concepts/b.md'),
    ['wiki/concepts/a.md', 'wiki/concepts/b.md']
  );
});

test('isContent excludes structural/system files, includes wiki notes', () => {
  for (const p of ['index.md', 'log.md', 'vault-schema.md', '_templates/source-note.md', 'stale.base'])
    assert.equal(isContent(p), false, `${p} should be non-content`);
  for (const p of ['wiki/concepts/alpha.md', 'raw/clippings/foo.md'])
    assert.equal(isContent(p), true, `${p} should be content`);
});
