import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { embed as ollamaEmbed, isAvailable, cosine } from './lib/embed.mjs';
import { hash, loadCache, saveCache } from './lib/embed-cache.mjs';
import { buildGraph, buildNameIndex, evidencePaths } from './lib/graph.mjs';
import { parseNote } from './lib/note.mjs';
import { chunkMarkdown } from './lib/chunk.mjs';

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

export async function computeDrift(pages, { embedFn, threshold = DEFAULT_THRESHOLD, limit, coverage = false, unavailable = false } = {}) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('limit must be a positive integer');
  const drifted = [], evaluated = [], failed = [], skippedPages = [];
  const eligible = pages.filter(page => page.sources?.length).length;
  let attempted = 0;
  for (const page of pages) {
    const reason = !page.sources?.length ? 'no reachable readable evidence'
      : coverage ? 'coverage only' : unavailable ? 'embedder unavailable'
      : attempted >= (limit ?? Infinity) ? 'limit' : null;
    if (reason) { skippedPages.push({ path: page.path, reason }); continue; }
    attempted++;
    // One un-embeddable page (or raw source -- typically the longest content
    // in the vault, so likeliest to exceed the embedding model's context
    // window) must not take the whole drift run down. Recorded, never silent.
    try {
      const pageResult = await documentVector(page.body, embedFn);
      const srcVecs = [];
      const documents = [];
      const chosenSources = sample(page.sources, MAX_SOURCES);
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
  return { drifted, evaluated, failed, skipped: coverage || unavailable, coverage, skippedPages,
    counts: { total: pages.length, eligible, ineligible: pages.length - eligible,
      evaluated: evaluated.length, failed: failed.length, skipped: skippedPages.length,
      skippedEligible: eligible - evaluated.length - failed.length } };
}

export function collectDriftPages(vaultPath) {
  const { pages } = buildGraph(vaultPath);
  const byName = buildNameIndex(pages);
  const byPath = new Map(pages.map(page => [page.path, page]));
  return pages.filter(page => /^wiki\/(concepts|syntheses)\/.+\.md$/.test(page.path)).map(page => {
    const evidence = evidencePaths(page, byName, byPath).filter(path => path.endsWith('.md'));
    const raw = evidence.filter(path => path.startsWith('raw/'));
    const sources = (raw.length ? raw : evidence).map(path => ({ path, content: parseNote(readFileSync(join(vaultPath, path), 'utf8')).body }));
    return { path: page.path, body: parseNote(readFileSync(join(vaultPath, page.path), 'utf8')).body, sources };
  });
}

export function formatDriftReport(result) {
  const c = result.counts;
  const lines = [`drift: total ${c.total} · eligible ${c.eligible} · ineligible ${c.ineligible} · evaluated ${c.evaluated} · failed ${c.failed} · skipped ${c.skipped} (${c.skippedEligible} eligible)`];
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

export async function main(argv = []) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--coverage') options.coverage = true;
    else if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--limit' || argv[i].startsWith('--limit=')) {
      const value = argv[i] === '--limit' ? argv[++i] : argv[i].slice('--limit='.length);
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || !Number.isSafeInteger(Number(value))) throw new Error('--limit must be a positive integer');
      options.limit = Number(value);
    } else throw new Error(`unknown argument: ${argv[i]}`);
  }
  const { path: vaultPath } = resolveVault();
  const pages = collectDriftPages(vaultPath);
  const unavailable = !options.coverage && !(await isAvailable());
  if (options.coverage || unavailable) {
    const r = await computeDrift(pages, { ...options, unavailable });
    if (options.json) console.log(JSON.stringify(r));
    else for (const line of formatDriftReport(r)) console.log(line);
    return r;
  }
  const cacheDir = join(vaultPath, '.wiki-master');
  const cache = loadCache(cacheDir);
  const cachedEmbed = async (text) => {
    const k = hash(text);
    if (cache[k]) return cache[k];
    const v = await ollamaEmbed(text);
    cache[k] = v;
    return v;
  };
  const r = await computeDrift(pages, { ...options, embedFn: cachedEmbed });
  saveCache(cacheDir, cache);
  if (options.json) console.log(JSON.stringify(r));
  else for (const line of formatDriftReport(r)) console.log(line);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
