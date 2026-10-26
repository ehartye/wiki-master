import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  urlNameParts, firstHeading, clipSlugCandidates, chooseClipSlug, uniqueTitle, MAX_SLUG_ATTEMPTS,
} from '../scripts/lib/clip-slug.mjs';

// The naming rule for a new clipping. A clash used to drop a distinct document without a word: a
// title-less raw document has `title: ""`, so its slug was `untitled`, the next fallback was the last
// URL segment (`SKILL.md`, which the writer then gave a second `.md`), and when both existed the clip
// returned `duplicate`. The rule is a fixed, deterministic order of candidates; the caller takes the
// first free one.

const SKILL = (name) => `https://raw.githubusercontent.com/acme/agent/v4.2.1/skills/${name}/SKILL.md`;
const exists = (taken) => (slug) => taken.has(slug.toLowerCase());

test('urlNameParts decodes the path, drops a trailing .md, ignores query and fragment, and falls back to the host', () => {
  assert.deepEqual(urlNameParts(SKILL('one')), { host: 'raw.githubusercontent.com', segs: ['acme', 'agent', 'v4.2.1', 'skills', 'one', 'SKILL'] });
  assert.deepEqual(urlNameParts('https://a.com/a%20b/c.html?x=1#y').segs, ['a b', 'c.html']);
  assert.deepEqual(urlNameParts('https://x.com/').segs, ['x.com']);
  assert.deepEqual(urlNameParts('not a url').segs, ['untitled']);
});

test('firstHeading takes the first level 1 or 2 heading, without markup, or null', () => {
  assert.equal(firstHeading('intro\n\n# The **Title** of [a doc](http://x)\n\ntext'), 'The Title of a doc');
  assert.equal(firstHeading('text\n## Only second\n'), 'Only second');
  assert.equal(firstHeading('### too deep\nplain'), null);
  assert.equal(firstHeading(''), null);
});

test('a titled document keeps its title first, then the last URL segment, then parents nearest first', () => {
  const c = clipSlugCandidates({ title: 'World Partition', url: 'https://docs.example.com/en/unreal/world-partition' });
  assert.deepEqual(c.slice(0, 4), ['World Partition', 'world-partition', 'unreal-world-partition', 'en-unreal-world-partition']);
});

test('a document with no title and no heading is named from its URL path, nearest parent first, bare segment only after the parents', () => {
  const c = clipSlugCandidates({ title: '', heading: null, url: SKILL('one') });
  assert.equal(c[0], 'one-SKILL');
  assert.equal(c[1], 'skills-one-SKILL');
  assert.ok(c.indexOf('SKILL') > c.indexOf('v4.2.1-skills-one-SKILL'), 'the bare last segment comes after every parent form');
});

test('a heading names a document that has no title', () => {
  assert.equal(clipSlugCandidates({ title: '', heading: 'Cone Lights', url: SKILL('one') })[0], 'Cone Lights');
});

test('no candidate carries a doubled extension: a .md source gives a name the writer can finish with one .md', () => {
  const c = clipSlugCandidates({ title: '', url: SKILL('one') });
  assert.ok(c.every((s) => !/\.md$/i.test(s)), c.filter((s) => /\.md$/i.test(s)).join(','));
  assert.ok(c.every((s) => !/\.md\.md$/i.test(`${s}.md`)));
  const other = clipSlugCandidates({ title: '', url: 'https://raw.githubusercontent.com/o/r/v3.7.1/config/config.go' });
  assert.equal(other[0], 'config-config.go', 'a non-markdown extension is part of the name and is not doubled');
});

test('candidates are unique ignoring case, deterministic, and end in URL-hash forms', () => {
  const a = clipSlugCandidates({ title: 'Doc', url: 'https://x.test/Doc' });
  assert.deepEqual(a, clipSlugCandidates({ title: 'Doc', url: 'https://x.test/Doc' }));
  assert.equal(new Set(a.map((s) => s.toLowerCase())).size, a.length);
  assert.match(a.at(-1), /-[0-9a-f]{7}-\d+$|-[0-9a-f]{7}$/);
  assert.ok(a.length <= MAX_SLUG_ATTEMPTS);
});

test('chooseClipSlug takes the first free candidate and skips names taken in any letter case', () => {
  const url = 'https://x.test/a/doc';
  assert.deepEqual(chooseClipSlug({ title: 'Doc', url, exists: exists(new Set()) }), { slug: 'Doc' });
  // 'doc' is taken, which in any letter case is also 'Doc' and the bare last segment 'doc'; the next candidate is the parent form.
  assert.equal(chooseClipSlug({ title: 'Doc', url, exists: exists(new Set(['doc'])) }).slug, 'a-doc');
});

test('four title-less documents with one basename each get their own name, and none is lost', () => {
  const taken = new Set(['untitled']);
  const slugs = [];
  for (const name of ['one', 'two', 'three', 'four']) {
    const r = chooseClipSlug({ title: '', url: SKILL(name), exists: exists(taken) });
    assert.ok(r.slug, `${name} must get a name`);
    taken.add(r.slug.toLowerCase());
    slugs.push(r.slug);
  }
  assert.deepEqual(slugs, ['one-SKILL', 'two-SKILL', 'three-SKILL', 'four-SKILL']);
});

test('two versions of one file get distinct names from the version segment, and a query-only difference falls to the URL hash', () => {
  const taken = new Set();
  const a = chooseClipSlug({ title: '', url: 'https://raw.example.org/x/1.4.4/man/inkscape.pod.in', exists: exists(taken) });
  taken.add(a.slug.toLowerCase());
  const b = chooseClipSlug({ title: '', url: 'https://raw.example.org/x/1.4.3/man/inkscape.pod.in', exists: exists(taken) });
  assert.notEqual(a.slug.toLowerCase(), b.slug.toLowerCase());
  const q1 = chooseClipSlug({ title: '', url: 'https://x.test/doc?v=1', exists: exists(new Set()) });
  const t2 = new Set([q1.slug.toLowerCase(), 'doc']);
  const q2 = chooseClipSlug({ title: '', url: 'https://x.test/doc?v=2', exists: exists(t2) });
  assert.ok(q2.slug && !t2.has(q2.slug.toLowerCase()));
});

test('when no candidate is free it returns a clash naming the primary candidate, and it is bounded', () => {
  let calls = 0;
  const r = chooseClipSlug({ title: 'Doc', url: 'https://x.test/a/doc', exists: () => { calls++; return true; } });
  assert.deepEqual(r, { clash: true, existing: 'Doc' });
  assert.ok(calls <= MAX_SLUG_ATTEMPTS, `${calls} probes`);
});

test('uniqueTitle leaves a free or empty title alone, and otherwise appends the URL part that tells the documents apart', () => {
  const none = new Set();
  assert.equal(uniqueTitle({ title: 'Lopez', url: 'https://x.test/a/93-1260.ZO.html', taken: none }), 'Lopez');
  assert.equal(uniqueTitle({ title: '', url: 'https://x.test/a', taken: new Set(['']) }), '');
  const taken = new Set(['lopez']);
  assert.equal(uniqueTitle({ title: 'Lopez', url: 'https://x.test/a/93-1260.ZO.html', taken }), 'Lopez (93-1260.ZO)');
});

test('uniqueTitle walks to the parent segments and then the hash when the first extension is taken too', () => {
  const url = 'https://x.test/a/b/doc.html';
  const taken = new Set(['t', 't (doc)']);
  assert.equal(uniqueTitle({ title: 'T', url, taken }), 'T (b/doc)');
  taken.add('t (b/doc)'); taken.add('t (a/b/doc)');
  assert.match(uniqueTitle({ title: 'T', url, taken }), /^T \([0-9a-f]{7}\)$/);
});

test('a title that itself ends in .md does not give a doubled extension either', () => {
  const c = clipSlugCandidates({ title: 'README.md', url: 'https://x.test/o/r/README.md' });
  assert.equal(c[0], 'README');
  assert.ok(c.every((s) => !/\.md$/i.test(s)));
});
