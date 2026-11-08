import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { embed as ollamaEmbed, isAvailable, cosine } from './lib/embed.mjs';
import { hash, loadCache, saveCache } from './lib/embed-cache.mjs';
import { buildGraph, buildNameIndex, evidencePaths } from './lib/graph.mjs';
import { parseNote } from './lib/note.mjs';
import { chunkMarkdown } from './lib/chunk.mjs';
import { checkLedgerPaths, readLedger } from './lib/ledger.mjs';
import { readDriftState, writeDriftState } from './lib/drift-state.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

const DEFAULT_THRESHOLD = 0.5;
const MAX_CHARS = 1200;
const MAX_CHUNKS = 8;
const MAX_SOURCES = 8;

function normalizeVector(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some(n => !Number.isFinite(n))) throw new Error('invalid embedding vector');
  const norm = Math.hypot(...vector);
  if (!norm) throw new Error('zero embedding vector');
  return vector.map(n => n / norm);
}

function sample(items, limit) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * (items.length - 1) / (limit - 1))]);
}

function documentChunks(text) {
  if (text.length <= MAX_CHARS) return [text];
  // Reuse structural splitting; bound unusually long headings/prefixes too.
  // Nothing is discarded here: sampling is separate and reported explicitly.
  return chunkMarkdown(text, { title: '', targetChars: 600, overlapChars: 75 }).flatMap(chunk => {
    const pieces = [];
    for (let i = 0; i < chunk.text.length; i += MAX_CHARS) pieces.push(chunk.text.slice(i, i + MAX_CHARS));
    return pieces;
  });
}

async function documentVector(text, embedFn) {
  const chunks = documentChunks(text);
  const chosen = sample(chunks, MAX_CHUNKS);
  const vectors = [];
  for (const chunk of chosen) vectors.push(normalizeVector(await embedFn(chunk)));
  if (vectors.some(v => v.length !== vectors[0].length)) throw new Error('embedding dimensions differ');
  return { vector: normalizeVector(centroid(vectors)), coverage: { total: chunks.length, sampled: chosen.length } };
}

function centroid(vecs) {
  const n = vecs.length;
  const out = new Array(vecs[0].length).fill(0);
  for (const v of vecs) for (let i = 0; i < v.length; i++) out[i] += v[i] / n;
  return out;
}

export const SELECTION_RULE = 'never-evaluated, changed, oldest';
const REASON_RANK = { 'never-evaluated': 0, changed: 1, oldest: 2 };
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The order in which eligible pages are evaluated: pages this machine never evaluated, then pages whose text
// changed since their evaluation, then the rest by the time of their evaluation, oldest first; ties by path.
// `state` maps a path to { evaluatedAt, pageHash } (lib/drift-state.mjs). Only the page's own text is compared:
// hashing its evidence would mean reading every evidence document before choosing.
export function selectDriftPages(pages, state = {}, limit) {
  return pages.map(page => {
    const entry = state[page.path];
    const reason = !entry ? 'never-evaluated' : entry.pageHash !== page.pageHash ? 'changed' : 'oldest';
    return { page, reason, at: reason === 'oldest' ? String(entry.evaluatedAt ?? '') : '' };
  }).sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || compare(a.at, b.at) || compare(a.page.path, b.page.path))
    .slice(0, limit ?? Infinity);
}

// `pages` are either complete ({ path, body, sources: [{ path, content }] }) or the light descriptors of
// collectDriftPages ({ path, pageHash, sources: [{ path }], load }), whose body and evidence are read by `load()`
// only when the page is picked. `named`, the paths of a --paths-file ledger, restricts the pool to those pages; a
// name that is not an eligible page is skipped as not-eligible.
export async function computeDrift(pages, { embedFn, threshold = DEFAULT_THRESHOLD, limit, coverage = false, unavailable = false, state = {}, named = null } = {}) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('limit must be a positive integer');
  const drifted = [], evaluated = [], failed = [], skippedPages = [];
  let pool = pages;
  if (named) {
    const byPath = new Map(pages.map(page => [page.path, page]));
    pool = [];
    for (const path of named) {
      const page = byPath.get(path);
      if (page?.sources?.length) pool.push(page);
      else skippedPages.push({ path, reason: 'not-eligible' });
    }
  }
  const eligiblePages = pool.filter(page => page.sources?.length);
  const eligible = eligiblePages.length;
  const total = pool.length + (named ? skippedPages.length : 0);
  const picked = selectDriftPages(eligiblePages, state, limit);
  const pickedPaths = new Set(picked.map(p => p.page.path));
  const evaluatedBefore = eligiblePages.filter(page => state[page.path]).length;
  for (const page of pool) {
    const reason = !page.sources?.length ? 'no reachable readable evidence'
      : coverage ? 'coverage only' : unavailable ? 'embedder unavailable'
      : !pickedPaths.has(page.path) ? 'limit' : null;
    if (reason) { skippedPages.push({ path: page.path, reason }); continue; }
    // One un-embeddable page (or raw source -- typically the longest content
    // in the vault, so likeliest to exceed the embedding model's context
    // window) must not take the whole drift run down. Recorded, never silent.
    try {
      const loaded = page.load ? page.load() : page;
      const pageResult = await documentVector(loaded.body, embedFn);
      const srcVecs = [];
      const documents = [];
      const chosenSources = sample(loaded.sources, MAX_SOURCES);
      for (const s of chosenSources) {
        const result = await documentVector(s.content, embedFn);
        srcVecs.push(result.vector);
        documents.push({ path: s.path, ...result.coverage });
      }
      if (srcVecs.some(v => v.length !== pageResult.vector.length)) throw new Error('embedding dimensions differ');
      const sim = cosine(pageResult.vector, normalizeVector(centroid(srcVecs)));
      const sampling = { page: pageResult.coverage, sources: { total: page.sources.length, sampled: chosenSources.length, documents },
        partial: pageResult.coverage.sampled < pageResult.coverage.total || chosenSources.length < page.sources.length || documents.some(d => d.sampled < d.total) };
      evaluated.push({ path: page.path, sim, sampling });
      if (sim < threshold) drifted.push({ path: page.path, sim });
    } catch (err) {
      failed.push({ path: page.path, error: err.message });
    }
  }
  const evaluatedPaths = new Set(evaluated.map(e => e.path));
  return { drifted, evaluated, failed, skipped: coverage || unavailable, coverage, skippedPages,
    counts: { total, eligible, ineligible: total - eligible,
      evaluated: evaluated.length, failed: failed.length, skipped: skippedPages.length,
      skippedEligible: eligible - evaluated.length - failed.length },
    // `picked` is the pages this run evaluates (or, for --coverage or an unavailable embedder, would evaluate).
    selection: { rule: SELECTION_RULE, evaluatedBefore, eligible, picked: picked.map(p => ({ path: p.page.path, reason: p.reason })) },
    // Eligible pages evaluated on this machine at some time, this run included.
    everEvaluated: eligiblePages.filter(page => state[page.path] || evaluatedPaths.has(page.path)).length };
}

// Light descriptors: the page text is read here (its hash decides "changed"), but no evidence document is read
// until `load()` is called for a picked page. `readFile` is injectable to count reads.
export function collectDriftPages(vaultPath, { readFile = readFileSync } = {}) {
  const { pages } = buildGraph(vaultPath);
  const byName = buildNameIndex(pages);
  const byPath = new Map(pages.map(page => [page.path, page]));
  return pages.filter(page => /^wiki\/(concepts|syntheses)\/.+\.md$/.test(page.path)).map(page => {
    const evidence = evidencePaths(page, byName, byPath).filter(path => path.endsWith('.md'));
    const raw = evidence.filter(path => path.startsWith('raw/'));
    const sourcePaths = raw.length ? raw : evidence;
    const text = readFile(join(vaultPath, page.path), 'utf8');
    return {
      path: page.path, pageHash: hash(text), sources: sourcePaths.map(path => ({ path })),
      load: () => ({ body: parseNote(text).body, sources: sourcePaths.map(path => ({ path, content: parseNote(readFile(join(vaultPath, path), 'utf8')).body })) }),
    };
  });
}

export function formatDriftReport(result) {
  const c = result.counts;
  const lines = [`drift: total ${c.total} · eligible ${c.eligible} · ineligible ${c.ineligible} · evaluated ${c.evaluated} · failed ${c.failed} · skipped ${c.skipped} (${c.skippedEligible} eligible)`];
  if (result.selection) {
    lines.push(`drift: selection: never-evaluated first, then changed since last evaluation, then oldest evaluated (${result.selection.evaluatedBefore} of ${result.selection.eligible} eligible pages evaluated before on this machine)`);
    lines.push('drift: a page counts as changed when its own text changed; edits to its evidence alone are not tracked');
  }
  if (result.coverage) lines.push('drift: coverage only; no embeddings or factual verification performed');
  else if (!c.evaluated) lines.push('drift: no pages evaluated; no clean verdict is available');
  else if (!result.drifted.length) lines.push('drift: no evaluated pages diverged from their sources');
  for (const d of result.drifted) lines.push(`  drift ${d.sim.toFixed(2)}  ${d.path}`);
  for (const e of result.evaluated) {
    const s = e.sampling;
    lines.push(`  sampled ${s.page.sampled}/${s.page.total} page chunks; ${s.sources.sampled}/${s.sources.total} evidence documents, ${s.sources.documents.reduce((n, d) => n + d.sampled, 0)}/${s.sources.documents.reduce((n, d) => n + d.total, 0)} chunks in those documents${s.partial ? ' (partial coverage)' : ''}  ${e.path}`);
  }
  for (const f of result.failed) lines.push(`  drift: could not evaluate ${f.path} (${f.error})`);
  lines.push('Semantic similarity is a review signal, not factual verification or claim entailment.');
  return lines;
}

// Hash-keyed embedding cache (loadCache/saveCache/hash) now lives in
// lib/embed-cache.mjs, shared with search.mjs.

// The second argument injects the embedder, the availability probe, the clock, the state directory (default
// <vault>/.wiki-master), the output and the file read, for tests.
export async function main(argv = [], { embed = ollamaEmbed, available = isAvailable, now = () => new Date(), stateDir, print = console.log, readFile } = {}) {
  const options = {};
  let pathsFile;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--coverage') options.coverage = true;
    else if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--limit' || argv[i].startsWith('--limit=')) {
      const value = argv[i] === '--limit' ? argv[++i] : argv[i].slice('--limit='.length);
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || !Number.isSafeInteger(Number(value))) throw new Error('--limit must be a positive integer');
      options.limit = Number(value);
    } else if (argv[i] === '--paths-file' || argv[i].startsWith('--paths-file=')) {
      pathsFile = argv[i] === '--paths-file' ? argv[++i] : argv[i].slice('--paths-file='.length);
      if (!pathsFile) throw new Error('--paths-file needs a ledger file (a JSON array of vault-relative paths)');
    } else throw new Error(`unknown argument: ${argv[i]}`);
  }
  const named = pathsFile === undefined ? null : checkLedgerPaths(readLedger(pathsFile));
  const { path: vaultPath } = resolveVault();
  const pages = collectDriftPages(vaultPath, { readFile });
  const dir = stateDir ?? join(vaultPath, '.wiki-master');
  const state = readDriftState(dir, vaultPath);
  const report = (r) => {
    if (options.json) print(JSON.stringify(r));
    else for (const line of formatDriftReport(r)) print(line);
    return r;
  };
  const unavailable = !options.coverage && !(await available());
  if (options.coverage || unavailable) return report(await computeDrift(pages, { ...options, unavailable, state, named }));
  const cacheDir = join(vaultPath, '.wiki-master');
  const cache = loadCache(cacheDir);
  const cachedEmbed = async (text) => {
    const k = hash(text);
    if (cache[k]) return cache[k];
    const v = await embed(text);
    cache[k] = v;
    return v;
  };
  const r = await computeDrift(pages, { ...options, embedFn: cachedEmbed, state, named });
  saveCache(cacheDir, cache);
  // Record the pages evaluated now (not failed ones), and drop pages that are no longer eligible anywhere in the
  // vault. A --paths-file run keeps the entries of pages it did not name.
  const eligible = new Set(pages.filter(page => page.sources?.length).map(page => page.path));
  const next = Object.fromEntries(Object.entries(state).filter(([path]) => eligible.has(path)));
  const hashes = new Map(pages.map(page => [page.path, page.pageHash]));
  const evaluatedAt = now().toISOString();
  for (const e of r.evaluated) next[e.path] = { evaluatedAt, pageHash: hashes.get(e.path) };
  try { writeDriftState(dir, vaultPath, next); }
  catch (error) { console.error(`drift: could not record which pages were evaluated (${error.code ?? error.message}); the next run may pick them again`); }
  return report(r);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
