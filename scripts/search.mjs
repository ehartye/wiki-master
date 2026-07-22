import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cosine, embed as ollamaEmbed, isAvailable } from './lib/embed.mjs';
import { hash, loadCache, saveCache } from './lib/embed-cache.mjs';
import { resolveVault, obsidian, obsidianJson } from './lib/vault.mjs';
import { isContent } from './lib/graph.mjs';

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
    if (cache[h]) {
      scored.push({ path: p.path, score: cosine(qVec, cache[h]) });
      continue;
    }
    // A single oversized/unusual page must not take the whole search down.
    // Confirmed live: a long page exceeding the embedding model's context
    // window makes Ollama return HTTP 500 -- an embedding-model limit, not a
    // wiki-master defect, but one page's failure is not fatal to the rest.
    try {
      const vec = await embedFn(p.body);
      cache[h] = vec;
      scored.push({ path: p.path, score: cosine(qVec, vec) });
    } catch (err) {
      console.error(`search: skipping ${p.path} (embedding failed: ${err.message})`);
    }
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

// The one-time setup this tier requires (documented, not automated -- auto-
// provisioning a qmd collection behind a user's back was rejected: they may
// already use qmd with their own collection naming scheme, and this stays an
// optional accelerator, not something with silent side effects):
//   qmd collection add <vault>/wiki --name wiki-master && qmd embed
const QMD_COLLECTION = 'wiki-master';

// Shells out to `qmd search` specifically -- never `query` or `vsearch`.
// Confirmed live during implementation: `search` (hybrid BM25+vector, no LLM
// step) needs only the ~330MB embedding model `qmd embed` already fetched;
// `vsearch` and `query` BOTH additionally pull a 1.28GB query-expansion model
// (and `query` a further reranking model) on first use -- a surprise
// multi-gigabyte download this integration deliberately avoids triggering.
// qmd is invoked purely as an external CLI, never an in-process import, so
// its own Node >=22 engine requirement is never wiki-master's constraint.
//
// Real output shape below is confirmed against a live `qmd search --json`
// run, not assumed from documentation: a bare JSON array of
// {docid, score, file: "qmd://<collection>/<path>", line, title, snippet}.
export function qmdSearch(query, { execImpl = execSync, limit = 10 } = {}) {
  const out = execImpl(
    `qmd search ${JSON.stringify(query)} -c ${QMD_COLLECTION} --json -n ${limit}`,
    { encoding: 'utf8' }
  );
  const hits = JSON.parse(out);
  const prefix = `qmd://${QMD_COLLECTION}/`;
  return hits
    .map((h) => ({
      path: typeof h.file === 'string' && h.file.startsWith(prefix) ? h.file.slice(prefix.length) : null,
      score: h.score,
    }))
    .filter((h) => h.path);
}

// The `obsidian` CLI's `search` command prints the plain-text sentence "No
// matches found." even when `format=json` is requested -- confirmed live
// during implementation, where it broke `obsidianJson`'s JSON.parse with a
// SyntaxError. A zero-hit search is not a failure; it just means the keyword
// channel contributes nothing to this query, so it is treated the same as an
// empty result list rather than allowed to crash the whole tiering ladder.
export function keywordSearch(query, { limit = 10, obsidianJsonImpl = obsidianJson } = {}) {
  try {
    return obsidianJsonImpl(['search', `query=${query}`, 'path=wiki', `limit=${limit}`]) ?? [];
  } catch {
    return [];
  }
}

export async function main(query, { limit = 10 } = {}) {
  const { path: vaultPath } = resolveVault();
  const cacheDir = join(vaultPath, '.wiki-master');
  const cache = loadCache(cacheDir);
  const cachedEmbed = async (text) => {
    const k = hash(text);
    if (cache[k]) return cache[k];
    const v = await ollamaEmbed(text);
    cache[k] = v;
    return v;
  };

  const semanticRun = async (q) => {
    const files = obsidian(['files', 'ext=md']).split(/\r?\n/).filter(Boolean);
    const pages = files
      .filter((rel) => rel.startsWith('wiki/') && isContent(rel))
      .map((rel) => ({ path: rel, body: readFileSync(join(vaultPath, rel), 'utf8') }));
    // Honesty, not silence: a cold cache means embedding every uncached page
    // before the first real answer -- up to low-hundreds of sequential Ollama
    // calls on a vault this size (spec S4's "known, honest cost"). Report it
    // rather than let the caller wonder why the first call is slow.
    const uncached = pages.filter((p) => !cache[hash(p.body)]).length;
    if (uncached > 5) console.error(`warming semantic cache: ${uncached}/${pages.length} pages`);
    return semanticSearch(q, pages, { embedFn: cachedEmbed, cache, topN: limit });
  };

  const r = await search(query, {
    keywordSearch: async (q) => keywordSearch(q, { limit }),
    qmdProbe: () => qmdAvailable((cmd) => execSync(cmd, { stdio: 'ignore' })),
    qmdRun: async (q) => qmdSearch(q, { limit }),
    ollamaAvailable: () => isAvailable(),
    semanticRun,
  });

  saveCache(cacheDir, cache);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('usage: node scripts/search.mjs "<question>"');
    process.exit(1);
  }
  main(query).then((r) => {
    console.log(`(${r.tier})`);
    for (const hit of r.results) console.log(`  ${hit.path}`);
  });
}
