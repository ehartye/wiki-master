// Drops the fragment (never part of resource identity) and a trailing slash,
// but KEEPS the query string. Many sites encode the actual resource identity
// in the query, not the path — news.ycombinator.com/item?id=X, YouTube's
// /watch?v=X, Wikipedia's /w/index.php?title=X. Dropping the query (as an
// earlier version of this function did, via `origin + pathname` alone)
// collapsed every distinct item on such a site to one identical string,
// silently discarding genuinely different content as a false "duplicate"
// before it was ever fetched (isDuplicateUrl is a pre-fetch gate).
// Parameters that carry no resource identity: session artifacts and ad/analytics
// tags. They are stripped by NAME, one at a time, never by dropping the query --
// see the note above for the regression that caused.
//
// The list is deliberately short and evidence-led. Across the reference vault's
// 2,341 clippings only 47 urls carry a query at all, and their parameters are
// id(26) v(6) lang(4) hl(2) key(2) fmt(2) moc(1) sessionInvalidated(1)
// inline(1) p(1) pid(1) c(1) download(1) -- exactly one session artifact, and
// everything else load-bearing. So the bar for adding a name here is that it
// cannot possibly select different content, and anything ambiguous stays out.
//
// `lang` and `hl` are the pointed omission. They look like presentation, but a
// translated page IS different content: this vault pins Defuddle to `--lang en`
// precisely because a silently translated clipping is worse than a failed one
// (clip.mjs, CLIP_LANG). Folding them together would let a Japanese page satisfy
// the dedup gate for the English one nobody clipped.
const TRACKING_PARAMS = new Set([
  // Session artifacts. `sessionInvalidated` is the one caught in the wild: it
  // put unrealengine.com's MetaHuman article in the vault twice, two clippings
  // with an identical content hash, because the gate runs BEFORE the fetch and
  // so only ever compares urls.
  'sessioninvalidated', 'sessionid', 'jsessionid', 'phpsessid',
  // Campaign tagging.
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  // Ad-network click ids.
  'fbclid', 'gclid', 'dclid', 'msclkid', 'twclid',
  // Mailing-list and analytics ids.
  'mc_cid', 'mc_eid', '_ga', '_gl', 'igshid',
]);

export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    const path = x.pathname.replace(/\/$/, '');
    for (const k of [...x.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) x.searchParams.delete(k);
    }
    // `search` is '?' + the serialization, and an emptied list serializes to ''
    // -- read it back rather than reusing the original, or a fully-stripped url
    // keeps a dangling '?' and stops matching its own clean form.
    return x.origin + path + x.search;
  } catch {
    return (u || '');
  }
}

export function isDuplicateUrl(url, knownUrls) {
  const n = normalizeUrl(url).toLowerCase();
  return knownUrls.some((k) => normalizeUrl(k).toLowerCase() === n);
}
