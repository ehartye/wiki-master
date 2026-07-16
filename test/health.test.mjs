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
  // broken 2*3 + orphans 1*2 + deadEnds 3*2 + hubStubs 1*5 = 19
  assert.equal(r.score, 81);
  assert.equal(r.brokenLinks.length, 2);
  assert.ok(r.brokenLinks.some((b) => b.source === 'wiki/concepts/gamma.md'));
  assert.equal(r.orphans.length, 1);
  assert.equal(r.deadEnds.length, 3);
  assert.deepEqual(r.hubStubs, ['wiki/syntheses/hub-stub.md']);
  assert.ok(r.report.includes('unparsed raw sources (not scored): 2'));
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
