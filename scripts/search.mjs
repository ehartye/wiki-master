import {
  readFileSync, existsSync, statSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { embed as ollamaEmbed, isAvailable, modelPresent, EMBED_MODEL, OLLAMA_HOST } from './lib/embed.mjs';
import { decodeVectors, queryPages, coverage } from './lib/vector-index.mjs';
import { resolveVault, obsidianJson } from './lib/vault.mjs';
import { assessTiers, shouldAnnounceFull, statusLine, fullReport, setupPlan } from './lib/search-health.mjs';
import { statusReport } from './index-embed.mjs';

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
  const results = keywordHits.map((path) => ({ path }));

  if (ollamaUp && hasIndex) {
    try {
      const semanticHits = await semanticRun(query);
      // mergeRRF only knows path lists; carry each path's best startLine
      // through separately so a fused hit still tells an agent which line to
      // jump to when the semantic channel is the one that supplied it.
      const lineByPath = new Map(
        semanticHits.filter((h) => h.startLine != null).map((h) => [h.path, h.startLine])
      );
      const fused = mergeRRF([keywordHits, semanticHits.map((h) => h.path)])
        .map((r) => (lineByPath.has(r.path) ? { ...r, startLine: lineByPath.get(r.path) } : r));
      return { tier: 'hybrid', results: fused };
    } catch (err) {
      // isAvailable() proves only that the server answers -- a reachable
      // Ollama with the model never pulled 404s on every embed call
      // (confirmed live: `Ollama embeddings HTTP 404`). Rather than crash
      // the whole query on what search-health.mjs calls the one state where
      // the tier label would otherwise be actively false, fall back to
      // lexical, same as the qmd tier's own established philosophy (an
      // optional accelerator that fails at runtime falls through).
      return { tier: 'lexical', results, note: `semantic channel failed (${err.message}) -- run \`node scripts/search.mjs --health\`` };
    }
  }

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

// Shared setup for a query: resolves the vault, loads the chunk index once,
// and checks Ollama once. Used by both `main()` (the library entrypoint --
// scripts/purge.mjs calls this via collectSeeds, so its `{ tier, results }`
// contract must not change) and the CLI's `runQuery` below, which needs the
// same facts (ollamaUp, the loaded index) to build the health disclosure
// without loading the ~17MB vector store a second time.
async function loadSearchContext(vaultPath, limit) {
  const indexDir = join(vaultPath, '.wiki-master');
  const index = loadChunkIndex(indexDir);
  const ollamaUp = await isAvailable();
  const semanticRun = async (q) => semanticSearch(q, {
    vectors: index.vectors,
    manifest: index.manifest,
    embedFn: ollamaEmbed,
    topN: limit,
  });
  return { indexDir, index, ollamaUp, semanticRun };
}

export async function main(query, { limit = 10 } = {}) {
  const { path: vaultPath } = resolveVault();
  const { index, ollamaUp, semanticRun } = await loadSearchContext(vaultPath, limit);

  return search(query, {
    keywordSearch: async (q) => keywordSearch(q, { limit }),
    ollamaAvailable: async () => ollamaUp,
    indexAvailable: () => index.available,
    semanticRun,
  });
}

// Pure formatting: given a search() result and an assessTiers() verdict,
// decides what a caller sees on each stream. stdout carries ONLY the answer
// (paths, optionally :line) so piping stays clean (`search.mjs "q" | ...`);
// every diagnostic -- the tier line, the full block, search()'s own note --
// goes to stderr. This is the never-silent guarantee itself: a degraded
// search always emits at least the one-liner naming what is off, whether or
// not the caller is watching stderr.
export function renderResult({ results, note }, assessed, { chunks, announceFull = false } = {}) {
  const stderr = announceFull
    ? fullReport(assessed, { chunks }).split('\n')
    : [statusLine(assessed, { chunks })];
  if (note) stderr.push(note);

  const stdout = results.map((hit) => (hit.startLine != null ? `${hit.path}:${hit.startLine}` : hit.path));
  return { stdout, stderr };
}

const NOTICE_FILE = 'search-notice.json';

function readNoticeIso(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, NOTICE_FILE), 'utf8')).lastNoticeIso ?? null;
  } catch {
    return null;
  }
}

function writeNoticeIso(dir, iso) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, NOTICE_FILE), JSON.stringify({ lastNoticeIso: iso }));
}

// Builds the same { ollama, index } shape assessTiers() expects. `filesChanged`
// defaults to 0 (skip the vault walk) unless the caller already paid for a
// statusReport -- see the design spec's own warning against re-walking/
// re-hashing the vault on every query (section 3).
async function buildAssessment({ index, ollamaUp, cov, filesChanged = 0 }) {
  const modelOk = ollamaUp ? await modelPresent() : false;
  return assessTiers({
    ollama: { reachable: ollamaUp, modelPresent: modelOk, model: EMBED_MODEL },
    index: { available: index.available, coverage: cov, filesChanged },
  });
}

async function runQuery(query) {
  const { path: vaultPath } = resolveVault();
  const { indexDir, index, ollamaUp, semanticRun } = await loadSearchContext(vaultPath, 10);

  const result = await search(query, {
    keywordSearch: async (q) => keywordSearch(q, { limit: 10 }),
    ollamaAvailable: async () => ollamaUp,
    indexAvailable: () => index.available,
    semanticRun,
  });

  const cov = coverage(index.manifest, Object.keys(index.vectors));
  const announceFull = shouldAnnounceFull(readNoticeIso(indexDir), Date.now());

  // Only the (rare) first-in-window full block pays the cost of walking the
  // vault for staleness -- every other query skips it, per the design spec's
  // section 3 finding that this walk-and-hash was 211ms of avoidable work.
  let filesChanged = 0;
  if (announceFull) {
    try {
      filesChanged = statusReport({ vaultPath, dir: indexDir }).filesChanged;
    } catch { /* a missing/unreadable vault must not block results */ }
  }

  const assessed = await buildAssessment({ vaultPath, indexDir, index, ollamaUp, cov, filesChanged });
  const { stdout, stderr } = renderResult(result, assessed, { chunks: cov.chunks, announceFull });

  for (const line of stderr) console.error(line);
  for (const line of stdout) console.log(line);

  if (announceFull) writeNoticeIso(indexDir, new Date().toISOString());
}

async function runHealthCommand() {
  const { path: vaultPath } = resolveVault();
  const indexDir = join(vaultPath, '.wiki-master');
  const index = loadChunkIndex(indexDir);
  const ollamaUp = await isAvailable();
  const cov = coverage(index.manifest, Object.keys(index.vectors));

  let files = Object.keys(index.manifest).length;
  let filesChanged = 0;
  let filesRemoved = 0;
  try {
    const r = statusReport({ vaultPath, dir: indexDir });
    files = r.files; filesChanged = r.filesChanged; filesRemoved = r.filesRemoved;
  } catch { /* vault unreadable -- report what the index itself knows */ }

  const assessed = await buildAssessment({ vaultPath, indexDir, index, ollamaUp, cov, filesChanged });
  const modelOk = ollamaUp ? await modelPresent() : false;

  const sizeBytes = ['chunks.json', 'vectors.bin', 'vectors.idx.json']
    .reduce((sum, f) => { try { return sum + statSync(join(indexDir, f)).size; } catch { return sum; } }, 0);

  console.log('wiki-master search health');
  console.log(`  tier: ${assessed.tier}`);
  console.log(`  ollama: host=${OLLAMA_HOST} model=${EMBED_MODEL} reachable=${ollamaUp} model-pulled=${modelOk}`);
  console.log(
    `  index: ${files} file(s), ${cov.chunks} chunk(s) (${cov.embedded} embedded, ${cov.missing} missing), ` +
    `${filesChanged} changed / ${filesRemoved} removed since last refresh, ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB on disk`
  );
  if (assessed.gaps.length) {
    console.log('  gaps:');
    for (const g of assessed.gaps) {
      console.log(`    - ${g.channel}: ${g.state}${g.misreports ? ' [misreports]' : ''}`);
      console.log(`        costs: ${g.buys}`);
      console.log(`        fix:   ${g.fix}`);
    }
  } else {
    console.log('  all channels healthy.');
  }
}

async function runSetupCommand() {
  const { path: vaultPath } = resolveVault();
  const indexDir = join(vaultPath, '.wiki-master');
  const index = loadChunkIndex(indexDir);
  const ollamaUp = await isAvailable();
  const cov = coverage(index.manifest, Object.keys(index.vectors));

  let filesChanged = 0;
  try { filesChanged = statusReport({ vaultPath, dir: indexDir }).filesChanged; } catch { /* best effort */ }

  const assessed = await buildAssessment({ vaultPath, indexDir, index, ollamaUp, cov, filesChanged });
  console.log(setupPlan(assessed));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--health')) {
    await runHealthCommand();
  } else if (argv.includes('--setup')) {
    await runSetupCommand();
  } else {
    const query = argv.join(' ');
    if (!query) {
      console.error('usage: node scripts/search.mjs "<question>" | --health | --setup');
      process.exit(1);
    } else {
      await runQuery(query);
    }
  }
}
