import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeHealth, isContent } from '../scripts/health.mjs';
import { buildGraph, computeGraphMetrics } from '../scripts/lib/graph.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'vault');

// End-to-end over the real fixture vault: collection + scoring together.
// The fixture's index.md links every page, so any regression back toward
// "index rescues orphans" fails these tests immediately.
test('health end-to-end: fixture vault scores below 100 with attributed findings', () => {
  const r = computeHealth(computeGraphMetrics(buildGraph(FIXTURE)));
  // Broken links are triaged: the fixture's 2 are deferred forward-links (no
  // near-match, and no `now` passed so none can be proven stale) → 0 penalty.
  // orphans 1*2 + deadEnds 3*2 + hubStubs 1*5 + provenanceGaps 1*4 = 17.
  // The provenance gap is wiki/sources/no-provenance.md: a source page citing no
  // raw/ file, which claims an ingest while leaving its clipping
  // indistinguishable from one never processed.
  assert.equal(r.score, 83);
  assert.equal(r.brokenLinks.length, 2);
  assert.equal(r.brokenClass.deferred.length, 2, 'both broken links classify as deferred');
  assert.equal(r.brokenClass.defects.length, 0);
  assert.ok(r.report.includes('deferred 2'), 'report shows the triage breakdown');
  assert.ok(r.brokenLinks.some((b) => b.source === 'wiki/concepts/gamma.md'));
  assert.equal(r.orphans.length, 1);
  assert.equal(r.deadEnds.length, 3);
  assert.deepEqual(r.hubStubs, ['wiki/syntheses/hub-stub.md']);
  // Two separate facts: nothing cites unparsed-clip/noisy-toc at all, while
  // source-b is cited by a concept's provenance yet still has no summary page.
  assert.ok(r.report.includes('unparsed raw sources (nothing cites them): 2'));
  assert.ok(r.report.includes('not ingested (no wiki/sources page): 4'));
  assert.ok(r.unsummarizedSources.includes('raw/sources/source-b.md'));
  // A PDF attachment counts too: it is cited (so not "unparsed") but has no
  // summary page, so it is genuinely still owed one. Binary fact, no exemption.
  assert.ok(r.unsummarizedSources.includes('raw/sources/paper.pdf'));
  assert.deepEqual(r.provenanceGaps, ['wiki/sources/no-provenance.md']);
  assert.ok(r.report.includes('<- wiki/concepts/gamma.md'), 'report attributes broken links');
});

test('computeHealth returns a bounded 0-100 score', () => {
  const r = computeHealth({
    orphans: Array(40).fill('x.md'),
    deadEnds: Array(40).fill('x.md'),
    brokenLinks: Array(40).fill({ source: 'a.md', target: 'b' }),
    hubStubs: Array(40).fill('x.md'),
  });
  assert.equal(r.score, 10); // caps: 30+25+20+15 = 90
});

test('computeHealth returns 100 for a clean vault', () => {
  const r = computeHealth({ orphans: [], deadEnds: [], brokenLinks: [], hubStubs: [] });
  assert.equal(r.score, 100);
});

test('isContent excludes structural/system/raw files, includes wiki notes', () => {
  for (const p of ['index.md', 'log.md', 'vault-schema.md', '_templates/source-note.md',
                   'stale.base', 'raw/clippings/foo.md'])
    assert.equal(isContent(p), false, `${p} should be non-content`);
  for (const p of ['wiki/concepts/alpha.md', 'wiki/sources/bar.md', 'moc/topic.md'])
    assert.equal(isContent(p), true, `${p} should be content`);
});
