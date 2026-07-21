import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, computeGraphMetrics, isStub, classifyBrokenLinks, resolveLinkTarget, buildNameIndex, isContent } from '../scripts/lib/graph.mjs';

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

test('attachment files (pdf/docx/…) are valid link targets, as in Obsidian', () => {
  const g = buildGraph(FIXTURE);
  // The attachment is a node so links can resolve to it.
  assert.ok(g.pages.some((p) => p.name === 'paper.pdf'), 'attachment registered as a page');
  const m = computeGraphMetrics(buildGraph(FIXTURE));
  // gamma cites [[paper.pdf]] in its frontmatter — a real file in raw/. Obsidian
  // resolves this; the health graph must too, so it is NOT a broken link.
  assert.ok(
    !m.brokenLinks.some((b) => b.target === 'paper.pdf'),
    'provenance to a real attachment file resolves, not broken'
  );
  // Attachments are never scored as content (orphan/dead-end/hub-stub).
  assert.ok(!m.orphans.includes('raw/sources/paper.pdf'));
  assert.ok(!m.deadEnds.includes('raw/sources/paper.pdf'));
});

test('classifyBrokenLinks splits defect / stale / deferred', () => {
  const pages = [
    { path: 'wiki/concepts/Voxel Grammar.md', name: 'voxel grammar', title: 'Voxel Grammar', updated: '2026-01-01' },
    { path: 'wiki/sources/old.md', name: 'old', updated: '2026-01-01' },
    { path: 'wiki/sources/fresh.md', name: 'fresh', updated: '2026-07-10' },
  ];
  const broken = [
    { source: 'wiki/sources/old.md', target: 'Voxel Grammer' },    // typo of an existing page → defect
    { source: 'wiki/sources/old.md', target: 'Abandoned Concept' },// old + 1 ref → stale
    { source: 'wiki/sources/fresh.md', target: 'New Concept' },    // fresh → deferred
  ];
  const c = classifyBrokenLinks(broken, pages, { now: new Date('2026-07-18'), staleDays: 90, demandThreshold: 3 });
  assert.deepEqual(c.defects.map((d) => d.target), ['Voxel Grammer']);
  assert.equal(c.defects[0].suggest, 'Voxel Grammar', 'defect suggests the near-match page');
  assert.deepEqual(c.stale.map((s) => s.target), ['Abandoned Concept']);
  assert.deepEqual(c.deferred.map((d) => d.target), ['New Concept']);
});

test('classifyBrokenLinks: corroborated (>=demand) old links stay deferred, not stale', () => {
  const pages = [{ path: 'wiki/sources/old.md', name: 'old', updated: '2026-01-01' }];
  const broken = Array(3).fill(0).map(() => ({ source: 'wiki/sources/old.md', target: 'Wanted' }));
  const c = classifyBrokenLinks(broken, pages, { now: new Date('2026-07-18') });
  assert.equal(c.stale.length, 0, '3 refs meets the materialization threshold — demand, not cruft');
  assert.equal(c.deferred.length, 3);
});

test('classifyBrokenLinks: without now, nothing can be proven stale (all deferred)', () => {
  const pages = [{ path: 'wiki/sources/old.md', name: 'old', updated: '2020-01-01' }];
  const c = classifyBrokenLinks([{ source: 'wiki/sources/old.md', target: 'Whatever' }], pages, {});
  assert.equal(c.stale.length, 0);
  assert.equal(c.deferred.length, 1);
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

// Real bug, found live in the vault: byName is keyed on bare basenames only
// (buildGraph's `name` field strips directory and .md extension), but the
// vault's own documented citation convention writes `sources:` as
// `[[raw/clippings/X.md]]` — path AND extension qualified. A raw
// `byName.get(t.toLowerCase())` lookup never strips either, so ~two-thirds
// of the live vault's real, correct citations were silently invisible to
// every metric below: provenanceGaps, unsummarizedSources, deadEnds, and
// brokenLinks all falsely flagged genuinely-cited pages/sources as gaps.
test('resolveLinkTarget normalizes a path- and/or extension-qualified target to its bare basename', () => {
  const byName = new Map([['foo', 'raw/clippings/Foo.md'], ['bar summary', 'wiki/sources/Bar Summary.md']]);
  assert.equal(resolveLinkTarget(byName, 'raw/clippings/Foo.md'), 'raw/clippings/Foo.md');
  assert.equal(resolveLinkTarget(byName, 'wiki/sources/Bar Summary'), 'wiki/sources/Bar Summary.md');
  assert.equal(resolveLinkTarget(byName, 'Foo'), 'raw/clippings/Foo.md', 'bare name still resolves');
  assert.equal(resolveLinkTarget(byName, 'nope'), undefined);
});

test('computeGraphMetrics recognizes a path+extension-qualified sources: citation as real provenance', () => {
  const pages = [
    { path: 'raw/clippings/Foo.md', name: 'foo', title: 'Foo', words: 50, outTargets: [], fmTargets: [] },
    {
      path: 'wiki/sources/Foo Summary.md', name: 'foo summary', title: 'Foo Summary', words: 50,
      outTargets: [], fmTargets: ['raw/clippings/Foo.md'], // the vault's real, documented citation format
    },
  ];
  const m = computeGraphMetrics({ pages });
  assert.ok(!m.provenanceGaps.includes('wiki/sources/Foo Summary.md'),
    'a path+extension-qualified sources: citation must not be flagged as a provenance gap');
  assert.ok(!m.unparsedSources.includes('raw/clippings/Foo.md'), 'the cited raw file is not unparsed');
  assert.ok(!m.unsummarizedSources.includes('raw/clippings/Foo.md'),
    'the raw file is cited by a wiki/sources page, so it counts as summarized');
  assert.ok(!m.brokenLinks.some((b) => b.target === 'raw/clippings/Foo.md'),
    'the qualified citation resolves; it must not be reported as broken');
});

test('computeGraphMetrics resolves a directory-qualified (no-extension) body wikilink for dead-end detection', () => {
  const pages = [
    { path: 'wiki/sources/Bar.md', name: 'bar', title: 'Bar', words: 50, outTargets: [], fmTargets: [] },
    {
      path: 'wiki/concepts/Baz.md', name: 'baz', title: 'Baz', words: 50,
      outTargets: ['wiki/sources/Bar'], fmTargets: [],
    },
  ];
  const m = computeGraphMetrics({ pages });
  assert.ok(!m.deadEnds.includes('wiki/concepts/Baz.md'),
    'a path-qualified (extensionless) body link must resolve, not read as a dead end');
  assert.equal(m.brokenLinks.length, 0);
});

// Real bug, found live in the vault AFTER the fix above shipped: this vault's
// long-standing convention names a wiki/sources/ summary page (and often a
// wiki/entities/ page too) identically to its raw/clippings/ source — e.g.
// raw/clippings/CSX.md, wiki/sources/CSX.md, and wiki/entities/CSX.md all
// really exist, a genuine three-way basename collision. buildGraph's `name`
// field is bare-basename-only, so byName (as built before this fix) could
// only ever remember ONE of the three under the key "csx" — whichever the
// filesystem walk visited first (raw/ sorts before wiki/, so the raw file
// always won). Every OTHER page sharing that basename became permanently
// unreachable by name: a directory-qualified backlink like
// `[[wiki/sources/CSX]]` still normalized to the bare "csx" and silently hit
// the wrong file. Measured against the live vault, all 117 wiki/* pages in
// this situation read as false orphans — not because nothing linked to them,
// but because every link that did got misattributed to their same-named
// raw/clippings/ (or sibling wiki/) twin instead.
test('resolveLinkTarget prefers an exact full-path match over the ambiguous bare-basename fallback', () => {
  const byName = buildNameIndex([
    { path: 'raw/clippings/CSX.md', name: 'csx' },
    { path: 'wiki/sources/CSX.md', name: 'csx' },   // second registrant for "csx" — loses the bare-name race
    { path: 'wiki/entities/CSX.md', name: 'csx' },  // third registrant — same race, same loss
  ]);
  // Directory-qualified links are NOT ambiguous — each must resolve to the
  // exact file it names, regardless of which file won the bare-name race.
  assert.equal(resolveLinkTarget(byName, 'wiki/sources/CSX'), 'wiki/sources/CSX.md');
  assert.equal(resolveLinkTarget(byName, 'wiki/entities/CSX'), 'wiki/entities/CSX.md');
  assert.equal(resolveLinkTarget(byName, 'raw/clippings/CSX.md'), 'raw/clippings/CSX.md');
  // A truly bare, unqualified link remains exactly as ambiguous as before —
  // first-registered-in-the-walk still wins; this fix does not (and cannot)
  // resolve genuine ambiguity, only eliminate FALSE ambiguity for links that
  // already named an exact file.
  assert.equal(resolveLinkTarget(byName, 'CSX'), 'raw/clippings/CSX.md');
});

test('computeGraphMetrics: a qualified backlink to a basename-colliding page counts as real inbound (the #117-orphan bug)', () => {
  const pages = [
    { path: 'raw/clippings/CSX.md', name: 'csx', title: 'CSX', words: 20, outTargets: [], fmTargets: [] },
    {
      path: 'wiki/sources/CSX.md', name: 'csx', title: 'CSX', words: 50,
      outTargets: ['wiki/entities/CSX'], fmTargets: ['raw/clippings/CSX.md'],
    },
    { path: 'wiki/entities/CSX.md', name: 'csx', title: 'CSX', words: 50, outTargets: [], fmTargets: [] },
    {
      path: 'wiki/concepts/Neo4j.md', name: 'neo4j', title: 'Neo4j', words: 50,
      outTargets: ['wiki/sources/CSX', 'wiki/entities/CSX'], fmTargets: [],
    },
  ];
  const m = computeGraphMetrics({ pages });
  assert.ok(!m.orphans.includes('wiki/sources/CSX.md'),
    'Neo4j.md\'s qualified backlink must count as real inbound, not get swallowed by the same-named raw file');
  assert.ok(!m.orphans.includes('wiki/entities/CSX.md'),
    'same for the entity page — a third file sharing the exact basename');
  assert.ok(!m.provenanceGaps.includes('wiki/sources/CSX.md'),
    'the qualified raw/ citation still resolves to the raw file specifically, not its wiki-page namesakes');
});

// Real bug, found live in the vault: log/ holds one file per operation (the
// audit trail, browsed via log.base), which replaced the old aggregate log.md.
// isContent excludes log.md but never learned about the folder that replaced
// it, so every log/ file was scored as content: each is an orphan (nothing
// links a log) and most are dead-ends. On the live vault 15 orphan + 13
// dead-end log files pinned both (capped) penalties at max, making the score
// uncorrectable by real vault work.
test('isContent excludes log/ operation files, exactly as it excludes log.md/index.md', () => {
  assert.equal(isContent('log/2026-07-20-120000-ingest-foo.md'), false, 'per-operation log files are structural, not content');
  assert.equal(isContent('log.md'), false, 'the old aggregate log is already excluded');
  assert.equal(isContent('index.md'), false);
  assert.equal(isContent('wiki/concepts/Foo.md'), true, 'real content still counts');
});

test('computeGraphMetrics never scores a log/ file as an orphan or dead-end', () => {
  const pages = [
    { path: 'wiki/concepts/Foo.md', name: 'foo', title: 'Foo', words: 50, outTargets: ['Bar'], fmTargets: [] },
    { path: 'wiki/concepts/Bar.md', name: 'bar', title: 'Bar', words: 50, outTargets: ['Foo'], fmTargets: [] },
    // A log entry: nothing links to it (orphan) and it links nowhere resolvable (dead-end).
    { path: 'log/2026-07-20-120000-ingest-foo.md', name: '2026-07-20-120000-ingest-foo', title: 'x', words: 30, outTargets: [], fmTargets: [] },
  ];
  const m = computeGraphMetrics({ pages });
  assert.ok(!m.orphans.some((p) => p.startsWith('log/')), 'log files are never orphans');
  assert.ok(!m.deadEnds.some((p) => p.startsWith('log/')), 'log files are never dead-ends');
});

// Real bug, found live in the vault: the vault follows the `agents.md` naming
// convention, so a source note is filed as "GitHub — Writing a Great agents.md.md"
// — its page name (one .md stripped) is "…agents.md". A body link written as
// [[GitHub — Writing a Great agents.md]] must resolve to it (Obsidian does), but
// resolveLinkTarget stripped .md from the TARGET before lookup, turning it into
// "…agents", which missed the "…agents.md" page. Checking the un-stripped target
// first fixes it without disturbing the exact-path-first collision logic above.
test('resolveLinkTarget resolves a link whose target name itself ends in .md', () => {
  const byName = buildNameIndex([
    { path: 'wiki/sources/GitHub — Writing a Great agents.md.md', name: 'github — writing a great agents.md' },
  ]);
  assert.equal(
    resolveLinkTarget(byName, 'GitHub — Writing a Great agents.md'),
    'wiki/sources/GitHub — Writing a Great agents.md.md',
    'a [[Name.md]] link resolves to the Name.md.md page — the .md is part of the note name'
  );
});

// ─── Hash-based ingest-state tracking (specs/2026-07-21-hash-ingest-state-design.md) ───
// The link-resolution backlog manufactured 172 phantom items on the live vault
// (~0 real): 80 clippings whose `[[Title]]` citation could not bridge the
// `-<hash7>` filename suffix, and 92 binaries that can never be a summary target.
// Ingest-state moves onto a content-hash join: a clipping is ingested iff its
// `source-hash` is recorded in some wiki/sources page's `source-hashes`.

test('buildGraph parses source-hash and source-hashes from frontmatter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-graph-'));
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  mkdirSync(join(dir, 'wiki', 'sources'), { recursive: true });
  writeFileSync(
    join(dir, 'raw', 'clippings', 'Foo-abc1234.md'),
    '---\ntitle: "Foo"\ntags: [clippings]\nsource-hash: abc1234def5678\n---\nbody\n'
  );
  writeFileSync(
    join(dir, 'wiki', 'sources', 'Foo Summary.md'),
    '---\ntype: source\nsources: ["[[Foo-abc1234]]"]\nsource-hashes: ["abc1234def5678"]\n---\nsummary\n'
  );
  const g = buildGraph(dir);
  const clip = g.pages.find((p) => p.path === 'raw/clippings/Foo-abc1234.md');
  const src = g.pages.find((p) => p.path === 'wiki/sources/Foo Summary.md');
  assert.equal(clip.sourceHash, 'abc1234def5678', 'clipping source-hash parsed');
  assert.deepEqual(src.sourceHashes, ['abc1234def5678'], 'source-hashes list parsed');
});

test('unsummarizedSources: a clipping is ingested iff its source-hash is recorded (immune to the -hash7 suffix)', () => {
  const pages = [
    { path: 'raw/clippings/Foo-abc1234.md', name: 'foo-abc1234', title: 'Foo', words: 40, outTargets: [], fmTargets: [], sourceHash: 'aaa1111' },
    { path: 'raw/clippings/Bar-9990000.md', name: 'bar-9990000', title: 'Bar', words: 40, outTargets: [], fmTargets: [], sourceHash: 'bbb2222' },
    { path: 'wiki/sources/Foo Summary.md', name: 'foo summary', title: 'Foo Summary', words: 60, outTargets: [], fmTargets: [], sourceHashes: ['aaa1111'] },
  ];
  const m = computeGraphMetrics({ pages });
  assert.ok(!m.unsummarizedSources.includes('raw/clippings/Foo-abc1234.md'),
    'hash recorded by a source page → ingested, despite no wikilink and the filename suffix');
  assert.ok(m.unsummarizedSources.includes('raw/clippings/Bar-9990000.md'),
    'no source page records this hash → genuine backlog');
});

test('unsummarizedSources excludes binaries — only .md clippings are ingestable units', () => {
  const pages = [
    { path: 'raw/proc-graphics/Paper.pdf', name: 'paper.pdf', title: 'Paper.pdf', type: 'attachment', words: 0, outTargets: [], fmTargets: [] },
    { path: 'raw/INDOT_Unit_Prices.xlsx', name: 'indot_unit_prices.xlsx', title: 'x', type: 'attachment', words: 0, outTargets: [], fmTargets: [] },
    { path: 'raw/clippings/ref-docs-staging/Bundle.zip', name: 'bundle.zip', title: 'x', type: 'attachment', words: 0, outTargets: [], fmTargets: [] },
  ];
  const m = computeGraphMetrics({ pages });
  assert.deepEqual(m.unsummarizedSources, [], 'binary originals are never ingest backlog');
});

test('unsummarizedSources: a re-clipped source is backlog even if a stale wikilink still cites it (migrated page → hash is authoritative)', () => {
  const pages = [
    { path: 'raw/clippings/Foo-abc1234.md', name: 'foo-abc1234', title: 'Foo', words: 40, outTargets: [], fmTargets: [], sourceHash: 'newhash' },
    { path: 'wiki/sources/Foo Summary.md', name: 'foo summary', title: 'Foo Summary', words: 60,
      outTargets: [], fmTargets: ['raw/clippings/Foo-abc1234.md'], sourceHashes: ['oldhash'] },
  ];
  const m = computeGraphMetrics({ pages });
  assert.ok(m.unsummarizedSources.includes('raw/clippings/Foo-abc1234.md'),
    'a migrated page trusts its recorded hashes; a stale hash means re-ingest even though a wikilink still resolves');
});

test('unsummarizedSources: a legacy (pre-backfill) page credits its clipping by link, and no-hash clippings surface in missingHash', () => {
  const pages = [
    { path: 'raw/clippings/Legacy.md', name: 'legacy', title: 'Legacy', words: 20, outTargets: [], fmTargets: [] },
    { path: 'wiki/sources/Legacy Summary.md', name: 'legacy summary', title: 'Legacy Summary', words: 60,
      outTargets: [], fmTargets: ['raw/clippings/Legacy.md'] },
  ];
  const m = computeGraphMetrics({ pages });
  assert.ok(!m.unsummarizedSources.includes('raw/clippings/Legacy.md'),
    'a page with no source-hashes yet still credits its clipping via link resolution (transitional)');
  assert.deepEqual(m.missingHash, ['raw/clippings/Legacy.md'],
    'a .md clipping with no source-hash is flagged for repair');
});

test('backfillPending counts source pages that cite raw but have not yet recorded source-hashes', () => {
  const pages = [
    { path: 'raw/clippings/X.md', name: 'x', title: 'X', words: 20, outTargets: [], fmTargets: [], sourceHash: 'hx' },
    { path: 'wiki/sources/Done.md', name: 'done', title: 'Done', words: 60, outTargets: [], fmTargets: ['raw/clippings/X.md'], sourceHashes: ['hx'] },
    { path: 'wiki/sources/Pending.md', name: 'pending', title: 'Pending', words: 60, outTargets: [], fmTargets: ['raw/clippings/X.md'] },
  ];
  const m = computeGraphMetrics({ pages });
  assert.equal(m.backfillPending, 1, 'only the page still lacking source-hashes is pending');
});
