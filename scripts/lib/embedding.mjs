// Builds and incrementally refreshes the chunk-level semantic index over
// wiki/ and moc/. The manifest also stores note identities and metadata for
// bounded agent retrieval; vector content hashes still allow cheap reuse.
// Artifacts under .wiki-master/: chunks.json, vectors.bin, vectors.idx.json.
//
// A refresh re-chunks only the files that changed. A rebuild re-chunks everything,
// but vectors for unchanged chunk CONTENT are still reused: only the mtime/size
// shortcut is discarded, not the cache.
//
// Walks the filesystem directly (mirrors lib/graph.mjs's buildGraph walk),
// NOT via the `obsidian` CLI: building the index must not require Obsidian
// to be running. raw/ is deliberately excluded (spec section 6: clippings
// would roughly triple the index; opt-in later) -- enforced by only
// descending only into wiki/ and moc/, so raw/ is never even read.

import {
  readFileSync, readdirSync, statSync, existsSync, writeFileSync, renameSync, mkdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { isContent } from './graph.mjs';
import { chunkMarkdown } from './chunk.mjs';
import { hash } from './embed-cache.mjs';
import { isAvailable, modelPresent, EMBED_MODEL } from './embed.mjs';
import { encodeVectors, decodeVectors, planRefresh, neededHashes, coverage } from './vector-index.mjs';
import { noteIdentity, METADATA_VERSION, inScope } from './retrieval.mjs';

const CHUNKS_FILE = 'chunks.json';
const VECTORS_BIN = 'vectors.bin';
const VECTORS_IDX = 'vectors.idx.json';

// Descend only into wiki/ and moc/. Skip dot directories at every level;
// raw/, log/, templates and system pages never enter the retrieval index.
export function walkVault(vaultPath) {
  const files = [];
  (function walk(dir, rel) {
    for (const e of readdirSync(dir)) {
      if (e.startsWith('.')) continue;
      if (!rel && !['wiki', 'moc'].includes(e)) continue;
      const abs = join(dir, e);
      const r = rel ? `${rel}/${e}` : e;
      const st = statSync(abs);
      if (st.isDirectory()) { walk(abs, r); continue; }
      if (inScope(r) && isContent(r)) {
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
// interrupted run never leaves a half-written index.
//
// Writes all three or none, and returns whether it wrote: when every output is byte-identical to what is on disk the
// run had nothing to save, and a rewrite would only show up as a change to whatever watches the vault's files. An
// edit moves a manifest key to the end, so keys are sorted first or the next idle run would differ by order alone.
export function persistIndex(dir, manifest, vectors, { writeFileImpl = writeFileSync, renameImpl = renameSync } = {}) {
  const { buffer, idx } = encodeVectors(vectors);
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((path) => [path, manifest[path]]));
  const outputs = [
    [CHUNKS_FILE, Buffer.from(JSON.stringify(sorted))],
    [VECTORS_BIN, buffer],
    [VECTORS_IDX, Buffer.from(JSON.stringify(idx))],
  ];
  const same = ([name, bytes]) => {
    try { return readFileSync(join(dir, name)).equals(bytes); } catch { return false; }
  };
  if (outputs.every(same)) return false;

  mkdirSync(dir, { recursive: true });
  const tmp = (name) => join(dir, `${name}.tmp-${process.pid}`);
  for (const [name, bytes] of outputs) writeFileImpl(tmp(name), bytes);
  for (const [name] of outputs) renameImpl(tmp(name), join(dir, name));
  return true;
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
function metadataRefreshManifest(manifest) {
  return Object.fromEntries(Object.entries(manifest).map(([path, entry]) => [path,
    entry.metadataVersion === METADATA_VERSION ? entry : { ...entry, mtimeMs: NaN }]));
}

export function statusReport({ vaultPath, dir }) {
  const manifest = readManifestFile(dir);
  const vectors = readVectorStore(dir);
  const files = walkVault(vaultPath);
  const plan = planRefresh(metadataRefreshManifest(manifest), files);
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
  model = EMBED_MODEL,
  writeFileImpl = writeFileSync,
  renameImpl = renameSync,
} = {}) {
  if (!(await checkAvailable())) {
    throw new Error('Ollama is unreachable at ' + (process.env.OLLAMA_HOST || 'http://localhost:11434') + ' -- start it before building the index.');
  }
  if (!(await checkModel())) {
    throw new Error(`the embedding model is not pulled -- run \`ollama pull ${model}\` before building the index.`);
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
  const baseManifest = rebuild ? {} : metadataRefreshManifest(loadedManifest);

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
    finalManifest[f.path] = { mtimeMs: f.mtimeMs, size: f.size, contentHash: hash(text),
      ...noteIdentity(text, f.path), chunks: chunkMetas };
    filesRead++;
    onProgress({ phase: 'chunk', file: f.path, filesRead, filesTotal: plan.changed.length });
  }

  // Recover the text for any chunk the manifest already lists but the vector
  // store lacks. Without this, "unchanged" is a trap: planRefresh keeps a file
  // out of plan.changed on mtime/size, so its text is never re-chunked, so a
  // chunk that failed to embed on an earlier run is never offered to the pool
  // again -- the gap would only close on --rebuild or an unrelated edit.
  //
  // Derived from state, not remembered: this asks "which live chunks have no
  // vector?" rather than replaying a list of past failures, so it also repairs
  // vectors lost to an interrupted run or a hand-deleted store. Normally it
  // reads nothing, because normally nothing is missing.
  const missingByFile = new Map();
  for (const [path, entry] of Object.entries(finalManifest)) {
    for (const c of entry.chunks) {
      if (vectors[c.hash] || hashToText.has(c.hash)) continue;
      if (!missingByFile.has(path)) missingByFile.set(path, []);
      missingByFile.get(path).push(c.hash);
    }
  }
  let filesRepaired = 0;
  for (const path of missingByFile.keys()) {
    const f = files.find((x) => x.path === path);
    if (!f) continue; // file vanished since the manifest was written; prune handles it
    const chunks = chunkMarkdown(readFileSync(f.abs, 'utf8'), { title: basename(f.path, '.md') });
    for (const c of chunks) {
      const h = hash(c.text);
      if (!hashToText.has(h)) hashToText.set(h, c.text);
    }
    filesRepaired++;
  }
  if (filesRepaired) onProgress({ phase: 'repair', files: filesRepaired });

  const needed = neededHashes([...hashToText.keys()], Object.keys(vectors));
  onProgress({ phase: 'embed-start', needed: needed.length });

  // Embed with per-chunk fault tolerance. Previously a single rejection
  // propagated out of the pool and out of refreshIndex before persistIndex was
  // reached, so one unembeddable chunk discarded every successful embed in the
  // run and the vault silently stayed on a stale index (#70).
  //
  // A failed chunk is recorded and skipped, not fatal: the manifest still lists
  // it, no vector is written, and search already skips chunks with no vector.
  // The repair pass above re-offers it on the next run, so the failure heals
  // itself once the cause is fixed. This matches the posture the rest of
  // wiki-master takes -- degrade and SAY SO, rather than die (search.mjs falls
  // back to lexical and reports the fact).
  let embedded = 0;
  const failures = [];
  await runPool(needed, concurrency, async (h) => {
    try {
      const vec = await embedFn(hashToText.get(h));
      vectors[h] = vec;
      embedded++;
    } catch (err) {
      const text = hashToText.get(h) ?? '';
      failures.push({ hash: h, chars: text.length, error: String(err && err.message || err) });
      return;
    }
    onProgress({ phase: 'embed', embedded, total: needed.length });
  });

  // Tolerating SOME failures must not become silently accepting a dead backend.
  // If a run of any real size embedded nothing at all, that is infrastructure
  // rather than one awkward page, and persisting a vectorless index would be its
  // own silent failure. The size floor matters: on a small incremental run the
  // single needed chunk may simply be the oversized one, and refusing to persist
  // there would also throw away the manifest's legitimate changes (removals,
  // re-chunked files) for no gain -- that case is reported and retried instead.
  // Preflight already proved Ollama was reachable and the model pulled, so a
  // backend that dies mid-run fails every chunk and is caught here regardless.
  if (needed.length >= 3 && embedded === 0) {
    throw new Error(
      `every chunk failed to embed (${failures.length}/${needed.length}) -- first error: ${failures[0].error}`
    );
  }
  if (failures.length) onProgress({ phase: 'embed-failed', failures });

  // Prune: drop any stored vector whose hash no longer appears in ANY
  // manifest entry's chunk list -- deleted files and edited chunks alike --
  // so the store cannot grow without bound the way embeddings.json has.
  const liveHashes = new Set();
  for (const entry of Object.values(finalManifest)) for (const c of entry.chunks) liveHashes.add(c.hash);
  let pruned = 0;
  for (const h of Object.keys(vectors)) {
    if (!liveHashes.has(h)) { delete vectors[h]; pruned++; }
  }

  const persisted = persistIndex(dir, finalManifest, vectors, { writeFileImpl, renameImpl });

  return {
    persisted,
    filesChanged: plan.changed.length,
    filesUnchanged: plan.unchanged.length,
    filesRemoved: plan.removed.length,
    chunksEmbedded: embedded,
    chunksFailed: failures.length,
    failures,
    chunksPruned: pruned,
    chunksTotal: liveHashes.size,
    elapsedMs: Date.now() - startedAt,
  };
}

// What a command prints while a refresh runs. `write` takes one line.
export function progressPrinter(write) {
  let lastPrint = 0;
  return (e) => {
    if (e.phase === 'chunk' && (e.filesRead % 50 === 0 || e.filesRead === e.filesTotal)) {
      write(`  chunking: ${e.filesRead}/${e.filesTotal} changed file(s)`);
    } else if (e.phase === 'embed-start') {
      if (e.needed > 0) write(`  embedding ${e.needed} chunk(s) -- this can take minutes on a cold build`);
    } else if (e.phase === 'embed') {
      const now = Date.now();
      if (now - lastPrint > 2000 || e.embedded === e.total) {
        write(`    embedded ${e.embedded}/${e.total}`);
        lastPrint = now;
      }
    }
  };
}
