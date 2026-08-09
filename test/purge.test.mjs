import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStructural, inboundMap, planPurge, binPathFor, purgeId, buildManifest } from '../scripts/lib/purge.mjs';
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
// Deliberately NOT computeGraphMetrics's source-side exclusion: an edge from immutable
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
  const reference = planPurge({ pages: collisionVault(), seedPaths: seeds });
  assert.deepEqual(reference.purge, ['raw/clippings/Foo.md', 'wiki/concepts/Citer.md']);
  // wiki/sources/Foo.md survives (nothing cites it directly) but carries no
  // targets of its own, so it is neither collateral nor blocking here.
  assert.deepEqual(reference.collateral, []);
  assert.deepEqual(reference.blocking, []);
  for (const perm of permutations(collisionVault())) {
    const r = planPurge({ pages: perm, seedPaths: seeds });
    assert.deepEqual(r.purge, reference.purge);
    assert.deepEqual(r.purge, [...r.purge].sort());
    assert.deepEqual(r.collateral, reference.collateral);
    assert.deepEqual(r.blocking, reference.blocking);
  }
});

// A survivor whose ONLY provenance is the ambiguous bare name must resolve it
// via the PROVENANCE channel (nav: false) even where planPurge relies on
// resolveLinkTarget's default rather than passing the option explicitly. The
// seed (raw/clippings/Foo.md) is purged unconditionally — a seed purges
// despite outside referents, per planPurge's header comment — so Downstream's
// citation of it cannot block admission the way it would for a closure-grown
// page; it only decides Downstream's own collateral/blocking verdict. If
// graph.mjs ever flipped resolveLinkTarget's default to nav: true, Downstream's
// fmTargets would resolve to wiki/sources/Foo.md (the nav-preferred content
// page, outside the set) instead of raw/clippings/Foo.md (inside it), and both
// verdicts below would flip silently.
test('a survivor citing the colliding bare name via sources: is collateral and blocking by the provenance channel, not nav', () => {
  const pages = [
    { path: 'raw/clippings/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'wiki/sources/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'wiki/sources/Downstream.md', name: 'downstream', outTargets: [], fmTargets: ['Foo'] },
  ];
  const r = planPurge({ pages, seedPaths: ['raw/clippings/Foo.md'] });
  assert.deepEqual(r.purge, ['raw/clippings/Foo.md']);
  assert.deepEqual(r.collateral, ['wiki/sources/Downstream.md']);
  assert.deepEqual(r.blocking, ['wiki/sources/Downstream.md']);
});

// Spec §4: the dot segment must come FIRST. Every reader that is not a
// filesystem walk excludes the bin with an anchored ^wiki/ style filter
// (search.mjs, drift.mjs:61, stale.base). A layout that hoisted wiki/ to the
// front would pass those filters and re-expose every purged page.
test('binPathFor nests the original path under the dot-prefixed bin', () => {
  assert.equal(
    binPathFor('2026-08-08-topic', 'wiki/concepts/Foo.md'),
    '.recycle/2026-08-08-topic/wiki/concepts/Foo.md'
  );
});

test('every bin path fails the anchored wiki/ filters the other readers use', () => {
  const p = binPathFor('2026-08-08-topic', 'wiki/concepts/Foo.md');
  assert.equal(/^wiki\//.test(p), false);
  assert.equal(/^wiki\/(concepts|syntheses)\//.test(p), false);
  assert.equal(p.startsWith('.'), true);
});

test('binPathFor keeps raw paths distinct from wiki paths', () => {
  assert.equal(
    binPathFor('id1', 'raw/clippings/Src-abc1234.md'),
    '.recycle/id1/raw/clippings/Src-abc1234.md'
  );
});

test('purgeId slugifies the topic behind the date', () => {
  assert.equal(purgeId('Parenting / Conflict Resolution!', new Date('2026-08-08T12:00:00')),
    '2026-08-08-parenting-conflict-resolution');
});

test('buildManifest records path, hash, layer, and url per entry', () => {
  const pages = [
    { path: 'wiki/concepts/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', outTargets: [], fmTargets: [],
      sourceHash: 'abc1234deadbeef', url: 'https://example.com/a' },
  ];
  const m = buildManifest({
    id: '2026-08-08-topic',
    topic: 'topic',
    date: '2026-08-08',
    purge: ['wiki/concepts/Foo.md', 'raw/clippings/Src-abc1234.md'],
    collateral: ['wiki/syntheses/Keep.md'],
    pages,
    hashes: { 'wiki/concepts/Foo.md': 'sha-foo', 'raw/clippings/Src-abc1234.md': 'sha-src' },
  });
  assert.equal(m.id, '2026-08-08-topic');
  assert.deepEqual(m.collateral, ['wiki/syntheses/Keep.md']);
  assert.deepEqual(m.entries[0], { layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'sha-foo' });
  assert.deepEqual(m.entries[1], {
    layer: 'raw', from: 'raw/clippings/Src-abc1234.md', sha256: 'sha-src',
    'source-hash': 'abc1234deadbeef', url: 'https://example.com/a',
  });
  assert.deepEqual(m.declines, ['https://example.com/a']);
});

test('buildManifest omits declines for clippings with no url', () => {
  const pages = [{ path: 'raw/clippings/Local-eee5555.md', name: 'local-eee5555', outTargets: [], fmTargets: [], sourceHash: 'eee5555' }];
  const m = buildManifest({
    id: 'id', topic: 't', date: '2026-08-08',
    purge: ['raw/clippings/Local-eee5555.md'], collateral: [], pages,
    hashes: { 'raw/clippings/Local-eee5555.md': 'sha' },
  });
  assert.deepEqual(m.declines, []);
});
