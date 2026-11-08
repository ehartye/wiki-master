import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GRAPH_CACHE_FILE, graphCacheKey } from './graph.mjs';
import { INTEGRITY_DERIVE_ID } from './integrity.mjs';

// The read side of the graph record cache (see GRAPH_CACHE_FORMAT in graph.mjs), for validate-authored.mjs and
// health.mjs. It reads and never writes: this module imports no write function, and the writer
// (graph-cache-write.mjs) is imported only by refresh-index.mjs.
//
// A cache whose format, plugin version, derive id or vault root differs, that is missing, unreadable or not valid
// JSON, is no cache at all: the caller builds cold. An entry is used only while its size and modification time
// equal the file's current stat; an entry of the wrong shape is a miss. An edit that keeps both size and time
// (`touch -r`, `rsync -t`) is not seen until the next refresh rewrites the cache, which is what --no-cache is for.

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Returns { derive, entries, lookup(path, stat, wantExtra) } or null. `lookup` gives { page, extra? } or null.
export function readGraphCache(vaultPath, { derive = INTEGRITY_DERIVE_ID, readFile = readFileSync } = {}) {
  let data;
  try { data = JSON.parse(readFile(join(vaultPath, GRAPH_CACHE_FILE), 'utf8')); } catch { return null; }
  if (!isObject(data)) return null;
  for (const [field, value] of Object.entries(graphCacheKey(vaultPath, derive))) if (data[field] !== value) return null;
  const { entries } = data;
  if (!isObject(entries)) return null;
  return {
    derive,
    entries: Object.keys(entries).length,
    lookup(path, stat, wantExtra = false) {
      const entry = Object.hasOwn(entries, path) ? entries[path] : null;
      if (!isObject(entry) || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) return null;
      if (!isObject(entry.page) || entry.page.path !== path) return null;
      if (!wantExtra) return { page: entry.page };
      return isObject(entry.extra) ? { page: entry.page, extra: entry.extra } : null;
    },
  };
}
