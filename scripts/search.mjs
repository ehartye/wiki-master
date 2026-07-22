import { cosine } from './lib/embed.mjs';
import { hash } from './lib/embed-cache.mjs';

// Ranks every candidate page's (cached-or-freshly-embedded) vector against one
// query embedding. `pages` is [{path, body}]; `cache` is the SAME hash-keyed map
// drift.mjs already populates in .wiki-master/embeddings.json -- an unchanged
// page is never re-embedded, whether drift.mjs or search.mjs embedded it first.
// `body` must be hashed the same way drift.mjs hashes it (full file content,
// frontmatter included -- see drift.mjs's own `body` variable) or the two
// features' cache entries will never hit each other.
export async function semanticSearch(query, pages, { embedFn, cache = {}, topN = 10 } = {}) {
  const qVec = await embedFn(query);
  const scored = [];
  for (const p of pages) {
    const h = hash(p.body);
    const vec = cache[h] ?? (cache[h] = await embedFn(p.body));
    scored.push({ path: p.path, score: cosine(qVec, vec) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

// Reciprocal Rank Fusion (Cormack et al. 2009): merges N ranked path lists into
// one. k=60 is the standard constant -- large enough that rank 1 vs rank 2 in a
// single list differ only slightly, so no one channel dominates purely by
// having placed a result first.
const RRF_K = 60;
export function mergeRRF(lists) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach((path, i) => {
      scores.set(path, (scores.get(path) ?? 0) + 1 / (RRF_K + i + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path, score]) => ({ path, score }));
}
