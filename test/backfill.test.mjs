import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSourceHashBackfill, insertSourceHashes } from '../scripts/lib/backfill.mjs';

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

test('insertSourceHashes is idempotent — never adds a second source-hashes line', () => {
  const text = '---\ntype: source\nsources: ["[[Foo]]"]\nsource-hashes: ["aaa"]\n---\nbody\n';
  assert.equal(insertSourceHashes(text, ['bbb']), text);
});
