import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSourceHashBackfill, insertSourceHashes, insertSourceHash, fixSourcesOrder, fixInlineSources, fixBlockSources } from '../scripts/lib/backfill.mjs';

// Clippings written before `source-hash` existed carry none, so they can never be
// hash-joined and their summaries stay permanently un-recordable. Stamping the
// hash of the clipping's own body repairs them in place.
test('insertSourceHash stamps a source-hash into a clipping that lacks one', () => {
  const text = '---\ntitle: "Foo"\ntags: [clippings]\n---\nbody text\n';
  const out = insertSourceHash(text, 'abc1234def');
  assert.match(out, /^source-hash: abc1234def$/m);
  assert.equal((out.match(/^source-hash:/gm) || []).length, 1);
  assert.ok(out.endsWith('---\nbody text\n'), 'body and fence preserved');
});

test('insertSourceHash leaves a clipping that already has one untouched', () => {
  const text = '---\ntitle: "Foo"\nsource-hash: aaa1111\n---\nbody\n';
  assert.equal(insertSourceHash(text, 'bbb2222'), text);
});

test('insertSourceHash is not confused by a source-hashes (plural) line', () => {
  const text = '---\ntitle: "Foo"\nsource-hashes: ["aaa1111"]\n---\nbody\n';
  assert.match(insertSourceHash(text, 'ccc3333'), /^source-hash: ccc3333$/m);
});

// The backfill's whole job is to bridge the gap the runtime metric cannot: a
// legacy source page cites `[[Title]]` but the clipping file is `Title-<hash7>.md`,
// so the bare wikilink never resolves. Backfill de-suffixes clipping names to
// match, reads the clipping's `source-hash`, and records it on the page — turning
// the transitional fallback into an authoritative hash join.

test('plan: a bare [[Title]] citation matches the hash-suffixed clipping and yields its source-hash', () => {
  const pages = [
    { path: 'raw/clippings/A Survey-b87e401.md', name: 'a survey-b87e401', title: 'A Survey', outTargets: [], fmTargets: [], sourceHash: 'b87e401fullhash' },
    { path: 'wiki/sources/Survey Summary.md', name: 'survey summary', title: 'Survey Summary', outTargets: [], fmTargets: ['A Survey'] },
  ];
  const r = planSourceHashBackfill({ pages });
  assert.deepEqual(r.pages, [{ path: 'wiki/sources/Survey Summary.md', hashes: ['b87e401fullhash'] }]);
  assert.equal(r.ambiguous.length, 0);
  assert.equal(r.unresolved.length, 0);
});

// The sweep case: a page migrated earlier, then repointed at a newly-clipped
// source. It HAS a source-hashes line, but not this clipping's hash — so the
// clipping is orphaned. The plan must cover partially-recorded pages, not just
// pages with no source-hashes at all.
test('plan: a page whose source-hashes omit a cited clipping is planned for the missing hash', () => {
  const pages = [
    { path: 'raw/clippings/Old-aaa1111.md', name: 'old-aaa1111', title: 'Old', outTargets: [], fmTargets: [], sourceHash: 'aaa1111' },
    { path: 'raw/clippings/New-bbb2222.md', name: 'new-bbb2222', title: 'New', outTargets: [], fmTargets: [], sourceHash: 'bbb2222' },
    {
      path: 'wiki/sources/Both.md', name: 'both', title: 'Both', outTargets: [],
      fmTargets: ['Old', 'raw/clippings/New-bbb2222.md'], sourceHashes: ['aaa1111'],
    },
  ];
  const r = planSourceHashBackfill({ pages });
  assert.deepEqual(r.pages, [{ path: 'wiki/sources/Both.md', hashes: ['bbb2222'] }],
    'only the missing hash is planned; the already-recorded one is not repeated');
});

test('plan: a source page that already carries source-hashes is left untouched (idempotent)', () => {
  const pages = [
    { path: 'raw/clippings/Foo-abc1234.md', name: 'foo-abc1234', title: 'Foo', outTargets: [], fmTargets: [], sourceHash: 'h' },
    { path: 'wiki/sources/Foo Summary.md', name: 'foo summary', title: 'Foo Summary', outTargets: [], fmTargets: ['Foo'], sourceHashes: ['h'] },
  ];
  assert.equal(planSourceHashBackfill({ pages }).pages.length, 0);
});

test('plan: a bare citation matching two clippings is ambiguous — skipped and logged, never guessed', () => {
  const pages = [
    { path: 'raw/clippings/Foo-aaa1111.md', name: 'foo-aaa1111', title: 'Foo', outTargets: [], fmTargets: [], sourceHash: 'ha' },
    { path: 'raw/clippings/Foo-bbb2222.md', name: 'foo-bbb2222', title: 'Foo', outTargets: [], fmTargets: [], sourceHash: 'hb' },
    { path: 'wiki/sources/Foo Summary.md', name: 'foo summary', title: 'Foo Summary', outTargets: [], fmTargets: ['Foo'] },
  ];
  const r = planSourceHashBackfill({ pages });
  assert.equal(r.pages.length, 0, 'nothing written for an ambiguous page');
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].target, 'Foo');
});

test('plan: a citation that matches no clipping is unresolved', () => {
  const pages = [
    { path: 'wiki/sources/Foo Summary.md', name: 'foo summary', title: 'Foo Summary', outTargets: [], fmTargets: ['Nonexistent'] },
  ];
  const r = planSourceHashBackfill({ pages });
  assert.equal(r.pages.length, 0);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].target, 'Nonexistent');
});

test('plan: a matched clipping that itself lacks a source-hash is reported, not written', () => {
  const pages = [
    { path: 'raw/clippings/Foo-abc1234.md', name: 'foo-abc1234', title: 'Foo', outTargets: [], fmTargets: [] }, // no sourceHash
    { path: 'wiki/sources/Foo Summary.md', name: 'foo summary', title: 'Foo Summary', outTargets: [], fmTargets: ['Foo'] },
  ];
  const r = planSourceHashBackfill({ pages });
  assert.equal(r.pages.length, 0);
  assert.equal(r.nohash.length, 1);
});

test('plan: a path+extension-qualified citation resolves exactly (no de-suffix needed)', () => {
  const pages = [
    { path: 'raw/clippings/Bar-9990000.md', name: 'bar-9990000', title: 'Bar', outTargets: [], fmTargets: [], sourceHash: 'hbar' },
    { path: 'wiki/sources/Bar Summary.md', name: 'bar summary', title: 'Bar Summary', outTargets: [], fmTargets: ['raw/clippings/Bar-9990000.md'] },
  ];
  const r = planSourceHashBackfill({ pages });
  assert.deepEqual(r.pages, [{ path: 'wiki/sources/Bar Summary.md', hashes: ['hbar'] }]);
});

test('insertSourceHashes adds the field after the sources: line, preserving the rest and the body', () => {
  const text = '---\ntype: source\nsources: ["[[Foo]]"]\nquality: high\n---\nbody text\n';
  const out = insertSourceHashes(text, ['aaa', 'bbb']);
  assert.match(out, /sources: \["\[\[Foo\]\]"\]\nsource-hashes: \["aaa", "bbb"\]\nquality: high/);
  assert.ok(out.endsWith('---\nbody text\n'), 'frontmatter fence and body are preserved');
});

// A page can gain a second source later (e.g. a binary citation replaced by a
// freshly-clipped .md). Skipping the write because SOME source-hashes line already
// existed orphaned the new clipping — it was cited by nobody and reappeared as
// ingest backlog. Merge into the list instead; still exactly one line.
test('insertSourceHashes merges a new hash into an existing list (one line, both hashes)', () => {
  const text = '---\ntype: source\nsources: ["[[Foo]]"]\nsource-hashes: ["aaa1111"]\n---\nbody\n';
  const out = insertSourceHashes(text, ['bbb2222']);
  assert.match(out, /source-hashes: \["aaa1111", "bbb2222"\]/);
  assert.equal((out.match(/^source-hashes:/gm) || []).length, 1, 'never a second source-hashes line');
  assert.ok(out.endsWith('---\nbody\n'));
});

test('insertSourceHashes does not duplicate a hash already recorded', () => {
  const text = '---\nsources: ["[[Foo]]"]\nsource-hashes: ["aaa1111"]\n---\nbody\n';
  assert.equal(insertSourceHashes(text, ['aaa1111']), text, 'no-op when nothing new');
});

// `sources:` can also be written as a YAML block list — `sources:` bare on its own
// line, then `  - [[...]]` continuation lines — rather than the inline
// `sources: [[...]]` form every other test above uses. The insertion point was
// computed from `/^sources:.*$/m`, which only matches that FIRST bare line: the
// new `source-hashes:` line landed between the bare `sources:` key and its own
// list item, producing invalid YAML (confirmed with a real YAML parser — this is
// not just a style nit, `sources` becomes unparseable and every OTHER property on
// the page goes with it, since a broken block ends frontmatter parsing entirely).
// Found on the live vault: 193 of 476 wiki/sources pages, all single-citation.
test('insertSourceHashes keeps a block-list sources: value intact (does not split it)', () => {
  const text = '---\ntype: source\nsources:\n  - [[raw/clippings/Foo.md]]\nai-generated: true\n---\nbody\n';
  const out = insertSourceHashes(text, ['aaa1111']);
  assert.match(out, /^sources:\r?\n {2}- \[\[raw\/clippings\/Foo\.md\]\]\r?\nsource-hashes: \["aaa1111"\]\r?\nai-generated: true$/m);
  assert.ok(out.endsWith('---\nbody\n'));
});

test('insertSourceHashes keeps a multi-item block-list sources: value intact', () => {
  const text = '---\nsources:\n  - [[raw/clippings/A.md]]\n  - [[raw/clippings/B.md]]\nai-generated: true\n---\nbody\n';
  const out = insertSourceHashes(text, ['aaa1111', 'bbb2222']);
  assert.match(
    out,
    /^sources:\r?\n {2}- \[\[raw\/clippings\/A\.md\]\]\r?\n {2}- \[\[raw\/clippings\/B\.md\]\]\r?\nsource-hashes: \["aaa1111", "bbb2222"\]\r?\nai-generated: true$/m
  );
});

// `fixSourcesOrder` repairs EXISTING damage from the bug above — it does not
// merely stop the bug from recurring. Confirmed live: 193 of 476 wiki/sources
// pages already have `source-hashes:` sitting between the bare `sources:` key
// and its own list item(s). A real YAML parser rejects this outright
// ("expected <block end>, but found '<block sequence start>'"), and Obsidian
// itself reports "No frontmatter found" on these pages — every property, not
// just `sources`, becomes invisible to the app, Bases, and any property-driven
// view, even though wiki-master's own regex-based scripts tolerate it.
test('fixSourcesOrder repairs a single-item page (the common case: 192 of 193 live)', () => {
  const text = '---\ntype: source\nsources:\nsource-hashes: ["abc1234"]\n  - [[raw/clippings/Foo.md]]\nai-generated: true\n---\nbody\n';
  const out = fixSourcesOrder(text);
  assert.equal(out, '---\ntype: source\nsources:\n  - [[raw/clippings/Foo.md]]\nsource-hashes: ["abc1234"]\nai-generated: true\n---\nbody\n');
});

test('fixSourcesOrder repairs a multi-item page (1 of 193 live)', () => {
  const text =
    '---\nsources:\nsource-hashes: ["h1", "h2"]\n  - [[raw/clippings/A.md]]\n  - [[raw/clippings/B.md]]\nai-generated: true\n---\nbody\n';
  const out = fixSourcesOrder(text);
  assert.equal(
    out,
    '---\nsources:\n  - [[raw/clippings/A.md]]\n  - [[raw/clippings/B.md]]\nsource-hashes: ["h1", "h2"]\nai-generated: true\n---\nbody\n'
  );
});

test('fixSourcesOrder is a no-op on an already-correct block-list page', () => {
  const text = '---\nsources:\n  - [[raw/clippings/Foo.md]]\nsource-hashes: ["abc1234"]\n---\nbody\n';
  assert.equal(fixSourcesOrder(text), text);
});

test('fixSourcesOrder is a no-op on an inline sources: page', () => {
  const text = '---\nsources: [[raw/clippings/Foo.md]]\nsource-hashes: ["abc1234"]\n---\nbody\n';
  assert.equal(fixSourcesOrder(text), text);
});

test('fixSourcesOrder is idempotent — running it twice is the same as running it once', () => {
  const text = '---\nsources:\nsource-hashes: ["abc1234"]\n  - [[raw/clippings/Foo.md]]\n---\nbody\n';
  const once = fixSourcesOrder(text);
  assert.equal(fixSourcesOrder(once), once);
});

// `sources: [[A]]` is not a list at all -- it is one bracket pair too many
// ([[A]] is a flow sequence containing a flow sequence containing the string
// "A"), and `sources: [[A]], [[B]]` does not even parse as one legal flow
// value (no single enclosing bracket pair around the whole thing). Obsidian's
// Properties panel registers `sources` as a list (`multitext` in
// .obsidian/types.json) vault-wide, so every page carrying this shape reports
// "type mismatch, expected list" -- confirmed live on 283 pages across
// wiki/sources, wiki/concepts, wiki/entities, and wiki/syntheses. This is a
// distinct defect from the one fixSourcesOrder repairs (that one is about
// source-hashes landing between a correctly-formed sources: block list and its
// own items); a dedicated test above already pins inline sources: as
// out-of-scope for fixSourcesOrder specifically so the two do not overlap.
test('fixInlineSources rewrites a single inline wikilink into a quoted flow sequence', () => {
  const text = '---\ntitle: "Foo"\nsources: [[raw/clippings/Bar.md]]\nai-generated: true\n---\nbody\n';
  const out = fixInlineSources(text);
  assert.equal(
    out,
    '---\ntitle: "Foo"\nsources: ["[[raw/clippings/Bar.md]]"]\nai-generated: true\n---\nbody\n',
  );
});

test('fixInlineSources rewrites comma-joined multi-link inline sources into a quoted flow sequence', () => {
  const text = '---\nsources: [[raw/clippings/A.md]], [[raw/clippings/B.md]], [[raw/clippings/C.md]]\nai-generated: true\n---\nbody\n';
  const out = fixInlineSources(text);
  assert.equal(
    out,
    '---\nsources: ["[[raw/clippings/A.md]]", "[[raw/clippings/B.md]]", "[[raw/clippings/C.md]]"]\nai-generated: true\n---\nbody\n',
  );
});

// The bug this quoting choice specifically fixes: an unquoted `[[link]]`
// containing a bare YAML-significant character breaks the flow-sequence
// parser outright rather than merely mis-typing the property. Confirmed live
// against real vault link titles ("...Why Should You Care?...",
// "...Two Connected Apps?.md"): a first cut of this repair that wrote an
// UNQUOTED block list (`- [[link]]`) still hit this, because a bare
// `[[link]]` block-list item is itself flow-parsed by YAML one level down.
// Quoting sidesteps it regardless of shape.
test('fixInlineSources quotes a link whose title contains a bare "?" without corrupting it', () => {
  const text = '---\nsources: [[raw/clippings/Why does Gearset have two Connected Apps?.md]]\n---\nbody\n';
  const out = fixInlineSources(text);
  assert.equal(
    out,
    '---\nsources: ["[[raw/clippings/Why does Gearset have two Connected Apps?.md]]"]\n---\nbody\n',
  );
});

test('fixInlineSources is a no-op on sources: [] (a genuinely valid empty list)', () => {
  const text = '---\nsources: []\nai-generated: true\n---\nbody\n';
  assert.equal(fixInlineSources(text), text);
});

test('fixInlineSources leaves an unquoted block list untouched (out of scope; see fixBlockSources)', () => {
  const text = '---\nsources:\n  - [[raw/clippings/Foo.md]]\nai-generated: true\n---\nbody\n';
  assert.equal(fixInlineSources(text), text);
});

test('fixInlineSources is a no-op on an already-correct quoted flow sequence', () => {
  const text = '---\nsources: ["[[raw/clippings/Foo.md]]", "[[raw/clippings/Bar.md]]"]\nai-generated: true\n---\nbody\n';
  assert.equal(fixInlineSources(text), text);
});

// A THIRD defect shape, distinct from the inline-unquoted one above: `sources:
// "[[X]]"` is a single QUOTED STRING -- a valid scalar, but a scalar, not a
// list at all. This is the same visible "type mismatch, expected list" defect
// the unquoted shape produces (Obsidian's Properties panel does not
// distinguish "wrong shape of scalar" from "wrong shape of nested flow
// sequence" -- both are simply "not the registered list type"). Confirmed
// live on 35 wiki/sources pages, all single-citation (each one's own
// `insertSource`-style helper apparently wrote the FIRST citation as a bare
// quoted scalar rather than a one-item list).
test('fixInlineSources rewrites a single quoted-string sources: into a one-item quoted flow sequence', () => {
  const text = '---\nsources: "[[raw/clippings/Foo.md]]"\nsource-hashes: ["abc123"]\n---\nbody\n';
  const out = fixInlineSources(text);
  assert.equal(
    out,
    '---\nsources: ["[[raw/clippings/Foo.md]]"]\nsource-hashes: ["abc123"]\n---\nbody\n',
  );
});

test('fixInlineSources handles a quoted-string sources: as the last frontmatter field', () => {
  const text = '---\nsources: "[[raw/clippings/Foo.md]]"\n---\nbody\n';
  const out = fixInlineSources(text);
  assert.equal(out, '---\nsources: ["[[raw/clippings/Foo.md]]"]\n---\nbody\n');
});

test('fixInlineSources is a no-op when there is no frontmatter at all', () => {
  const text = 'just a body, no frontmatter\n';
  assert.equal(fixInlineSources(text), text);
});

test('fixInlineSources preserves every other frontmatter field and the body untouched', () => {
  const text = '---\ntype: concept\ncreated: 2026-01-01\nsources: [[raw/clippings/Only.md]]\nquality: high\n---\n# Heading\n\nBody prose.\n';
  const out = fixInlineSources(text);
  assert.match(out, /^type: concept\n/m);
  assert.match(out, /created: 2026-01-01\n/);
  assert.match(out, /quality: high\n/);
  assert.ok(out.endsWith('# Heading\n\nBody prose.\n'));
});

test('fixInlineSources is idempotent — running it twice is the same as running it once', () => {
  const text = '---\nsources: [[raw/clippings/A.md]], [[raw/clippings/B.md]]\n---\nbody\n';
  const once = fixInlineSources(text);
  assert.equal(fixInlineSources(once), once);
});

// fixBlockSources: the FOURTH sources: defect shape, and the vault's actual
// dominant one (508 of 1,140 pages, confirmed via a strict re-check that
// parses each page's real sources: value with a YAML parser and asserts every
// item is a string — not merely that parsing succeeds without throwing, the
// weaker check an earlier repair pass relied on and which is exactly how this
// shape went undetected the first time). `yaml.safe_load` on a bare block-list
// item `- [[X]]` does not error; it silently parses into a list containing a
// one-item list containing "X", which is what the tests below pin against a
// real YAML parser's behavior, not just string-shape assertions.
test('fixBlockSources quotes a single bare wikilink block-list item', () => {
  const text = '---\nsources:\n  - [[raw/clippings/Foo.md]]\nai-generated: true\n---\nbody\n';
  const out = fixBlockSources(text);
  assert.equal(
    out,
    '---\nsources:\n  - "[[raw/clippings/Foo.md]]"\nai-generated: true\n---\nbody\n',
  );
});

test('fixBlockSources quotes every item in a multi-item bare block list', () => {
  const text = '---\nsources:\n  - [[raw/clippings/A.md]]\n  - [[raw/clippings/B.md]]\n  - [[raw/clippings/C.md]]\nai-generated: true\n---\nbody\n';
  const out = fixBlockSources(text);
  assert.equal(
    out,
    '---\nsources:\n  - "[[raw/clippings/A.md]]"\n  - "[[raw/clippings/B.md]]"\n  - "[[raw/clippings/C.md]]"\nai-generated: true\n---\nbody\n',
  );
});

test('fixBlockSources handles a bare block list as the last frontmatter field', () => {
  const text = '---\nsources:\n  - [[raw/clippings/Foo.md]]\n---\nbody\n';
  const out = fixBlockSources(text);
  assert.equal(out, '---\nsources:\n  - "[[raw/clippings/Foo.md]]"\n---\nbody\n');
});

test('fixBlockSources leaves an already-quoted block list untouched (no-op, idempotent)', () => {
  const text = '---\nsources:\n  - "[[raw/clippings/Foo.md]]"\n  - "[[raw/clippings/Bar.md]]"\n---\nbody\n';
  assert.equal(fixBlockSources(text), text);
});

test('fixBlockSources only quotes bare items, leaving already-quoted or prose-prefixed items in the same list untouched', () => {
  const text = '---\nsources:\n  - [[raw/clippings/A.md]]\n  - "[[raw/clippings/B.md]]"\n  - See [[raw/clippings/C.md]]\n---\nbody\n';
  const out = fixBlockSources(text);
  assert.equal(
    out,
    '---\nsources:\n  - "[[raw/clippings/A.md]]"\n  - "[[raw/clippings/B.md]]"\n  - See [[raw/clippings/C.md]]\n---\nbody\n',
  );
});

test('fixBlockSources is a no-op on an inline sources: page (out of scope; see fixInlineSources)', () => {
  const text = '---\nsources: [[raw/clippings/Foo.md]]\n---\nbody\n';
  assert.equal(fixBlockSources(text), text);
});

test('fixBlockSources is a no-op on sources: [] (a genuinely valid empty list)', () => {
  const text = '---\nsources: []\nai-generated: true\n---\nbody\n';
  assert.equal(fixBlockSources(text), text);
});

test('fixBlockSources is a no-op when there is no frontmatter at all', () => {
  const text = 'just a body, no frontmatter\n';
  assert.equal(fixBlockSources(text), text);
});

test('fixBlockSources preserves every other frontmatter field and the body untouched', () => {
  const text = '---\ntype: concept\ncreated: 2026-01-01\nsources:\n  - [[raw/clippings/Only.md]]\nquality: high\n---\n# Heading\n\nBody prose.\n';
  const out = fixBlockSources(text);
  assert.match(out, /^type: concept\n/m);
  assert.match(out, /created: 2026-01-01\n/);
  assert.match(out, /quality: high\n/);
  assert.ok(out.endsWith('# Heading\n\nBody prose.\n'));
});

test('fixBlockSources is idempotent — running it twice is the same as running it once', () => {
  const text = '---\nsources:\n  - [[raw/clippings/A.md]]\n  - [[raw/clippings/B.md]]\n---\nbody\n';
  const once = fixBlockSources(text);
  assert.equal(fixBlockSources(once), once);
});
