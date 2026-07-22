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

// Mirrors init.mjs's defuddleAvailable() exactly: try the command, ignore
// stdio, catch -> false. qmd is never a package.json dependency -- only ever
// detected on PATH, the same relationship this codebase already has with
// Ollama and Defuddle (present -> used; absent -> the next tier down).
export function qmdAvailable(execImpl) {
  try { execImpl('qmd --version'); return true; } catch { return false; }
}

// The tiering ladder, isolated from real I/O behind injected deps so it is
// unit-testable without a live qmd/Ollama/Obsidian. `keywordSearch` always
// runs when needed (obsidian search always works or the vault is broken
// anyway); `qmdRun`/`semanticRun` are each optional and independently probed.
// A qmd that is PRESENT but fails at runtime (corrupt index, model load
// error) falls through rather than surfacing a hard error from what is by
// design an optional accelerator, not a load-bearing dependency.
export async function search(query, deps) {
  const { keywordSearch, qmdProbe, qmdRun, ollamaAvailable, semanticRun } = deps;
  if (qmdProbe()) {
    try {
      return { tier: 'qmd', results: await qmdRun(query) };
    } catch { /* fall through to the next tier */ }
  }
  const keywordHits = await keywordSearch(query);
  if (await ollamaAvailable()) {
    const semanticHits = await semanticRun(query);
    return { tier: 'hybrid', results: mergeRRF([keywordHits, semanticHits.map((h) => h.path)]) };
  }
  return { tier: 'keyword', results: keywordHits.map((path) => ({ path })) };
}
