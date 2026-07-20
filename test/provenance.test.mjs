import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, computeGraphMetrics } from '../scripts/lib/graph.mjs';
import { computeHealth } from '../scripts/health.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'vault');

// Two distinct binary facts about a raw source, deliberately kept apart:
//
//   unparsed      — nothing in the wiki cites it at all.
//   unsummarized  — no wiki/sources page cites it, so no summary exists.
//
// The vault contract defines ingest exactly: it writes wiki/sources/<slug>.md
// carrying `sources: [[raw link]]`. A concept page citing a clipping in its own
// provenance frontmatter is a real citation (so the source is parsed) but does
// NOT mean it was ever summarized. Collapsing the two hid that case entirely.

test('a raw source cited only by a concept page is NOT ingested', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  // source-b is cited by wiki/concepts/beta.md and by nothing under wiki/sources/.
  assert.ok(
    m.unsummarizedSources.includes('raw/sources/source-b.md'),
    'an incidental concept-page mention must not mask a missing summary'
  );
});

test('a raw source with a wiki/sources summary IS ingested', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.ok(
    !m.unsummarizedSources.includes('raw/sources/source-a.md'),
    'source-a has wiki/sources/source-a-summary.md citing it'
  );
});

test('never-cited clippings remain unparsed', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.ok(m.unsummarizedSources.includes('raw/clippings/unparsed-clip.md'));
  assert.ok(m.unsummarizedSources.includes('raw/clippings/noisy-toc.md'));
});

test('a wiki/sources page that cites no raw file is a provenance gap', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.ok(
    m.provenanceGaps.includes('wiki/sources/no-provenance.md'),
    'a source page with no raw citation breaks the provenance contract'
  );
  assert.ok(
    !m.provenanceGaps.includes('wiki/sources/source-a-summary.md'),
    'a source page citing a real raw file is fine'
  );
});

test('provenance gaps are scored as defects, not filed as informational', () => {
  const clean = computeHealth({
    orphans: [],
    deadEnds: [],
    brokenLinks: [],
    hubStubs: [],
    provenanceGaps: [],
  });
  const gapped = computeHealth({
    orphans: [],
    deadEnds: [],
    brokenLinks: [],
    hubStubs: [],
    provenanceGaps: ['wiki/sources/no-provenance.md'],
  });
  assert.equal(clean.score, 100);
  assert.ok(gapped.score < clean.score, 'an unciteable source page must cost score');
  assert.match(gapped.report, /provenance gaps: 1/);
});

test('the health report states the ingest backlog without euphemism', () => {
  const r = computeHealth(computeGraphMetrics(buildGraph(FIXTURE)));
  assert.match(r.report, /not ingested/, 'the report says what the number means');
});

test('an explicit `sources: []` is a disclosure, not a defect', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.ok(
    !m.provenanceGaps.includes('wiki/sources/declared-no-provenance.md'),
    'deliberately declaring no provenance must not be scored as a broken contract'
  );
  assert.ok(
    m.declaredNoProvenance.includes('wiki/sources/declared-no-provenance.md'),
    'but it must stay visible — silent and declared are different states'
  );
});

test('omitting `sources:` entirely is still a defect', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.ok(
    m.provenanceGaps.includes('wiki/sources/no-provenance.md'),
    'a page with no sources key at all has not disclosed anything'
  );
});
