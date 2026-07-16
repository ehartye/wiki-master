export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return (x.origin + x.pathname).replace(/\/$/, '');
  } catch {
    return (u || '');
  }
}

export function isDuplicateUrl(url, knownUrls) {
  const n = normalizeUrl(url).toLowerCase();
  return knownUrls.some((k) => normalizeUrl(k).toLowerCase() === n);
}
