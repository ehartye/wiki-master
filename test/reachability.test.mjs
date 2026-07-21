import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGraphMetrics } from '../scripts/lib/graph.mjs';

// `provenanceGaps` only ever audited wiki/sources/, so ~90% of the vault — every
// concept, entity and synthesis — could rest on nothing at all and still score a
// clean 100. This measures the property that actually matters for finding things:
// can the page be walked back to raw/ ? It is deliberately channel-agnostic —
// frontmatter `sources:` and body wikilinks are the same edge to Obsidian's link
// graph, so demanding one or the other would enforce style, not provenance.

const pg = (path, links = [], extra = {}) => ({
  path, name: (path.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase(),
  title: path, words: 50, outTargets: links, fmTargets: [], ...extra,
});

test('a concept reaching raw/ through a source page is not flagged', () => {
  const m = computeGraphMetrics({ pages: [
    pg('raw/clippings/Foo.md'),
    pg('wiki/sources/Foo Summary.md', [], { fmTargets: ['raw/clippings/Foo.md'] }),
    pg('wiki/concepts/Bar.md', ['Foo Summary']),
  ] });
  assert.deepEqual(m.unreachableProvenance, []);
});

test('a concept that reaches no evidence at all is flagged', () => {
  const m = computeGraphMetrics({ pages: [
    pg('wiki/concepts/Bar.md', ['Baz']),
    pg('wiki/concepts/Baz.md'),
  ] });
  assert.ok(m.unreachableProvenance.includes('wiki/concepts/Bar.md'));
  assert.ok(m.unreachableProvenance.includes('wiki/concepts/Baz.md'));
});

// Sideways is not provenance: a chain of concepts citing each other never reaches
// evidence, however long it is.
test('concepts citing only other concepts do not launder each other into provenance', () => {
  const m = computeGraphMetrics({ pages: [
    pg('raw/clippings/Foo.md'),
    pg('wiki/concepts/A.md', ['B']),
    pg('wiki/concepts/B.md', ['C']),
    pg('wiki/concepts/C.md', ['Foo']),
  ] });
  assert.ok(m.unreachableProvenance.includes('wiki/concepts/A.md'), 'A only reaches raw via two concepts');
  assert.ok(m.unreachableProvenance.includes('wiki/concepts/B.md'));
  assert.ok(!m.unreachableProvenance.includes('wiki/concepts/C.md'), 'C cites raw directly');
});

test('the frontmatter channel counts exactly as much as the body channel', () => {
  const viaBody = computeGraphMetrics({ pages: [
    pg('raw/clippings/Foo.md'), pg('wiki/concepts/Bar.md', ['Foo']),
  ] });
  const viaFm = computeGraphMetrics({ pages: [
    pg('raw/clippings/Foo.md'), pg('wiki/concepts/Bar.md', [], { fmTargets: ['Foo'] }),
  ] });
  assert.deepEqual(viaBody.unreachableProvenance, []);
  assert.deepEqual(viaFm.unreachableProvenance, []);
});

// `sources: []` is the existing way a source page declares it rests on nothing.
// Extending it to every page type keeps a deliberate disclosure from being scored
// as a defect — penalizing disclosure only teaches authors to stop disclosing.
test('a page declaring `sources: []` is reported separately, not as a defect', () => {
  const m = computeGraphMetrics({ pages: [
    pg('wiki/concepts/Design Brief.md', [], { declaresNoSources: true }),
  ] });
  assert.deepEqual(m.unreachableProvenance, []);
  assert.deepEqual(m.declaredNoProvenance, ['wiki/concepts/Design Brief.md']);
});

// MOCs are navigational hubs by the vault contract — they route to pages that
// carry provenance and are not expected to carry it themselves.
test('a MOC is never flagged for unreachable provenance', () => {
  const m = computeGraphMetrics({ pages: [pg('moc/Topic.md', ['Nowhere'])] });
  assert.deepEqual(m.unreachableProvenance, []);
});

// Source pages keep the STRICTER rule: a summary must cite its own clipping, not
// borrow reachability from a neighbour it happens to link.
test('a source page citing another source page is still a provenance gap', () => {
  const m = computeGraphMetrics({ pages: [
    pg('raw/clippings/Foo.md'),
    pg('wiki/sources/Foo Summary.md', [], { fmTargets: ['raw/clippings/Foo.md'] }),
    pg('wiki/sources/Borrower.md', ['Foo Summary']),
  ] });
  assert.ok(m.provenanceGaps.includes('wiki/sources/Borrower.md'), 'must cite its own raw');
  assert.ok(!m.unreachableProvenance.includes('wiki/sources/Borrower.md'), 'not double-counted');
});
