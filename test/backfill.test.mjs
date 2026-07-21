import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSourceHashBackfill, insertSourceHashes, insertSourceHash } from '../scripts/lib/backfill.mjs';

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
