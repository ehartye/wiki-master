import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, slugFromUrl, normalizeUrl, isDuplicateUrl, buildFrontmatter, disambiguateSlug, classifyShortExtraction } from '../scripts/clip.mjs';

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

test('normalizeUrl preserves the query string — it is the resource identity on many sites', () => {
  // Real bug: news.ycombinator.com/item?id=X previously normalized to the
  // same string for every X, so a second, genuinely distinct HN thread was
  // silently rejected as a "duplicate" of the first before ever being fetched.
  assert.equal(
    normalizeUrl('https://news.ycombinator.com/item?id=44119185'),
    'https://news.ycombinator.com/item?id=44119185',
  );
  assert.notEqual(
    normalizeUrl('https://news.ycombinator.com/item?id=44119185'),
    normalizeUrl('https://news.ycombinator.com/item?id=44119521'),
  );
  // Fragment is still dropped even when a query string is present.
  assert.equal(normalizeUrl('https://x.com/a?b=1#frag'), 'https://x.com/a?b=1');
  // Trailing slash before a query string is still normalized away.
  assert.equal(normalizeUrl('https://x.com/a/?b=1'), 'https://x.com/a?b=1');
});

test('isDuplicateUrl matches ignoring trailing slash / fragment', () => {
  assert.equal(isDuplicateUrl('https://x.com/a/', ['https://x.com/a']), true);
  assert.equal(isDuplicateUrl('https://x.com/b', ['https://x.com/a']), false);
});

test('isDuplicateUrl does not collapse distinct query-string-identified resources', () => {
  // The three real HN comment permalinks this bug affected.
  const known = [
    'https://news.ycombinator.com/item?id=44119185',
    'https://news.ycombinator.com/item?id=39486181',
  ];
  assert.equal(isDuplicateUrl('https://news.ycombinator.com/item?id=44119521', known), false);
  assert.equal(isDuplicateUrl('https://news.ycombinator.com/item?id=44119185', known), true);
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

// classifyShortExtraction — fixtures below are drawn from real reproduction
// cases (RAPS's "wrong node" bug and an FDA.gov guidance-docket stub page were
// both confirmed live against the actual sites during triage of thin-content
// false negatives).

test('classifyShortExtraction: empty shell — short body, no substantive description, no article/main container', () => {
  const v = classifyShortExtraction({
    markdown: 'Please enable JavaScript to view this page.',
    rawHtml: '<div id="root"></div>',
    description: '',
  });
  assert.equal(v.kind, 'empty_shell');
  assert.match(v.reason, /thin content/);
});

test('classifyShortExtraction: wrong_node — substantive description not reflected in a short, non-article body (real RAPS reproduction)', () => {
  // Reproduces the confirmed live bug verbatim (real Defuddle output, captured
  // during triage): Defuddle's description extraction was accurate, but its
  // "content" picked a short, unrelated "This Week at FDA" recirculation widget
  // instead of the real article body. The two texts are both FDA-regulatory
  // news and coincidentally share one distinctive word ("issued") despite being
  // about entirely different stories — an early version of this classifier used
  // "at least one shared word" and was fooled by exactly this coincidence; the
  // fixture is kept verbatim (not simplified) so that regression stays caught.
  const v = classifyShortExtraction({
    markdown:
      'Welcome to another installment of This Week at FDA, your weekly source for updates – big and small – on FDA, ' +
      'drug and medical device regulation, and what we’re reading from around the web. This week, FDA staff raised ' +
      'concerns internally about conflicts of interest ahead of a panel on peptides next week, a top Democrat is ' +
      'seeking an investigation into the effects of the DOGE cuts on FDA, and the agency’s acting commissioner ' +
      'backtracked on some policies issued by his predecessor.',
    rawHtml:
      '<div> <div> <a href="https://www.raps.org/resource/this-week-at-fda...html"><picture><img src="thumb.jpg">' +
      '</picture></a> </div> </div>',
    description:
      "WASHINGTON – The US Food and Drug Administration's (FDA) Jill Furman, director of the Center for Drug " +
      "Evaluation and Research's (CDER) Office of Compliance (OC), reported that there has been a 50% increase " +
      'in warning letters issued by CDER in FY 2025. She noted that a significant portion of this increase is due ' +
      'to letters sent to telehealth platforms that are making false claims about compounded drug products.',
  });
  assert.equal(v.kind, 'wrong_node');
  assert.match(v.reason, /wrong-node extraction/);
});

test('classifyShortExtraction: short_real_article — genuine <article> container, brief but real content (real FDA.gov reproduction)', () => {
  // Reproduces a confirmed live case: FDA's guidance-document docket pages are
  // legitimately one paragraph (the real guidance text lives in a linked PDF),
  // and Defuddle extracts them correctly — the flat word floor alone would wrongly
  // discard this as thin content. Fixture text is the real page content (56 words).
  const v = classifyShortExtraction({
    markdown:
      'This internationally harmonized guidance is intended to assist pharmaceutical manufacturers by describing ' +
      'a model for an effective quality management system for the pharmaceutical industry, referred to as the ' +
      'pharmaceutical quality system. Throughout this guidance, the term pharmaceutical quality system refers to ' +
      'the ICH Q10 model. Additional Guidance Resource Q8, Q9, and Q10 Questions and Answers (R5)',
    rawHtml:
      '<article role="article"><p>This internationally harmonized guidance is intended to assist pharmaceutical ' +
      'manufacturers...</p></article>',
    description:
      'This internationally harmonized guidance is intended to assist pharmaceutical manufacturers by describing ' +
      'a model for an effective quality management system for the pharmaceutical industry.',
  });
  assert.equal(v.kind, 'short_real_article');
});

test('classifyShortExtraction: <main> container also counts as structurally real', () => {
  const v = classifyShortExtraction({
    markdown:
      'A short but genuine reference note can still be a real clip rather than an empty shell. This fixture ' +
      'deliberately exceeds the halfway floor threshold used by the classifier so the <main> branch is exercised ' +
      'the same way the <article> branch is above, without relying on a real network fetch or fixture file.',
    rawHtml: '<main><p>A short but genuine reference note...</p></main>',
    description: '',
  });
  assert.equal(v.kind, 'short_real_article');
});

test('classifyShortExtraction: an <article>/<main> wrapper is NOT enough on its own if the body is vanishingly short', () => {
  const v = classifyShortExtraction({
    markdown: 'Loading…',
    rawHtml: '<article><p>Loading…</p></article>',
    description: '',
  });
  assert.notEqual(v.kind, 'short_real_article');
});

test('classifyShortExtraction: a short, generic description does not trigger a wrong_node false positive', () => {
  const v = classifyShortExtraction({
    markdown: 'Nothing much here.',
    rawHtml: '<div>Nothing much here.</div>',
    description: 'Home page',
  });
  assert.equal(v.kind, 'empty_shell');
});

test('classifyShortExtraction: a coincidental single shared word does NOT count as real overlap (proportion, not any-match)', () => {
  // A same-topic-domain false positive that broke an earlier "at least one
  // shared word" version of this heuristic: two unrelated pieces of FDA news
  // can share a single ordinary word ("warning") without the body actually
  // being about what the description describes.
  const v = classifyShortExtraction({
    markdown: 'A completely different short story that happens to mention a warning about something unrelated.',
    rawHtml: '<div>A completely different short story...</div>',
    description:
      'This detailed description covers an entirely separate announcement involving multiple named agencies, ' +
      'a specific enforcement action, and several distinctive regulatory terms that establish real substance here.',
  });
  assert.equal(v.kind, 'wrong_node');
});

test('classifyShortExtraction: genuine high overlap between description and body is NOT flagged as wrong_node', () => {
  // Positive control: when the body really does reflect the description (just
  // briefly/genuinely), that is ordinary short content, not a wrong-node bug.
  const v = classifyShortExtraction({
    markdown: 'This detailed description covers an entirely separate announcement involving multiple named agencies.',
    rawHtml: '<div>This detailed description covers an entirely separate announcement involving multiple named agencies.</div>',
    description:
      'This detailed description covers an entirely separate announcement involving multiple named agencies, ' +
      'a specific enforcement action, and several distinctive regulatory terms that establish real substance here.',
  });
  assert.equal(v.kind, 'empty_shell');
});
