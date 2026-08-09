// Builds and incrementally refreshes the chunk-level semantic index over
// EVERY document in wiki/ -- unlike search.mjs's page-level embed, which
// truncates each page to its first 4,000 characters (17% of the live vault
// never embedded -- see docs/superpowers/specs/2026-08-09-chunk-semantic-
// index-design.md). Two persisted artifacts under .wiki-master/, shapes
// defined in lib/vector-index.mjs's file-format comment: chunks.json (the
// manifest) and vectors.bin + vectors.idx.json (the hash-keyed vector store).
//
//   node scripts/index-embed.mjs            # refresh: only changed files
//   node scripts/index-embed.mjs --rebuild  # re-chunk everything (vectors
//                                            #   for unchanged chunk CONTENT
//                                            #   are still reused -- only
//                                            #   the mtime/size shortcut is
//                                            #   discarded, not the cache)
//   node scripts/index-embed.mjs --status   # report coverage, embed nothing
//   node scripts/index-embed.mjs --concurrency=8
//
// Walks the filesystem directly (mirrors lib/graph.mjs's buildGraph walk),
// NOT via the `obsidian` CLI: building the index must not require Obsidian
// to be running. raw/ is deliberately excluded (spec section 6: clippings
// would roughly triple the index; opt-in later) -- enforced by only
// descending into paths that resolve to wiki/, so raw/ is never even read.

import {
  readFileSync, readdirSync, statSync, existsSync, writeFileSync, renameSync, mkdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isContent } from './lib/graph.mjs';
import { chunkMarkdown } from './lib/chunk.mjs';
import { hash } from './lib/embed-cache.mjs';
import { embed as ollamaEmbed, isAvailable, modelPresent } from './lib/embed.mjs';
import { encodeVectors, decodeVectors, planRefresh, neededHashes, coverage } from './lib/vector-index.mjs';

const CHUNKS_FILE = 'chunks.json';
const VECTORS_BIN = 'vectors.bin';
const VECTORS_IDX = 'vectors.idx.json';

// Walks the vault ROOT (like buildGraph), but only ever returns files whose
// vault-relative path starts with "wiki/" -- raw/, log/, moc/, index.md etc.
// at the vault root are never even descended into for raw/'s sake being
// large, but the wiki/ prefix check alone is what keeps them all out.
// Dot-prefixed entries (`.wiki-master/`, `.git/`, `wiki/.hidden/`) are
// skipped at every level, so nothing under them is ever walked or read.
export function walkVault(vaultPath) {
  const files = [];
  (function walk(dir, rel) {
    for (const e of readdirSync(dir)) {
      if (e.startsWith('.')) continue;
      const abs = join(dir, e);
      const r = rel ? `${rel}/${e}` : e;
      const st = statSync(abs);
      if (st.isDirectory()) { walk(abs, r); continue; }
      if (r.startsWith('wiki/') && isContent(r)) {
        files.push({ path: r, abs, mtimeMs: st.mtimeMs, size: st.size });
      }
    }
  })(vaultPath, '');
  return files;
}

export function readManifestFile(dir) {
  const f = join(dir, CHUNKS_FILE);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}

export function readVectorStore(dir) {
  const binF = join(dir, VECTORS_BIN);
  const idxF = join(dir, VECTORS_IDX);
  if (!existsSync(binF) || !existsSync(idxF)) return {};
  const idx = JSON.parse(readFileSync(idxF, 'utf8'));
  return decodeVectors(readFileSync(binF), idx);
}

// Atomic persist: every artifact is written to a temp file FIRST, and only
// renamed into place once all three temp writes succeed. If any write
// throws partway (disk full, injected failure), zero renames have happened,
// so whatever was on disk before this call remains fully intact -- an
// interrupted run never leaves a half-written index. Mirrors index-gen.mjs's
// write-tmp-then-rename pattern.
export function persistIndex(dir, manifest, vectors, { writeFileImpl = writeFileSync, renameImpl = renameSync } = {}) {
  mkdirSync(dir, { recursive: true });
  const { buffer, idx } = encodeVectors(vectors);
  const pid = process.pid;
  const manifestTmp = join(dir, `${CHUNKS_FILE}.tmp-${pid}`);
  const binTmp = join(dir, `${VECTORS_BIN}.tmp-${pid}`);
  const idxTmp = join(dir, `${VECTORS_IDX}.tmp-${pid}`);

  writeFileImpl(manifestTmp, JSON.stringify(manifest));
  writeFileImpl(binTmp, buffer);
  writeFileImpl(idxTmp, JSON.stringify(idx));

  renameImpl(manifestTmp, join(dir, CHUNKS_FILE));
  renameImpl(binTmp, join(dir, VECTORS_BIN));
  renameImpl(idxTmp, join(dir, VECTORS_IDX));
}

// A small fixed-size worker pool: `size` workers pull from `items` until
// exhausted, running concurrently. No dependency needed at this scale (a
// few thousand chunks) -- see the design spec's rejection of anything
// heavier for the same reason a vector database was rejected.
async function runPool(items, size, worker) {
  let i = 0;
  const n = Math.max(1, Math.min(size, items.length));
  async function lane() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: n }, lane));
}

// statusReport: coverage only, embeds nothing, writes nothing.
export function statusReport({ vaultPath, dir }) {
  const manifest = readManifestFile(dir);
  const vectors = readVectorStore(dir);
  const files = walkVault(vaultPath);
  const plan = planRefresh(manifest, files);
  const cov = coverage(manifest, Object.keys(vectors));
  return { ...cov, filesChanged: plan.changed.length, filesRemoved: plan.removed.length };
}

// refreshIndex: the core orchestration. Pre-flight (Ollama reachable AND the
// model actually pulled) runs BEFORE any file is read or chunked -- a
// reachable-but-modelless Ollama would otherwise 404 on every embed call
// after the manifest was already rewritten, half-building the index (see
// embed.mjs's own note on why isAvailable() alone is not enough).
export async function refreshIndex({
  vaultPath,
  dir,
  rebuild = false,
  embedFn,
  concurrency = 4,
  onProgress = () => {},
  checkAvailable = isAvailable,
  checkModel = modelPresent,
  writeFileImpl = writeFileSync,
  renameImpl = renameSync,
} = {}) {
  if (!(await checkAvailable())) {
    throw new Error('Ollama is unreachable at ' + (process.env.OLLAMA_HOST || 'http://localhost:11434') + ' -- start it before building the index.');
  }
  if (!(await checkModel())) {
    throw new Error('the embedding model is not pulled -- run `ollama pull nomic-embed-text` before building the index.');
  }

  const startedAt = Date.now();
  const loadedManifest = readManifestFile(dir);
  const vectors = readVectorStore(dir);
  // --rebuild discards the MANIFEST (forcing every file through the
  // "changed" path below, so every file is genuinely re-chunked) but never
  // discards the vector STORE: an unchanged chunk's content hashes
  // identically either way, so it still misses re-embedding via
  // neededHashes. Rebuild buys "distrust the mtime/size shortcut", not
  // "throw away work that content-hashing already proves is still valid".
  const baseManifest = rebuild ? {} : loadedManifest;

  const files = walkVault(vaultPath);
  const plan = planRefresh(baseManifest, files);

  const finalManifest = {};
  for (const f of plan.unchanged) finalManifest[f.path] = loadedManifest[f.path];

  const hashToText = new Map();
  let filesRead = 0;
  for (const f of plan.changed) {
    const text = readFileSync(f.abs, 'utf8');
    const title = basename(f.path, '.md');
    const chunks = chunkMarkdown(text, { title });
    const chunkMetas = chunks.map((c) => {
      const h = hash(c.text);
      if (!hashToText.has(h)) hashToText.set(h, c.text);
      return { hash: h, startLine: c.startLine, endLine: c.endLine };
    });
    finalManifest[f.path] = { mtimeMs: f.mtimeMs, size: f.size, chunks: chunkMetas };
    filesRead++;
    onProgress({ phase: 'chunk', file: f.path, filesRead, filesTotal: plan.changed.length });
  }

  const needed = neededHashes([...hashToText.keys()], Object.keys(vectors));
  onProgress({ phase: 'embed-start', needed: needed.length });

  let embedded = 0;
  await runPool(needed, concurrency, async (h) => {
    const vec = await embedFn(hashToText.get(h));
    vectors[h] = vec;
    embedded++;
    onProgress({ phase: 'embed', embedded, total: needed.length });
  });

  // Prune: drop any stored vector whose hash no longer appears in ANY
  // manifest entry's chunk list -- deleted files and edited chunks alike --
  // so the store cannot grow without bound the way embeddings.json has.
  const liveHashes = new Set();
  for (const entry of Object.values(finalManifest)) for (const c of entry.chunks) liveHashes.add(c.hash);
  let pruned = 0;
  for (const h of Object.keys(vectors)) {
    if (!liveHashes.has(h)) { delete vectors[h]; pruned++; }
  }

  persistIndex(dir, finalManifest, vectors, { writeFileImpl, renameImpl });

  return {
    filesChanged: plan.changed.length,
    filesUnchanged: plan.unchanged.length,
    filesRemoved: plan.removed.length,
    chunksEmbedded: embedded,
    chunksPruned: pruned,
    chunksTotal: liveHashes.size,
    elapsedMs: Date.now() - startedAt,
  };
}

function parseArgs(argv) {
  const rebuild = argv.includes('--rebuild');
  const status = argv.includes('--status');
  const concArg = argv.find((a) => a.startsWith('--concurrency='));
  const concurrency = concArg ? parseInt(concArg.split('=')[1], 10) : 4;
  return { rebuild, status, concurrency };
}

export async function main(argv = process.argv.slice(2)) {
  const { rebuild, status, concurrency } = parseArgs(argv);
  const { path: vaultPath } = resolveVault();
  const dir = join(vaultPath, '.wiki-master');

  if (status) {
    const r = statusReport({ vaultPath, dir });
    console.log(
      `index-embed --status: ${r.files} file(s), ${r.chunks} chunk(s) ` +
      `(${r.embedded} embedded, ${r.missing} missing) -- ` +
      `${r.filesChanged} file(s) changed, ${r.filesRemoved} removed since last refresh`
    );
    return r;
  }

  let lastPrint = 0;
  const onProgress = (e) => {
    if (e.phase === 'chunk' && (e.filesRead % 50 === 0 || e.filesRead === e.filesTotal)) {
      console.error(`  chunking: ${e.filesRead}/${e.filesTotal} changed file(s)`);
    } else if (e.phase === 'embed-start') {
      if (e.needed > 0) console.error(`  embedding ${e.needed} chunk(s) -- this can take minutes on a cold build`);
    } else if (e.phase === 'embed') {
      const now = Date.now();
      if (now - lastPrint > 2000 || e.embedded === e.total) {
        console.error(`    embedded ${e.embedded}/${e.total}`);
        lastPrint = now;
      }
    }
  };

  const embedFn = (text) => ollamaEmbed(text);

  try {
    const r = await refreshIndex({ vaultPath, dir, rebuild, embedFn, concurrency, onProgress });
    console.error(
      `index-embed: done in ${(r.elapsedMs / 1000).toFixed(1)}s -- ` +
      `${r.filesChanged} file(s) changed, ${r.chunksEmbedded} chunk(s) embedded, ` +
      `${r.chunksPruned} pruned, ${r.chunksTotal} total chunk(s) indexed`
    );
    return r;
  } catch (err) {
    console.error(`index-embed: ${err.message}`);
    process.exitCode = 1;
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
