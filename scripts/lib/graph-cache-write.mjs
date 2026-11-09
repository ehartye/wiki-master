import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
//
// A run killed between its write and its rename leaves its temporary file (as large as the cache). Each run first
// removes the cache's temporary files last modified more than STALE_TEMP_MS before `clock()`, an age no write in
// progress in another session reaches, and ignores any error doing so.
export const STALE_TEMP_MS = 10 * 60_000;

function removeStaleTemps(file, now) {
  const dir = dirname(file);
  const prefix = `${basename(file)}.`;
  let names;
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
    try { if (now - statSync(join(dir, name)).mtimeMs > STALE_TEMP_MS) rmSync(join(dir, name), { force: true }); } catch { /* another run took it */ }
  }
}

export function writeGraphCache(vaultPath, records, { builtAtMs, exclude = [], derive = INTEGRITY_DERIVE_ID, writeFileImpl = writeFileSync, renameImpl = renameSync, clock = Date.now } = {}) {
  if (!Number.isFinite(builtAtMs)) throw new TypeError('writeGraphCache needs builtAtMs, the time the build began');
  removeStaleTemps(join(vaultPath, GRAPH_CACHE_FILE), clock());
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
