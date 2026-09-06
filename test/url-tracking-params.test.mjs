// Session and tracking parameters are not part of a resource's identity, and
// treating them as if they were let one article into the vault twice.
//
// Found 2026-09-05 replaying the failed-clip queue: unrealengine.com's MetaHuman
// article landed as two clippings with an IDENTICAL source-hash, under urls
// differing only by `?sessionInvalidated=true`. isDuplicateUrl is a pre-fetch
// gate, so it never saw the hashes -- it compared the urls, found them
// different, and fetched the same article twice.
//
// The fix has to stay narrow. normalizeUrl's own comment records why the query
// string is KEPT: an earlier version dropped it wholesale and collapsed every
// news.ycombinator.com/item?id=X to one string, discarding genuinely different
// content as a false duplicate. So this strips a named list, never the query.
//
// The list is grounded in the reference vault, not in guesswork: across 2,341
// clippings only 47 carry a query string at all, and their parameters are
// id(26) v(6) lang(4) hl(2) key(2) fmt(2) moc(1) sessionInvalidated(1)
// inline(1) p(1) pid(1) c(1) download(1). Exactly one of those is a session
// artifact. Every other one carries identity and must survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, isDuplicateUrl } from '../scripts/lib/url.mjs';

test('the session parameter that caused the duplicate is stripped', () => {
  const canonical = 'https://www.unrealengine.com/en-US/blog/delivering-high-quality-facial-animation';
  assert.equal(normalizeUrl(`${canonical}?sessionInvalidated=true`), normalizeUrl(canonical));
});

test('the two urls that produced one duplicated article now dedupe', () => {
  const a = 'https://www.unrealengine.com/en-US/blog/metahuman-animator-is-now-available';
  const b = `${a}?sessionInvalidated=true`;
  assert.equal(isDuplicateUrl(b, [a]), true, 'the second fetch must never happen');
});

test('common ad and analytics trackers are stripped', () => {
  const base = 'https://example.test/article';
  for (const q of ['utm_source=x', 'utm_medium=y', 'utm_campaign=z', 'fbclid=abc', 'gclid=def', 'mc_eid=ghi']) {
    assert.equal(normalizeUrl(`${base}?${q}`), normalizeUrl(base), `${q} should not change identity`);
  }
});

test('a stripped query leaves no dangling question mark', () => {
  assert.equal(normalizeUrl('https://example.test/a?utm_source=x'), 'https://example.test/a');
});

// ---------------------------------------------------------------------------
// What must NOT be stripped — each of these is real identity in this vault
// ---------------------------------------------------------------------------

test('identity-bearing parameters survive, which is the whole reason the query is kept', () => {
  const cases = [
    'https://news.ycombinator.com/item?id=123',       // id — 26 occurrences
    'https://www.youtube.com/watch?v=abc',            // v  — 6
    'https://eric.ed.gov/?id=EJ944956',               // id, real vault source
    'https://www.cool.osd.mil/army/moc/index.html?moc=15g',            // moc — real
    'http://www.turnonccmath.net/ajax.php?key=length-area-volume&fmt=html', // key+fmt — real
  ];
  for (const u of cases) {
    assert.equal(normalizeUrl(u), normalizeUrl(u), 'sanity');
    assert.ok(normalizeUrl(u).includes('?'), `${u} must keep its query`);
  }
});

test('two different items on a query-identity site stay different', () => {
  // The regression an earlier version of normalizeUrl actually shipped.
  assert.notEqual(
    normalizeUrl('https://news.ycombinator.com/item?id=1'),
    normalizeUrl('https://news.ycombinator.com/item?id=2')
  );
  assert.equal(isDuplicateUrl('https://news.ycombinator.com/item?id=2', ['https://news.ycombinator.com/item?id=1']), false);
});

test('language parameters are NEVER stripped — a translated page is different content', () => {
  // This vault pins Defuddle to `--lang en` precisely because a silently
  // translated clipping is worse than a failed one (see clip.mjs CLIP_LANG).
  // `lang` and `hl` appear 6 times across real sources; folding them together
  // would let a Japanese page satisfy the dedup gate for an English one.
  assert.notEqual(
    normalizeUrl('https://ai.google.dev/docs?hl=ja'),
    normalizeUrl('https://ai.google.dev/docs?hl=en')
  );
  assert.notEqual(
    normalizeUrl('https://example.test/doc?lang=fr'),
    normalizeUrl('https://example.test/doc?lang=en')
  );
});

test('a tracker mixed with real identity strips only the tracker', () => {
  assert.equal(
    normalizeUrl('https://www.youtube.com/watch?v=abc&utm_source=newsletter'),
    normalizeUrl('https://www.youtube.com/watch?v=abc')
  );
});

test('a url that does not parse is returned untouched, as before', () => {
  assert.equal(normalizeUrl('not a url'), 'not a url');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(undefined), '');
});
