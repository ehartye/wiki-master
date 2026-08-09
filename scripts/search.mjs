import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { embed as ollamaEmbed, isAvailable } from './lib/embed.mjs';
import { decodeVectors, queryPages } from './lib/vector-index.mjs';
import { resolveVault, obsidianJson } from './lib/vault.mjs';

const CHUNKS_FILE = 'chunks.json';
const VECTORS_BIN = 'vectors.bin';
const VECTORS_IDX = 'vectors.idx.json';

// Loads the chunk-level semantic index built by index-embed.mjs, touching
// only the three fixed files under .wiki-master/ -- never the vault's wiki/
// content itself. A query must never walk or hash the vault (that was 211ms
// of avoidable work on every search -- design spec section 3): the manifest
// already knows every chunk's path and line, so this is the only I/O the
// query path needs. `readFileImpl` is injectable so callers can prove that
// (see test/search.test.mjs).
//
// A missing or empty index is a first-class, non-fatal state (design spec
// section 5.5 / 5.3): building one takes minutes, so a query must never
// trigger a build. `available: false` tells search() to skip the semantic
// channel and fall back to the lexical tier rather than block or error.
// Availability is judged on total CHUNK count, not file count -- a manifest
// entry with an empty chunks array must not count as coverage.
export function loadChunkIndex(dir, { readFileImpl = readFileSync, existsImpl = existsSync } = {}) {
  const manifestFile = join(dir, CHUNKS_FILE);
  const binFile = join(dir, VECTORS_BIN);
  const idxFile = join(dir, VECTORS_IDX);
  if (!existsImpl(manifestFile) || !existsImpl(binFile) || !existsImpl(idxFile)) {
    return { manifest: {}, vectors: {}, available: false };
  }
  const manifest = JSON.parse(readFileImpl(manifestFile, 'utf8'));
  const idx = JSON.parse(readFileImpl(idxFile, 'utf8'));
  const vectors = decodeVectors(readFileImpl(binFile), idx);
  const totalChunks = Object.values(manifest).reduce((n, e) => n + (e.chunks?.length ?? 0), 0);
  return { manifest, vectors, available: totalChunks > 0 && Object.keys(vectors).length > 0 };
}

// Embeds the query exactly once (Ollama's keepAlive default now keeps the
// model resident between calls -- see lib/embed.mjs -- so there is no longer
// a reason to cache it), then ranks pages via queryPages: a page's score is
// the mean of its chunk vectors (measured to retrieve better than ranking by
// best chunk alone -- see queryPages' own comment for the numbers and their
// caveat), and it carries its single best chunk's startLine as the passage
// to jump to. Chunks, unlike whole pages, never exceed the embedding
// model's context window, so there is no truncate-and-retry path here --
// that was only ever a workaround for whole-page embedding, and removing it
// is the point of the chunk index.
export async function semanticSearch(query, { vectors, manifest, embedFn, topN = 10 } = {}) {
  const qVec = await embedFn(query);
  return queryPages(qVec, vectors, manifest, { topN });
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

// The tiering ladder, isolated from real I/O behind injected deps so it is
// unit-testable without a live Ollama/Obsidian/index. `keywordSearch` always
// runs when needed (obsidian search always works or the vault is broken
// anyway); the semantic channel needs BOTH a reachable Ollama AND a built
// index -- either missing on its own degrades to `lexical`, never a partial
// or misleading `hybrid` (design spec section 5.4/5.5). A built-but-empty
// index (see loadChunkIndex) counts as absent, not present.
export async function search(query, deps) {
  const { keywordSearch, ollamaAvailable, indexAvailable, semanticRun } = deps;
  const keywordHits = await keywordSearch(query);
  const ollamaUp = await ollamaAvailable();
  const hasIndex = await indexAvailable();

  if (ollamaUp && hasIndex) {
    const semanticHits = await semanticRun(query);
    // mergeRRF only knows path lists; carry each path's best startLine
    // through separately so a fused hit still tells an agent which line to
    // jump to when the semantic channel is the one that supplied it.
    const lineByPath = new Map(
      semanticHits.filter((h) => h.startLine != null).map((h) => [h.path, h.startLine])
    );
    const results = mergeRRF([keywordHits, semanticHits.map((h) => h.path)])
      .map((r) => (lineByPath.has(r.path) ? { ...r, startLine: lineByPath.get(r.path) } : r));
    return { tier: 'hybrid', results };
  }

  const results = keywordHits.map((path) => ({ path }));
  if (ollamaUp && !hasIndex) {
    // The one case where the caller's next action differs from "Ollama is
    // down": there is a fix (`node scripts/index-embed.mjs`), not a wait.
    return { tier: 'lexical', results, note: 'semantic index missing or empty -- run `node scripts/index-embed.mjs` to build it' };
  }
  return { tier: 'lexical', results };
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
  const indexDir = join(vaultPath, '.wiki-master');
  const index = loadChunkIndex(indexDir);

  const semanticRun = async (q) => semanticSearch(q, {
    vectors: index.vectors,
    manifest: index.manifest,
    embedFn: ollamaEmbed,
    topN: limit,
  });

  return search(query, {
    keywordSearch: async (q) => keywordSearch(q, { limit }),
    ollamaAvailable: () => isAvailable(),
    indexAvailable: () => index.available,
    semanticRun,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('usage: node scripts/search.mjs "<question>"');
    process.exit(1);
  }
  main(query).then((r) => {
    console.log(`(${r.tier})`);
    if (r.note) console.error(r.note);
    for (const hit of r.results) {
      console.log(hit.startLine != null ? `  ${hit.path}:${hit.startLine}` : `  ${hit.path}`);
    }
  });
}
