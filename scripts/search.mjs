import {
  readFileSync, existsSync, statSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { embed as ollamaEmbed, isAvailable, modelPresent, EMBED_MODEL, OLLAMA_HOST } from './lib/embed.mjs';
import { decodeVectors, queryPages, coverage } from './lib/vector-index.mjs';
import { resolveVault, obsidianJson, buildArgs } from './lib/vault.mjs';
import { assessTiers, shouldAnnounceFull, statusLine, fullReport, setupPlan } from './lib/search-health.mjs';
import { statusReport } from './index-embed.mjs';
import { hash } from './lib/embed-cache.mjs';
import { buildNameIndex } from './lib/graph.mjs';
import { noteIdentity, exactIdentity, lexicalScore, terms, inScope,
  matchesFilters, passageFor, boundedMetadata, citationProvenance, METADATA_VERSION } from './lib/retrieval.mjs';

const CHUNKS_FILE = 'chunks.json';
const VECTORS_BIN = 'vectors.bin';
const VECTORS_IDX = 'vectors.idx.json';

// Loads the chunk-level semantic index built by index-embed.mjs, touching
// only the three fixed files under .wiki-master/ -- never the vault's wiki/
// content itself. The query path ranks compact manifest metadata first, then
// validates only bounded candidates against live content; it never walks or
// hashes the entire vault. `readFileImpl` is injectable for index-load tests.
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
  if (!existsImpl(manifestFile)) {
    return { manifest: {}, vectors: {}, available: false };
  }
  const manifest = JSON.parse(readFileImpl(manifestFile, 'utf8'));
  if (!existsImpl(binFile) || !existsImpl(idxFile)) return { manifest, vectors: {}, available: false };
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
//
// `rawKeywordSearch` is an OPTIONAL, additive fifth dep -- absent for every
// existing caller (purge.mjs's collectSeeds included), so their behavior is
// byte-for-byte unchanged. When a caller (the wiki-search skill) does supply
// it, raw/ hits are appended AFTER the normal tiering result rather than
// fused into it: raw/ clippings are not chunked/embedded (that was a
// deliberate, documented scope decision -- see index-embed.mjs's own
// comment -- embedding them would roughly triple the index), so there is no
// semantic rank to fuse them into, and blending unvetted raw evidence into
// the same ranked list as reviewed wiki/ pages would erase a distinction
// that matters (a raw/ hit is immutable source evidence, not yet
// synthesized). Each raw hit carries `zone: 'raw'` so a caller can tell
// them apart programmatically, on top of the `raw/` path prefix itself
// already making this visually obvious. `rawCount` is always set (even 0)
// whenever rawKeywordSearch was actually called, so a caller can disclose
// "raw/ was checked and came up empty" rather than raw/ coverage being
// silently indistinguishable from never having been checked at all.
export async function search(query, deps) {
  const { keywordSearch, ollamaAvailable, indexAvailable, semanticRun, rawKeywordSearch } = deps;
  const keywordHits = await keywordSearch(query);
  const ollamaUp = await ollamaAvailable();
  const hasIndex = await indexAvailable();
  const results = keywordHits.map((path) => ({ path }));

  let base;
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
      base = { tier: 'hybrid', results: fused };
    } catch (err) {
      // isAvailable() proves only that the server answers -- a reachable
      // Ollama with the model never pulled 404s on every embed call
      // (confirmed live: `Ollama embeddings HTTP 404`). Rather than crash
      // the whole query on what search-health.mjs calls the one state where
      // the tier label would otherwise be actively false, fall back to
      // lexical, same as the qmd tier's own established philosophy (an
      // optional accelerator that fails at runtime falls through).
      base = { tier: 'lexical', results, note: `semantic channel failed (${err.message}) -- run \`node scripts/search.mjs --health\`` };
    }
  } else if (ollamaUp && !hasIndex) {
    // The one case where the caller's next action differs from "Ollama is
    // down": there is a fix (`node scripts/index-embed.mjs`), not a wait.
    base = { tier: 'lexical', results, note: 'semantic index missing or empty -- run `node scripts/index-embed.mjs` to build it' };
  } else {
    base = { tier: 'lexical', results };
  }

  if (rawKeywordSearch) {
    const rawHits = await rawKeywordSearch(query);
    const already = new Set(base.results.map((r) => r.path));
    const additions = rawHits.filter((p) => !already.has(p)).map((path) => ({ path, zone: 'raw' }));
    base = { ...base, results: [...base.results, ...additions], rawCount: additions.length };
  }

  return base;
}

// The `obsidian` CLI's `search` command prints the plain-text sentence "No
// matches found." even when `format=json` is requested -- confirmed live
// during implementation, where it broke `obsidianJson`'s JSON.parse with a
// SyntaxError. A zero-hit search is not a failure; it just means the keyword
// channel contributes nothing to this query, so it is treated the same as an
// empty result list rather than allowed to crash the whole tiering ladder.
//
// `path` defaults to 'wiki' -- unchanged behavior for every existing caller.
// Obsidian's own full-text index already covers raw/ just fine (confirmed
// live: `obsidian search query=... path=raw` returns real hits); the only
// reason wiki-master itself never surfaced them was this one hardcoded
// scope. Passing `path: 'raw'` is what the wiki-search skill's --include-raw
// flag uses to close that gap without touching the wiki/-only default.
export function keywordSearch(query, { limit = 10, obsidianJsonImpl = obsidianJson, path = 'wiki' } = {}) {
  try {
    return obsidianJsonImpl(['search', `query=${query}`, `path=${path}`, `limit=${limit}`]) ?? [];
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
export async function createSearchContext({ vaultPath = resolveVault().path,
  keywordSearchFn, embedFn = queryEmbed, checkAvailable = () => isAvailable({ fetchImpl: boundedFetch }) } = {}) {
  const indexDir = join(vaultPath, '.wiki-master');
  const index = loadChunkIndex(indexDir);
  const ollamaUp = await checkAvailable();
  const semanticRun = async (q, limit, options = {}) => semanticSearch(q, {
    vectors: index.vectors,
    manifest: Object.fromEntries(Object.entries(index.manifest).filter(([path, entry]) =>
      inScope(path) && (!entry.metadata || matchesFilters(entry.metadata, options)))),
    embedFn,
    topN: limit,
  });
  const name = vaultPath === resolveVault().path ? resolveVault().name : basename(vaultPath);
  const names = buildNameIndex(Object.entries(index.manifest).map(([path, entry]) => ({
    path, name: basename(path, '.md').toLowerCase(), metadata: entry.metadata ?? {}, aliases: entry.aliases ?? [] })));
  return { vaultPath, indexDir, index, ollamaUp, semanticRun, names,
    keywordSearchFn: keywordSearchFn ?? ((q, options) => boundedKeywordSearch(q, { ...options, name })) };
}

// Search has a bounded wait without changing the shared wrapper used by long
// mutation commands. A failed channel is distinct from zero hits.
export async function boundedKeywordSearch(query, { limit = 100, path = 'wiki', name = resolveVault().name, execFileImpl = execFile } = {}) {
  const args = buildArgs(name, ['search', `query=${query}`, `path=${path}`, `limit=${limit}`, 'format=json']);
  const out = await new Promise((resolve, reject) => execFileImpl('obsidian', args,
    { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    (err, stdout) => err ? reject(err) : resolve(stdout.trim())));
  if (!out || out === 'No matches found.') return [];
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed) || parsed.some(p => typeof p !== 'string')) throw new Error('Unexpected Obsidian search response');
  return parsed;
}

const boundedFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
const queryEmbed = text => ollamaEmbed(text, { fetchImpl: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(30000) }) });

function validateOptions(query, options) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query must not be empty');
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error('--limit must be an integer from 1 to 100');
  for (const key of ['project', 'type', 'status']) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || !options[key].trim())) throw new Error(`--${key} requires a value`);
  }
}

// Metadata ranking scans the compact manifest. Only a bounded pool of candidate
// files is read, once each, to verify current identities, filters and passages.
// A reusable context keeps vectors resident across evaluation questions.
export async function main(query, options = {}) {
  const { limit = 10, includeRaw = false } = options;
  validateOptions(query, { ...options, limit });
  const context = options.context ?? await createSearchContext({ vaultPath: options.vaultPath });
  const { vaultPath, index, ollamaUp, semanticRun, keywordSearchFn } = context;
  const poolLimit = Math.min(500, Math.max(100, limit * 5));
  const diagnostics = [];
  const catalog = Object.entries(index.manifest).filter(([path]) => inScope(path));
  const metadataComplete = catalog.length > 0 && catalog.every(([, e]) => e.metadataVersion === METADATA_VERSION);
  if (!metadataComplete) diagnostics.push({ code: 'metadata-incomplete', message: 'Refresh index-embed to enable complete title and alias lookup.' });
  const named = catalog.map(([path, entry]) => ({ path, score: lexicalScore(query, path, entry),
    scopeMatch: matchesFilters(entry.metadata ?? {}, options) }))
    .filter(x => x.score > 0).sort((a, b) => Number(b.scopeMatch) - Number(a.scopeMatch) || b.score - a.score || a.path.localeCompare(b.path));
  const keywordPaths = new Set();
  const queries = [...new Set([query, terms(query).slice(0, 8).join(' OR ')])].filter(Boolean);
  const keywordRequests = ['wiki', 'moc'].flatMap(scope => queries.map(q => ({ q, scope })));
  if (includeRaw) keywordRequests.push({ q: query, scope: 'raw' });
  const keywordRuns = await Promise.allSettled(keywordRequests.map(({ q, scope }) => keywordSearchFn(q, { limit: poolLimit, path: scope })));
  const rawPaths = [];
  keywordRuns.forEach((run, i) => {
    if (run.status === 'rejected') diagnostics.push({ code: 'keyword-failed', scope: keywordRequests[i].scope, message: String(run.reason?.message ?? run.reason).slice(0, 300) });
    else for (const path of run.value) {
      if (keywordRequests[i].scope === 'raw' && inScope(path, true) && path.startsWith('raw/')) rawPaths.push(path);
      else if (inScope(path)) keywordPaths.add(path);
    }
  });
  const keywordAvailable = keywordRuns.some((run, i) => keywordRequests[i].scope !== 'raw' && run.status === 'fulfilled');
  let tier = keywordAvailable ? 'lexical' : 'identity-only';
  let semanticHits = [];
  if (ollamaUp && index.available) {
    try { semanticHits = await semanticRun(query, poolLimit, options); tier = keywordAvailable ? 'hybrid' : 'semantic+identity'; }
    catch (err) { diagnostics.push({ code: 'semantic-failed', message: err.message }); }
  } else diagnostics.push({ code: index.available ? 'ollama-unavailable' : 'index-unavailable', message: 'Semantic retrieval unavailable; lexical retrieval used.' });
  const semanticByPath = new Map(semanticHits.filter(h => inScope(h.path)).map(h => [h.path, h]));
  const prelim = mergeRRF([named.map(x => x.path), [...keywordPaths], [...semanticByPath.keys()]]);
  const exactNames = named.filter(x => x.score === 1000).map(x => x.path);
  const candidates = [...new Set([...exactNames, ...prelim.map(x => x.path)])];
  const rawCandidates = [...new Set(rawPaths)].slice(0, poolLimit);
  const indexStatus = { available: index.available, metadataComplete, freshness: 'candidate-validated', checked: 0, modified: 0, removed: 0 };
  if (candidates.length > poolLimit) diagnostics.push({ code: 'candidate-limit', message: `Validated first ${poolLimit} of ${candidates.length} candidates.` });
  const live = new Map();
  for (const path of [...candidates.slice(0, poolLimit), ...rawCandidates]) {
    indexStatus.checked++;
    let text, stat;
    try { stat = statSync(join(vaultPath, path)); text = readFileSync(join(vaultPath, path), 'utf8'); }
    catch (err) {
      if (err.code === 'ENOENT') indexStatus.removed++;
      else diagnostics.push({ code: 'candidate-unreadable', path, message: err.message });
      continue;
    }
    const entry = index.manifest[path];
    const modified = entry && (entry.contentHash ? entry.contentHash !== hash(text) : entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size);
    if (modified) indexStatus.modified++;
    const current = noteIdentity(text, path);
    if (!matchesFilters(current.metadata, options)) continue;
    const lexical = lexicalScore(query, path, current, text);
    // A stale semantic vector alone is no longer evidence of relevance.
    const semantic = !modified ? semanticByPath.get(path) : undefined;
    if (!lexical && !semantic && !keywordPaths.has(path) && !rawPaths.includes(path)) continue;
    const exact = exactIdentity(query, path, current);
    live.set(path, { path, title: current.title.slice(0, 256), metadata: boundedMetadata(current.metadata),
      ...citationProvenance(text, context.names),
      indexFreshness: !entry ? 'unindexed' : modified ? 'modified' : entry.contentHash ? 'current' : 'unverified',
      match: exact ? 'exact' : lexical || keywordPaths.has(path) || rawPaths.includes(path) ? 'lexical' : 'semantic',
      ...passageFor(text, query, semantic?.startLine), lexical, semantic,
      ...(path.startsWith('raw/') ? { zone: 'raw' } : {}) });
  }
  const lexRank = [...live.values()].filter(h => h.lexical > 0 && !h.zone)
    .sort((a,b) => b.lexical - a.lexical || a.path.localeCompare(b.path)).map(h => h.path);
  const semRank = [...semanticByPath.keys()].filter(p => live.get(p)?.semantic);
  const scores = new Map(mergeRRF([lexRank, semRank]).map(h => [h.path, h.score]));
  const ranked = [...live.values()].sort((a,b) => Number(!!a.zone) - Number(!!b.zone) ||
    Number(b.match === 'exact') - Number(a.match === 'exact') || (scores.get(b.path) ?? 0) - (scores.get(a.path) ?? 0) || a.path.localeCompare(b.path));
  const exact = ranked.filter(h => h.match === 'exact');
  if (exact.length > 1) diagnostics.push({ code: 'ambiguous-identity', paths: exact.map(h => h.path), message: 'Multiple pages match this identity; use a full path to disambiguate.' });
  if (indexStatus.modified || indexStatus.removed) diagnostics.push({ code: 'stale-candidates', message: `${indexStatus.modified} modified and ${indexStatus.removed} removed candidates; refresh index-embed.` });
  const rawRanked = ranked.filter(h => h.zone === 'raw');
  const selected = [...ranked.filter(h => !h.zone).slice(0, limit), ...rawRanked.slice(0, limit)];
  const results = selected.map(({ lexical, semantic, ...hit }) => ({ ...hit, score: scores.get(hit.path) ?? 0 }));
  return { tier, results, index: indexStatus, diagnostics,
    ...(includeRaw ? { rawCount: rawRanked.length, rawReturned: results.filter(h => h.zone === 'raw').length } : {}) };
}

// Pure formatting: given a search() result and an assessTiers() verdict,
// decides what a caller sees on each stream. stdout carries ONLY the answer
// (paths, optionally :line) so piping stays clean (`search.mjs "q" | ...`);
// every diagnostic -- the tier line, the full block, search()'s own note,
// the raw/ hit count when --include-raw was used -- goes to stderr. This is
// the never-silent guarantee itself: a degraded search always emits at
// least the one-liner naming what is off, whether or not the caller is
// watching stderr -- and raw/ coverage gets the same treatment: `rawCount`
// undefined means raw/ was never checked (no line added, existing callers'
// output is unchanged); `rawCount: 0` is disclosed explicitly rather than
// looking identical to "never checked" would.
export function renderResult({ results, note, rawCount, tier, diagnostics = [] }, assessed, { chunks, announceFull = false } = {}) {
  const queryAssessment = { ...assessed, tier: tier ?? assessed.tier,
    gaps: [...assessed.gaps, ...(diagnostics.some(d => d.code === 'keyword-failed') ? [{
      channel: 'keyword', state: 'request failed', buys: 'Full-text keyword coverage is incomplete.',
      fix: 'Check Obsidian CLI availability and retry the query.',
    }] : [])] };
  const stderr = announceFull
    ? fullReport(queryAssessment, { chunks }).split('\n')
    : [statusLine(queryAssessment, { chunks })];
  if (note) stderr.push(note);
  if (rawCount !== undefined) stderr.push(`(raw/ clippings checked via --include-raw: ${rawCount} hit${rawCount === 1 ? '' : 's'})`);

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
  const modelOk = ollamaUp ? await modelPresent({ fetchImpl: boundedFetch }) : false;
  return assessTiers({
    ollama: { reachable: ollamaUp, modelPresent: modelOk, model: EMBED_MODEL },
    index: { available: index.available, coverage: cov, filesChanged },
  });
}

async function runQuery(query, options = {}) {
  const context = await createSearchContext();
  const { vaultPath, indexDir, index, ollamaUp } = context;
  const result = await main(query, { ...options, context });
  if (options.json) { console.log(JSON.stringify(result)); return; }

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
  for (const d of result.diagnostics) console.error(`${d.code}: ${d.message}`);
  for (const line of stdout) console.log(line);

  if (announceFull) writeNoticeIso(indexDir, new Date().toISOString());
}

async function runHealthCommand() {
  const { path: vaultPath } = resolveVault();
  const indexDir = join(vaultPath, '.wiki-master');
  const index = loadChunkIndex(indexDir);
  const ollamaUp = await isAvailable({ fetchImpl: boundedFetch });
  const cov = coverage(index.manifest, Object.keys(index.vectors));

  let files = Object.keys(index.manifest).length;
  let filesChanged = 0;
  let filesRemoved = 0;
  try {
    const r = statusReport({ vaultPath, dir: indexDir });
    files = r.files; filesChanged = r.filesChanged; filesRemoved = r.filesRemoved;
  } catch { /* vault unreadable -- report what the index itself knows */ }

  const assessed = await buildAssessment({ vaultPath, indexDir, index, ollamaUp, cov, filesChanged });
  const modelOk = ollamaUp ? await modelPresent({ fetchImpl: boundedFetch }) : false;

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
  const ollamaUp = await isAvailable({ fetchImpl: boundedFetch });
  const cov = coverage(index.manifest, Object.keys(index.vectors));

  let filesChanged = 0;
  try { filesChanged = statusReport({ vaultPath, dir: indexDir }).filesChanged; } catch { /* best effort */ }

  const assessed = await buildAssessment({ vaultPath, indexDir, index, ollamaUp, cov, filesChanged });
  console.log(setupPlan(assessed));
}

export function parseArgs(argv) {
  const options = { json: false, limit: 10, includeRaw: false };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--include-raw') options.includeRaw = true;
    else if (arg.startsWith('--')) {
      const [name, ...rest] = arg.slice(2).split('=');
      if (!['limit', 'project', 'type', 'status'].includes(name)) throw new Error(`unknown option: --${name}`);
      const value = rest.length ? rest.join('=') : argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
      options[name] = name === 'limit' ? Number(value) : value;
    } else words.push(arg);
  }
  const query = words.join(' ');
  validateOptions(query, options);
  return { query, ...options };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--health')) {
    await runHealthCommand();
  } else if (argv.includes('--setup')) {
    await runSetupCommand();
  } else {
    try {
      const { query, ...options } = parseArgs(argv);
      await runQuery(query, options);
    } catch (err) {
      console.error(`search: ${err.message}`);
      console.error('usage: node scripts/search.mjs "<question>" [--json] [--limit N] [--project P] [--type T] [--status S] [--include-raw] | --health | --setup');
      process.exitCode = 1;
    }
  }
}
