// Re-clipping a source changes its content, and therefore its hash. Every summary
// that recorded the old hash must follow, or the freshly-clipped source is orphaned
// and returns as ingest backlog. Exact string swap — hashes are hex, so no escaping.
export function swapSourceHash(pageText, oldHash, newHash) {
  if (!oldHash || !pageText.includes(oldHash)) return pageText;
  return pageText.split(oldHash).join(newHash);
}

// Move a summary page's citation from an extracted binary to its new .md clipping.
// Operates only inside the frontmatter block (where `sources:` lives), by exact
// string replacement — the target may contain regex-special characters (`.`, `(`),
// so no regex is applied to it. Returns the page unchanged if the citation is absent.
export function repointCitation(pageText, fromTarget, toTarget) {
  const fm = pageText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return pageText;
  const needle = `[[${fromTarget}]]`;
  if (!fm[2].includes(needle)) return pageText;
  const block = fm[2].split(needle).join(`[[${toTarget}]]`);
  return fm[1] + block + fm[3] + pageText.slice(fm[0].length);
}
