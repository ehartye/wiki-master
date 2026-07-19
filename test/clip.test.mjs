import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, slugFromUrl, normalizeUrl, isDuplicateUrl, buildFrontmatter, disambiguateSlug } from '../scripts/clip.mjs';

test('slugify strips illegal chars, collapses, caps length, defaults', () => {
  assert.equal(slugify('Neural Scaling Laws'), 'Neural Scaling Laws');
  assert.equal(slugify('Foo/Bar'), 'Foo-Bar');
  assert.equal(slugify('Trailing: '), 'Trailing');
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify('a'.repeat(200)).length, 120);
});

test('disambiguateSlug returns the slug unchanged when it does not collide', () => {
  assert.equal(disambiguateSlug('Fresh Title', 'abc1234', () => false), 'Fresh Title');
});

test('disambiguateSlug appends a hash suffix on a collision (no silent drop)', () => {
  const taken = new Set(['ai in mathematics e']); // stored lowercased
  const exists = (s) => taken.has(s.toLowerCase());
  // A DIFFERENT paper whose title slugifies to a case-variant of an existing one.
  const out = disambiguateSlug('AI in Mathematics E', 'a9911ac85fbb', exists);
  assert.equal(out, 'AI in Mathematics E-a9911ac', 'case-only collision must disambiguate, not drop');
  assert.ok(!exists(out), 'the disambiguated slug is free');
});

test('disambiguateSlug walks past a suffixed collision too', () => {
  const taken = new Set(['t', 't-abc1234']);
  const out = disambiguateSlug('T', 'abc1234', (s) => taken.has(s.toLowerCase()));
  assert.equal(out, 'T-abc1234-2');
});

test('slugFromUrl uses last path segment, decodes, falls back to host', () => {
  // Title-reusing sites (e.g. iquilezles.org shares one <title>) disambiguate by URL path.
  assert.equal(slugFromUrl('https://iquilezles.org/articles/smin/'), 'smin');
  assert.equal(slugFromUrl('https://iquilezles.org/articles/distfunctions/'), 'distfunctions');
  assert.equal(slugFromUrl('https://a.com/foo/bar?x=1#y'), 'bar');
  assert.equal(slugFromUrl('https://a.com/a%20b/'), 'a b');
  assert.equal(slugFromUrl('https://x.com/'), 'x.com');
  assert.equal(slugFromUrl('not a url'), 'untitled');
});

test('normalizeUrl drops hash + trailing slash, lowercases host', () => {
  assert.equal(normalizeUrl('https://X.com/A/#frag'), 'https://x.com/A');
  assert.equal(normalizeUrl('https://x.com/a/'), 'https://x.com/a');
});

test('isDuplicateUrl matches ignoring trailing slash / fragment', () => {
  assert.equal(isDuplicateUrl('https://x.com/a/', ['https://x.com/a']), true);
  assert.equal(isDuplicateUrl('https://x.com/b', ['https://x.com/a']), false);
});

test('buildFrontmatter injects plugin fields and omits absent optionals', () => {
  const fm = buildFrontmatter({
    title: 'Scaling Laws', source: 'https://x.com/a', author: 'Jane',
    published: '2025-01-01', created: '2026-07-15', quality: 'high', hash: 'abc123',
  });
  assert.match(fm, /^---\n/);
  assert.match(fm, /title: "Scaling Laws"/);
  assert.match(fm, /source: "https:\/\/x\.com\/a"/);
  assert.match(fm, /author: "Jane"/);
  assert.match(fm, /published: 2025-01-01/);
  assert.match(fm, /created: 2026-07-15/);
  assert.match(fm, /tags: \[clippings\]/);
  assert.match(fm, /quality: high/);
  assert.match(fm, /source-hash: abc123/);
  assert.match(fm, /\n---$/);

  const fm2 = buildFrontmatter({ title: 'X', source: 'u', created: 'd', quality: 'low', hash: 'h' });
  assert.doesNotMatch(fm2, /author:/);
  assert.doesNotMatch(fm2, /published:/);
});
