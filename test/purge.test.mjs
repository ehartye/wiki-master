import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStructural, inboundMap, planPurge } from '../scripts/lib/purge.mjs';
import { buildNameIndex } from '../scripts/lib/graph.mjs';

// Structural pages link everything (index.md catalogs the vault; a MOC exists to
// point at pages). If they counted as "an outside page references this", nothing
// would ever qualify for the closure and purge would only ever move its seeds.
test('isStructural covers the catalog, MOCs, the log and templates', () => {
  assert.equal(isStructural('index.md'), true);
  assert.equal(isStructural('log.md'), true);
  assert.equal(isStructural('vault-schema.md'), true);
  assert.equal(isStructural('moc/audio-moc.md'), true);
  assert.equal(isStructural('log/2026-08-08-120000-ingest-foo.md'), true);
  assert.equal(isStructural('_templates/source-note.md'), true);
});

test('isStructural excludes real content and evidence', () => {
  assert.equal(isStructural('wiki/concepts/Alpha.md'), false);
  assert.equal(isStructural('raw/clippings/Src-abc1234.md'), false);
  assert.equal(isStructural('raw/attachments/fig-9f8e7d6.png'), false);
});

test('inboundMap credits a body link to its target, following nav resolution', () => {
  const pages = [
    { path: 'wiki/concepts/A.md', name: 'a', outTargets: ['B'], fmTargets: [] },
    { path: 'wiki/concepts/B.md', name: 'b', outTargets: [], fmTargets: [] },
  ];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('wiki/concepts/B.md')], ['wiki/concepts/A.md']);
  assert.deepEqual([...inbound.get('wiki/concepts/A.md')], []);
});

test('inboundMap credits a frontmatter sources: link to the raw clipping it cites', () => {
  const pages = [
    { path: 'wiki/sources/S.md', name: 's', outTargets: [], fmTargets: ['raw/clippings/Src-abc1234.md'] },
    { path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', outTargets: [], fmTargets: [] },
  ];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('raw/clippings/Src-abc1234.md')], ['wiki/sources/S.md']);
});

// A page linking to itself must not make itself look externally referenced.
test('inboundMap ignores self-links', () => {
  const pages = [{ path: 'wiki/concepts/A.md', name: 'a', outTargets: ['A'], fmTargets: [] }];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('wiki/concepts/A.md')], []);
});

// nav and provenance diverge only on a bare name colliding across the
// content/evidence line — the one case the two channels exist for.
// Page order is load-bearing: buildNameIndex is first-writer-wins on the plain
// key while the nav key upgrades to content, so the clipping must precede the
// source page or the two channels resolve to the same target and never diverge.
test('each channel resolves by its own semantics on a colliding bare name', () => {
  const pages = [
    { path: 'raw/clippings/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'wiki/sources/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'wiki/concepts/Citer.md', name: 'citer', outTargets: ['Foo'], fmTargets: ['Foo'] },
  ];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('wiki/sources/Foo.md')], ['wiki/concepts/Citer.md'], 'body link navigates to the content page');
  assert.deepEqual([...inbound.get('raw/clippings/Foo.md')], ['wiki/concepts/Citer.md'], 'sources: link cites the clipping');
});

// isStructural excludes structural pages from the "is anything OUTSIDE the
// topic referencing this" test, but that filtering is the caller's job, not
// inboundMap's — inboundMap must record every edge, structural source or not,
// or a future refactor could quietly fold the filter in here and no test would notice.
test('inboundMap records edges from structural pages too (filtering is the caller\'s job)', () => {
  const pages = [
    { path: 'index.md', name: 'index', outTargets: ['A'], fmTargets: [] },
    { path: 'wiki/concepts/A.md', name: 'a', outTargets: [], fmTargets: [] },
  ];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('wiki/concepts/A.md')], ['index.md']);
});

// The shape a closure test needs: a topic cluster, a clipping shared with an
// off-topic page, a page outside the topic that links in, and an unrelated orphan.
function topicVault() {
  return [
    { path: 'index.md', name: 'index', outTargets: ['Topic Concept', 'Outside Page', 'Unrelated'], fmTargets: [] },
    { path: 'wiki/concepts/Topic Concept.md', name: 'topic concept', outTargets: [], fmTargets: ['raw/clippings/Only-aaa1111.md'] },
    { path: 'wiki/sources/Topic Source.md', name: 'topic source', outTargets: ['Topic Concept'], fmTargets: ['raw/clippings/Shared-bbb2222.md'] },
    { path: 'raw/clippings/Only-aaa1111.md', name: 'only-aaa1111', outTargets: [], fmTargets: [], sourceHash: 'aaa1111' },
    { path: 'raw/clippings/Shared-bbb2222.md', name: 'shared-bbb2222', outTargets: [], fmTargets: [], sourceHash: 'bbb2222' },
    { path: 'wiki/syntheses/Offtopic.md', name: 'offtopic', outTargets: [], fmTargets: ['raw/clippings/Shared-bbb2222.md'] },
    { path: 'wiki/concepts/Outside Page.md', name: 'outside page', outTargets: ['Topic Concept'], fmTargets: [] },
    { path: 'wiki/concepts/Unrelated.md', name: 'unrelated', outTargets: [], fmTargets: [] },
  ];
}

test('a clipping cited only by purged pages joins the set', () => {
  const r = planPurge({ pages: topicVault(), seedPaths: ['wiki/concepts/Topic Concept.md'] });
  assert.ok(r.purge.includes('raw/clippings/Only-aaa1111.md'));
});

// The destructive failure this whole rule exists to prevent.
test('a clipping shared with an off-topic page is NEVER purged', () => {
  const r = planPurge({
    pages: topicVault(),
    seedPaths: ['wiki/concepts/Topic Concept.md', 'wiki/sources/Topic Source.md'],
  });
  assert.ok(!r.purge.includes('raw/clippings/Shared-bbb2222.md'));
  assert.ok(!r.purge.includes('wiki/syntheses/Offtopic.md'));
});

test('a page linked from outside the set lands on collateral, not in the bin', () => {
  const r = planPurge({ pages: topicVault(), seedPaths: ['wiki/concepts/Topic Concept.md'] });
  assert.ok(!r.purge.includes('wiki/concepts/Outside Page.md'));
  // Two survivors, for different reasons, and BOTH are collateral:
  //   Outside Page  — links [[Topic Concept]] from outside the topic.
  //   Topic Source  — nothing links to it, so refs.length === 0 and it is never
  //                   admitted; but its body links [[Topic Concept]], which IS
  //                   purged, so it is left holding a dangling link.
  // Collateral is "survives but references purged content" — how a page came to
  // survive is irrelevant to whether it needs repair.
  assert.deepEqual(r.collateral, ['wiki/concepts/Outside Page.md', 'wiki/sources/Topic Source.md']);
});

// index.md links everything. If it counted as an outside referent the closure
// would never grow past its seeds; if it counted as collateral every purge would
// report the catalog as needing repair. It is regenerated, not repaired.
test('the catalog is neither a referent nor collateral', () => {
  const r = planPurge({ pages: topicVault(), seedPaths: ['wiki/concepts/Topic Concept.md'] });
  assert.ok(!r.collateral.includes('index.md'));
  assert.ok(!r.purge.includes('index.md'));
});

// A MOC is excluded from the REFERENT test (it links everything, so an edge from
// one proves nothing about topic membership) but must still appear as collateral:
// isContent('moc/x.md') is true, so health.mjs counts its broken links, and
// nothing regenerates a MOC the way index-gen.mjs regenerates the catalog. The
// log and templates stay out — the log is an immutable audit trail.
test('a MOC linking into the set is collateral; the catalog, log and templates are not', () => {
  const pages = [
    { path: 'index.md', name: 'index', outTargets: ['Topic'], fmTargets: [] },
    { path: 'moc/Topic MOC.md', name: 'topic moc', outTargets: ['Topic'], fmTargets: [] },
    { path: 'log/2026-08-08-120000-ingest-topic.md', name: '2026-08-08-120000-ingest-topic', outTargets: ['Topic'], fmTargets: [] },
    { path: 'wiki/concepts/Topic.md', name: 'topic', outTargets: [], fmTargets: [] },
  ];
  const r = planPurge({ pages, seedPaths: ['wiki/concepts/Topic.md'] });
  assert.deepEqual(r.collateral, ['moc/Topic MOC.md']);
});

// Guardrail #1: raw/ bodies are immutable, so a raw clipping citing a purged
// page is never ours to repair and must not be reported as repair work.
test('a raw clipping is never collateral', () => {
  const pages = [
    { path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', outTargets: ['Topic'], fmTargets: [], sourceHash: 'abc1234' },
    { path: 'wiki/concepts/Topic.md', name: 'topic', outTargets: [], fmTargets: [] },
  ];
  const r = planPurge({ pages, seedPaths: ['wiki/concepts/Topic.md'] });
  assert.deepEqual(r.collateral, []);
});

// A clipping's wikilink counts as an outside referent and protects its target.
// Deliberately NOT graph.mjs:309's source-side exclusion: an edge from immutable
// captured text is weak evidence, but ignoring it purges a page graph.mjs would
// have left alone — the over-match direction this design refuses. 78 of the 1100
// clippings in the live vault carry [[...]], so this is a real condition.
test('a raw clipping linking to a page protects it from the closure', () => {
  const pages = [
    { path: 'wiki/concepts/Seed.md', name: 'seed', outTargets: ['Length'], fmTargets: [] },
    { path: 'wiki/concepts/Length.md', name: 'length', outTargets: [], fmTargets: [] },
    { path: 'raw/clippings/Spec-abc1234.md', name: 'spec-abc1234', outTargets: ['Length'], fmTargets: [] },
  ];
  const r = planPurge({ pages, seedPaths: ['wiki/concepts/Seed.md'] });
  assert.ok(!r.purge.includes('wiki/concepts/Length.md'));
});

test('an unreferenced page unrelated to the topic is not swept in', () => {
  const r = planPurge({ pages: topicVault(), seedPaths: ['wiki/concepts/Topic Concept.md'] });
  assert.ok(!r.purge.includes('wiki/concepts/Unrelated.md'));
});

// Guardrail #2: a page whose entire provenance was purged is a claim with no
// evidence. Purge must not decide that silently in either direction.
// blocking is a SUBSET of collateral by construction (see planPurge's header
// comment) — assert both so a future change that breaks the subset property
// is caught here, not discovered when Task 7 repairs a page it should have
// stopped on instead.
test('a page losing all provenance is reported as blocking', () => {
  const pages = [
    { path: 'wiki/sources/S.md', name: 's', outTargets: [], fmTargets: ['raw/clippings/E-ccc3333.md'] },
    { path: 'raw/clippings/E-ccc3333.md', name: 'e-ccc3333', outTargets: [], fmTargets: [], sourceHash: 'ccc3333' },
  ];
  const r = planPurge({ pages, seedPaths: ['raw/clippings/E-ccc3333.md'] });
  assert.deepEqual(r.blocking, ['wiki/sources/S.md']);
  assert.deepEqual(r.collateral, ['wiki/sources/S.md']);
});

test('a page keeping at least one source is not blocking', () => {
  const pages = [
    { path: 'wiki/sources/S.md', name: 's', outTargets: [],
      fmTargets: ['raw/clippings/E-ccc3333.md', 'raw/clippings/Keep-ddd4444.md'] },
    { path: 'raw/clippings/E-ccc3333.md', name: 'e-ccc3333', outTargets: [], fmTargets: [], sourceHash: 'ccc3333' },
    { path: 'raw/clippings/Keep-ddd4444.md', name: 'keep-ddd4444', outTargets: [], fmTargets: [], sourceHash: 'ddd4444' },
  ];
  const r = planPurge({ pages, seedPaths: ['raw/clippings/E-ccc3333.md'] });
  assert.deepEqual(r.blocking, []);
});

// buildNameIndex is first-writer-wins on the plain key, so without sorting the
// pages array first, a bare `sources: [[Foo]]` citation binds to whichever
// homonym the walk visited first — readdirSync is alphabetical on NTFS but
// hash-ordered on ext4, so two machines reading the identical vault would
// compute different purge sets. This fixture reproduces the exact collision:
// raw/clippings/Foo.md and wiki/sources/Foo.md share the bare name "foo", and
// Citer.md cites it via the ambiguous provenance channel.
function collisionVault() {
  return [
    { path: 'raw/clippings/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'wiki/sources/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'wiki/concepts/Citer.md', name: 'citer', outTargets: [], fmTargets: ['Foo'] },
  ];
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

test('the plan is order-independent and sorted, across every array order of a colliding fixture', () => {
  const seeds = ['wiki/concepts/Citer.md'];
  // The bare citation must always resolve to the clipping, per the vault's
  // documented `sources: [[raw/clippings/X.md]]` convention — never to the
  // wiki/sources/ summary page that happens to share its basename.
  const reference = planPurge({ pages: collisionVault(), seedPaths: seeds }).purge;
  assert.deepEqual(reference, ['raw/clippings/Foo.md', 'wiki/concepts/Citer.md']);
  for (const perm of permutations(collisionVault())) {
    const r = planPurge({ pages: perm, seedPaths: seeds });
    assert.deepEqual(r.purge, reference);
    assert.deepEqual(r.purge, [...r.purge].sort());
  }
});
