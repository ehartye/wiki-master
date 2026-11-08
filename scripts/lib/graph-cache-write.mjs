import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GRAPH_CACHE_FILE, GRAPH_CACHE_RACY_MS, graphCacheKey } from './graph.mjs';
import { INTEGRITY_DERIVE_ID } from './integrity.mjs';

// The write side of the graph record cache (see GRAPH_CACHE_FORMAT in graph.mjs). Only refresh-index.mjs imports
// it, and it never reads the cache to use it: it writes the records of the refresh's own cold build.
//
//   { "format": n, "plugin": "<version>", "derive": "<derive id>", "root": "<canonical vault path>",
//     "builtAtMs": n, "entries": { "<path>": { "size": n, "mtimeMs": n, "page": {...}, "extra": {...} } } }
//
// `records` is buildGraph's Map, captured before any catalog phase changed the graph. `exclude` lists the paths the
// refresh wrote after reading them (its catalogs): their record is stale, so they get no entry. `builtAtMs` is when
// the build began; a file modified within GRAPH_CACHE_RACY_MS of it gets no entry either. The file is replaced
// through a temporary file in the same directory and a rename, so a reader sees the old cache or the new one; a
// cache that would differ only in builtAtMs is not rewritten. Returns { written, entries }; a failure throws.
export function writeGraphCache(vaultPath, records, { builtAtMs, exclude = [], derive = INTEGRITY_DERIVE_ID, writeFileImpl = writeFileSync, renameImpl = renameSync } = {}) {
  if (!Number.isFinite(builtAtMs)) throw new TypeError('writeGraphCache needs builtAtMs, the time the build began');
  const dropped = new Set(exclude);
  const entries = {};
  for (const path of [...records.keys()].sort()) {
    const { size, mtimeMs, page, extra } = records.get(path);
    if (dropped.has(path) || !(mtimeMs <= builtAtMs - GRAPH_CACHE_RACY_MS)) continue;
    entries[path] = { size, mtimeMs, page, ...(extra === undefined ? {} : { extra }) };
  }
  const head = JSON.stringify(graphCacheKey(vaultPath, derive)).slice(0, -1);
  const tail = `,"entries":${JSON.stringify(entries)}}`;
  const file = join(vaultPath, GRAPH_CACHE_FILE);
  const count = Object.keys(entries).length;
  let previous = null;
  try { previous = readFileSync(file, 'utf8'); } catch { /* none yet */ }
  if (previous && previous.startsWith(`${head},"builtAtMs":`) && previous.endsWith(tail)
    && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(previous.slice(head.length + ',"builtAtMs":'.length, previous.length - tail.length))) {
    return { written: false, entries: count };
  }
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileImpl(temp, `${head},"builtAtMs":${JSON.stringify(builtAtMs)}${tail}`);
    renameImpl(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return { written: true, entries: count };
}
