import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, computeGraphMetrics, isStub } from '../scripts/lib/graph.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'vault');

// The fixture encodes the live-vault bugs on purpose:
//  - index.md links EVERY page (the catalog state that used to rescue orphans)
//  - alpha and orphan-entity are linked ONLY from index.md
//  - hub-stub has 5 inbound links from content pages and declares status: stub
//  - gamma carries a broken [[nonexistent-page]] wikilink
//  - raw/clippings/noisy-toc.md carries a broken wikilink that must NOT count
//  - raw/clippings/{unparsed-clip,noisy-toc}.md are cited by nothing

test('buildGraph walks the vault and attributes every edge to its source', () => {
  const g = buildGraph(FIXTURE);
  assert.ok(g.pages.length >= 13, `expected >=13 pages, got ${g.pages.length}`);
  const gamma = g.pages.find((p) => p.path === 'wiki/concepts/gamma.md');
  assert.ok(gamma, 'gamma page present');
  assert.ok(gamma.outTargets.includes('nonexistent-page'), 'edge targets carry link names');
  assert.equal(gamma.status, 'maintained', 'frontmatter status parsed');
});

test('links from structural files do not rescue orphans (the #2 bug)', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  // index.md links orphan-entity; no content page does. (alpha is linked by
  // the root pages, which count as inbound even though roots themselves are
  // exempt from orphan candidacy.)
  assert.deepEqual(m.orphans, ['wiki/entities/orphan-entity.md'],
    'index-only-linked pages are orphans');
});

test('body links only: frontmatter provenance cites do not hide dead-ends', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  // beta has sources: ["[[source-a]]"] in frontmatter but no body links.
  assert.deepEqual(
    m.deadEnds.sort(),
    ['wiki/concepts/beta.md', 'wiki/entities/orphan-entity.md', 'wiki/syntheses/hub-stub.md']
  );
});

test('broken links are source-attributed and raw/ sources are excluded (the #7 bug)', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.deepEqual(
    m.brokenLinks.sort((a, b) => a.source.localeCompare(b.source)),
    [
      { source: 'wiki/concepts/gamma.md', target: 'nonexistent-page' },
      { source: 'wiki/syntheses/hub-stub.md', target: 'gone-source' },
    ]
  );
  // noisy-toc.md's [[missing-from-raw]] must not appear anywhere in the result.
  assert.ok(!JSON.stringify(m.brokenLinks).includes('missing-from-raw'));
});

test('hub-stub detection reads status: stub from frontmatter (the #3 bug)', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.deepEqual(m.hubStubs, ['wiki/syntheses/hub-stub.md']);
});

test('isStub honors declared status regardless of word count', () => {
  // The live-vault failure: 26-38 word entity stubs under a 10-word floor.
  assert.equal(isStub({ status: 'stub', words: 38 }), true, 'declared stub, 38 words');
  assert.equal(isStub({ status: 'maintained', words: 3 }), true, 'undeclared but thin');
  assert.equal(isStub({ status: 'maintained', words: 50 }), false);
});

test('declared stubs are visible even when they are not hubs', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  // orphan-entity declares status: stub with 1 inbound — never a hub-stub,
  // but "the vault knows it is a stub" must be surfaced somewhere.
  assert.ok(m.declaredStubs.includes('wiki/entities/orphan-entity.md'));
  assert.ok(m.declaredStubs.includes('wiki/syntheses/hub-stub.md'));
});

test('unparsed raw sources are reported as a visible bucket', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.deepEqual(
    m.unparsedSources.sort(),
    ['raw/clippings/noisy-toc.md', 'raw/clippings/unparsed-clip.md'],
    'raw files cited by no content page are surfaced, not hidden'
  );
});

test('frontmatter provenance cites count as citation, not navigation', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  // source-b is cited ONLY in beta's frontmatter sources: — it is parsed.
  assert.ok(!m.unparsedSources.includes('raw/sources/source-b.md'),
    'fm-only-cited raw source is not unparsed');
  // ...but the fm cite does not save beta from being a dead-end (navigation).
  assert.ok(m.deadEnds.includes('wiki/concepts/beta.md'));
});

test('root pages (syntheses, MOCs) are not orphan candidates', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  // Both have zero inbound links and are linked only from index.md — their
  // natural state as cluster entry points. Neither may be called an orphan.
  assert.ok(!m.orphans.includes('wiki/syntheses/root-synthesis.md'));
  assert.ok(!m.orphans.includes('moc/audio-moc.md'));
  // They still participate in every other metric (their alpha links count).
  const alphaIn = m.orphans.includes('wiki/concepts/alpha.md');
  assert.equal(alphaIn, false, 'alpha now has inbound from the roots');
});

test('a broken frontmatter provenance cite is a real, attributed defect', () => {
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  assert.ok(m.brokenLinks.some(
    (b) => b.source === 'wiki/syntheses/hub-stub.md' && b.target === 'gone-source'
  ), 'provenance pointing nowhere is reported with its source');
});
