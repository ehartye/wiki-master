// Chunk-level vector index: manifest bookkeeping, binary Float32 vector
// (de)serialization, and page-aggregated query. Pure -- no node:fs, no
// child_process. The CLI (a later task) owns real file I/O and passes plain
// objects/Buffers into these functions. See
// docs/superpowers/specs/2026-08-09-chunk-semantic-index-design.md section 5.2.
//
// Two persisted artifacts, shapes defined here:
//
//   manifest (chunks.json):
//     { [path]: { mtimeMs: number, size: number,
//                  chunks: [{ hash, startLine, endLine }] } }
//     One entry per source file. `chunks` lists every chunk produced from
//     that file's current content, in document order. Refresh decides what
//     to re-chunk by comparing mtimeMs/size against this (see planRefresh).
//
//   vector store (vectors.bin + vectors.idx.json):
//     vectors.bin is the raw bytes of ONE Float32Array, hash-ordered: vector
//     for the alphabetically-first hash occupies slot 0, next hash slot 1,
//     etc., each slot `dim` consecutive float32 values (dim = embedding
//     dimensionality, e.g. 768 for nomic-embed-text). Float32 instead of
//     JSON: ~3 KB/vector at 768 dims vs ~6 KB as JSON text, and it loads by
//     a single typed-array view instead of a JSON.parse of thousands of
//     floats.
//     vectors.idx.json is { dim: number, slots: { [chunkHash]: slotNumber } }
//     -- slotNumber * dim * 4 is the byte offset of that hash's vector
//     inside vectors.bin. Keyed by CHUNK-CONTENT hash (mirrors
//     embed-cache.mjs's page-hash convention): an edited chunk hashes
//     differently, misses this index, and gets re-embedded. The index can
//     be incomplete, never wrong.

import { cosine } from './embed.mjs';

// encodeVectors({ [hash]: number[] | Float32Array }) -> { buffer, idx }
// `buffer` is a Node Buffer of hash-ordered, back-to-back float32 values;
// `idx` is the JSON-serializable { dim, slots } companion (see file-format
// comment above). Hash order is the SORTED key order, so the same map
// always encodes to the same bytes regardless of insertion order.
export function encodeVectors(map) {
  const hashes = Object.keys(map).sort();
  const dim = hashes.length ? map[hashes[0]].length : 0;
  const data = new Float32Array(hashes.length * dim);
  const slots = {};
  hashes.forEach((h, slot) => {
    slots[h] = slot;
    data.set(map[h], slot * dim);
  });
  // `data` is a freshly allocated typed array (byteOffset 0 in its own
  // ArrayBuffer), so wrapping its buffer directly is a zero-copy Buffer view.
  return { buffer: Buffer.from(data.buffer), idx: { dim, slots } };
}

// decodeVectors(buffer, idx) -> { [hash]: Float32Array } -- the inverse of
// encodeVectors. Copies into a freshly aligned ArrayBuffer first: `buffer`
// may be a slice of a larger allocation (e.g. handed in from a caller who
// read it as part of something bigger) whose byteOffset is not guaranteed
// to be a multiple of 4, which Float32Array construction requires.
export function decodeVectors(buffer, idx) {
  const { dim, slots } = idx;
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  const data = new Float32Array(bytes.buffer);
  const out = {};
  for (const [hash, slot] of Object.entries(slots)) {
    out[hash] = data.subarray(slot * dim, slot * dim + dim);
  }
  return out;
}

// planRefresh(manifest, files) -> { changed, unchanged, removed }
// `files` is [{ path, mtimeMs, size }], the current state of the vault.
// A file is `changed` if it is new (no manifest entry) OR either mtimeMs OR
// size differs from the manifest -- checking size too matters because a
// sync/backup tool can rewrite a file's bytes while preserving its mtime,
// and comparing mtime alone would then miss a real edit forever (see M5 in
// the mutation table). `changed`/`unchanged` entries are the `files` objects
// themselves (path+mtimeMs+size), since a caller re-chunking a changed file
// needs exactly that to write the manifest back. `removed` is the list of
// manifest paths with no corresponding file, as bare path strings.
export function planRefresh(manifest, files) {
  const changed = [];
  const unchanged = [];
  for (const f of files) {
    const entry = manifest[f.path];
    if (!entry || entry.mtimeMs !== f.mtimeMs || entry.size !== f.size) {
      changed.push(f);
    } else {
      unchanged.push(f);
    }
  }
  const seen = new Set(files.map((f) => f.path));
  const removed = Object.keys(manifest).filter((p) => !seen.has(p));
  return { changed, unchanged, removed };
}

// neededHashes(chunkHashes, haveHashes) -> chunkHashes with no vector yet.
// Keyed by chunk-content hash, exactly mirroring embed-cache.mjs's page-hash
// convention -- this is what makes staleness structurally impossible: an
// edited chunk hashes differently, misses `haveHashes`, and is re-embedded.
export function neededHashes(chunkHashes, haveHashes) {
  const have = new Set(haveHashes);
  return chunkHashes.filter((h) => !have.has(h));
}

// queryChunks(queryVec, vectors, chunkMeta, { topN }) -> ranked
// { path, score, startLine }[]. `vectors` is { [hash]: vector }; `chunkMeta`
// is [{ hash, path, startLine }] -- every chunk currently in the index,
// flattened out of the manifest by the caller. A page scores as its BEST
// (highest-cosine) chunk and reports that chunk's startLine, not the
// page's first chunk -- a hit deep in a long document must still surface
// with a line number pointing at the actual matching passage. Ties are
// broken by path (ascending) so results are deterministic run to run.
export function queryChunks(queryVec, vectors, chunkMeta, { topN = 10 } = {}) {
  const best = new Map(); // path -> { path, score, startLine }
  for (const meta of chunkMeta) {
    const vec = vectors[meta.hash];
    if (!vec) continue; // not yet embedded -- see neededHashes
    const score = cosine(queryVec, vec);
    const current = best.get(meta.path);
    if (!current || score > current.score) {
      best.set(meta.path, { path: meta.path, score, startLine: meta.startLine });
    }
  }
  return [...best.values()]
    // Relational comparator, never localeCompare: collation depends on the
    // machine's ICU locale, so two machines would order identical-scoring hits
    // differently. Same rule sortedByPath follows in lib/purge.mjs, for the
    // same reason and after the same bug.
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, topN);
}

// coverage(manifest, haveHashes) -> { files, chunks, embedded, missing } for
// the health report: how many files are indexed, how many chunks they
// produced in total, how many of those chunks already have a vector, and
// how many are still outstanding.
export function coverage(manifest, haveHashes) {
  const have = new Set(haveHashes);
  let chunks = 0;
  let embedded = 0;
  for (const entry of Object.values(manifest)) {
    for (const c of entry.chunks) {
      chunks++;
      if (have.has(c.hash)) embedded++;
    }
  }
  return { files: Object.keys(manifest).length, chunks, embedded, missing: chunks - embedded };
}
