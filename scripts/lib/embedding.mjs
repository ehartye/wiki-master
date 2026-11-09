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
  readFileSync, existsSync, writeFileSync, renameSync, mkdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { isContent, walkVaultEntries } from './graph.mjs';
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
// The walk is buildGraph's (walkVaultEntries): a link cycle or an entry that vanished is skipped, not fatal, and
// pushed as { path, reason } onto the optional skippedPaths array.
export function walkVault(vaultPath, skippedPaths = []) {
  const files = [];
  walkVaultEntries(vaultPath, {
    skippedPaths,
    enter: (e, rel) => Boolean(rel) || ['wiki', 'moc'].includes(e),
    file(abs, r, _e, st) {
      if (inScope(r) && isContent(r)) {
        files.push({ path: r, abs, mtimeMs: st.mtimeMs, size: st.size });
      }
    },
  });
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

function allFinite(data, start, end) {
  for (let i = start; i < end; i++) if (!Number.isFinite(data[i])) return false;
  return true;
}

// The vector store's usable vectors, and why any of it cannot be trusted: `damaged` is null for a sound store, or a
// missing one, which only means there is nothing to reuse yet. `dim` is the store's dimension.
//
// What can be checked is the shape, because a chunk's hash keys its text and nothing records a vector's bytes: a
// vector is usable when its slot is its own, lies wholly inside the file and holds only finite numbers. The file's
// length has to agree with the index. Too short means a cut, and the vectors before it are still usable. Too long
// means the index's dimension or its slots are wrong, so no byte can be assigned to any vector and none is usable.
// This is one linear pass over the numbers: about 50 ms for 50 million.
function inspectVectorStore(dir) {
  const binF = join(dir, VECTORS_BIN);
  const idxF = join(dir, VECTORS_IDX);
  if (!existsSync(binF) || !existsSync(idxF)) return { vectors: {}, dim: 0, damaged: null };
  let idx, bin;
  try {
    idx = JSON.parse(readFileSync(idxF, 'utf8'));
    bin = readFileSync(binF);
  } catch (error) {
    return { vectors: {}, dim: 0, damaged: `${VECTORS_IDX}: ${error.message}` };
  }
  const { dim, slots } = idx ?? {};
  if (!Number.isInteger(dim) || dim < 0 || slots === null || typeof slots !== 'object' || Array.isArray(slots)) {
    return { vectors: {}, dim: 0, damaged: `${VECTORS_IDX} is not a vector index` };
  }
  const entries = Object.entries(slots);
  if (bin.byteLength > entries.length * dim * 4) {
    return { vectors: {}, dim, damaged: `${VECTORS_BIN} is longer than ${VECTORS_IDX} accounts for` };
  }
  const floats = Math.floor(bin.byteLength / 4);
  const bytes = new Uint8Array(floats * 4);
  bytes.set(bin.subarray(0, floats * 4));
  const data = new Float32Array(bytes.buffer);
  const uses = new Map();
  for (const [, slot] of entries) uses.set(slot, (uses.get(slot) ?? 0) + 1);
  const vectors = {};
  let lost = 0;
  for (const [hash, slot] of entries) {
    const start = slot * dim;
    const end = start + dim;
    if (dim > 0 && Number.isInteger(slot) && slot >= 0 && uses.get(slot) === 1 && end <= floats && allFinite(data, start, end)) {
      vectors[hash] = data.subarray(start, end);
    } else lost++;
  }
  return { vectors, dim, damaged: lost ? `${VECTORS_BIN} has ${lost} unusable vector(s) of ${entries.length}` : null };
}

// Why a vector from the embedder cannot be stored, or null.
function answerProblem(vector) {
  if (typeof vector?.length !== 'number' || typeof vector === 'string') return 'the embedder returned no vector';
  if (vector.length === 0) return 'the embedder returned an empty vector';
  return Array.prototype.every.call(vector, Number.isFinite) ? null : 'the embedder returned a non-finite number';
}

export function manifestProblem(manifest) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return `${CHUNKS_FILE} is not a manifest`;
  const bad = Object.keys(manifest).find((path) => !Array.isArray(manifest[path]?.chunks));
  return bad === undefined ? null : `${CHUNKS_FILE} has no chunk list for ${bad}`;
}

const damagedIndex = (why) => Object.assign(
  new Error(`the search index is damaged (${why}). Run refresh-index.mjs --rebuild, which replaces it, embedding again whatever it cannot reuse`),
  { code: 'INDEX_CORRUPT' },
);
const rebuildFailed = (why) => Object.assign(new Error(why), { code: 'INDEX_REBUILD_FAILED' });

export const DIMENSION_PROBE = 'wiki-master dimension probe';

// What a rebuild holds every vector to: the length of the embedder's answer to one short fixed string. Asking first
// means no chunk's answer can set the dimension, and a store of the wrong one shows even when no page changed.
export async function probeDimension(embedFn) {
  let answer, problem;
  try {
    answer = await embedFn(DIMENSION_PROBE);
    problem = answerProblem(answer);
  } catch (error) {
    problem = String(error?.message || error);
  }
  if (problem) throw rebuildFailed(`the embedder did not answer the dimension probe (${problem}), so the search index was left as it was. Run refresh-index.mjs --rebuild again once it answers`);
  return answer.length;
}

// What a refresh starts from. A rebuild trusts no manifest, so it never parses one, and reuses the vectors that pass
// inspection, embedding the rest. Any other run stops at damage, before it can shrink or rewrite anything, because
// repairing it means re-chunking every page, which the caller should ask for.
function loadIndex(dir, rebuild) {
  const store = inspectVectorStore(dir);
  if (rebuild) return { manifest: {}, vectors: store.vectors, dim: store.dim };
  let manifest;
  try {
    manifest = readManifestFile(dir);
  } catch (error) {
    throw damagedIndex(`${CHUNKS_FILE}: ${error.message}`);
  }
  const problem = manifestProblem(manifest) ?? store.damaged;
  if (problem) throw damagedIndex(problem);
  return { manifest, vectors: store.vectors, dim: store.dim };
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

function metadataRefreshManifest(manifest) {
  return Object.fromEntries(Object.entries(manifest).map(([path, entry]) => [path,
    entry.metadataVersion === METADATA_VERSION ? entry : { ...entry, mtimeMs: NaN }]));
}

// How far the vault has moved from a manifest the caller already holds. It walks the vault and reads no vector.
export function freshness({ vaultPath, manifest }) {
  const plan = planRefresh(metadataRefreshManifest(manifest), walkVault(vaultPath));
  return { filesChanged: plan.changed.length, filesRemoved: plan.removed.length };
}

// Coverage only: embeds nothing, writes nothing. `damaged` says why the index cannot be trusted, or is null; a plain
// refresh stops for the same reason. A manifest that is not one counts for nothing here, so the rest can still be told.

export function statusReport({ vaultPath, dir }) {
  const read = readManifestFile(dir);
  const problem = manifestProblem(read);
  const manifest = problem ? {} : read;
  const { vectors, damaged } = inspectVectorStore(dir);
  return { ...coverage(manifest, Object.keys(vectors)), ...freshness({ vaultPath, manifest }), damaged: problem ?? damaged };
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
  probedDim,
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
  const dimension = rebuild ? probedDim ?? await probeDimension(embedFn) : null;
  const { manifest: loadedManifest, vectors: stored, dim: storedDim } = loadIndex(dir, rebuild);
  // --rebuild discards the MANIFEST (forcing every file through the
  // "changed" path below, so every file is genuinely re-chunked). It keeps the
  // vector STORE when the store is at the embedder's dimension: an unchanged
  // chunk's content hashes identically either way, so its usable vector still
  // misses re-embedding via neededHashes. Rebuild buys "distrust the mtime/size
  // shortcut", not "throw away work that is still valid". At another dimension
  // nothing in the store can be used, so everything is embedded again.
  const changesDimension = rebuild && storedDim > 0 && storedDim !== dimension;
  const vectors = changesDimension ? {} : stored;
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
  //
  // The dimension: a rebuild holds every answer to the probe's length, and an answer of another length is a failed
  // chunk. A plain run holds new vectors to the store's; the embedder disagreeing means the store or the model changed,
  // and mixing the two would ruin the store, so the run stops below. A plain run with nothing to embed never asks the
  // embedder, so a store that agrees with itself at the wrong dimension surfaces only at the next embedding or rebuild.
  let embedded = 0;
  let expectedDim = dimension ?? (storedDim || null);
  let disagreed = null;
  const failures = [];
  await runPool(needed, concurrency, async (h) => {
    try {
      const vec = await embedFn(hashToText.get(h));
      const problem = answerProblem(vec);
      if (problem) throw new Error(problem);
      expectedDim ??= vec.length;
      if (vec.length !== expectedDim) {
        disagreed ??= vec.length;
        throw new Error(`the embedder returned ${vec.length} numbers where ${expectedDim} are expected`);
      }
      vectors[h] = vec;
      embedded++;
    } catch (err) {
      const text = hashToText.get(h) ?? '';
      failures.push({ hash: h, chars: text.length, error: String(err && err.message || err) });
      return;
    }
    onProgress({ phase: 'embed', embedded, total: needed.length });
  });
  if (!rebuild && storedDim && disagreed !== null) {
    throw damagedIndex(`the embedder returns ${disagreed} numbers per vector and the store holds ${storedDim}`);
  }
  // A dimension change is all or nothing: a partial store at the new dimension would have thrown away every good vector
  // at the old one, and plain runs could not finish the job.
  if (changesDimension && failures.length) {
    throw rebuildFailed(`${failures.length} of ${needed.length} chunk(s) failed in a rebuild that changes the store's dimension from ${storedDim} to ${dimension}, so nothing was saved and the old store stands (first error: ${failures[0].error}). Run refresh-index.mjs --rebuild again once that is fixed`);
  }

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
