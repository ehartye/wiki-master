// Drops the fragment (never part of resource identity) and a trailing slash,
// but KEEPS the query string. Many sites encode the actual resource identity
// in the query, not the path — news.ycombinator.com/item?id=X, YouTube's
// /watch?v=X, Wikipedia's /w/index.php?title=X. Dropping the query (as an
// earlier version of this function did, via `origin + pathname` alone)
// collapsed every distinct item on such a site to one identical string,
// silently discarding genuinely different content as a false "duplicate"
// before it was ever fetched (isDuplicateUrl is a pre-fetch gate).
export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    const path = x.pathname.replace(/\/$/, '');
    return x.origin + path + x.search;
  } catch {
    return (u || '');
  }
}

export function isDuplicateUrl(url, knownUrls) {
  const n = normalizeUrl(url).toLowerCase();
  return knownUrls.some((k) => normalizeUrl(k).toLowerCase() === n);
}
