// The clippings a vault already holds, read by their source URL. One reading, shared by the clipper's duplicate check,
// its recapture route and the known-URL commands, so every one of them answers "is this URL known?" the same way.
//
// Only the top level of raw/clippings is read, as the clippers always have. A URL can be held by more than one clipping
// once a page is recaptured: each holder is returned, with what tells the captures apart.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUrl } from './url.mjs';

// The same key the duplicate check compares: normalized, case-insensitive.
export const urlKey = (url) => normalizeUrl(String(url ?? '')).toLowerCase();

const frontmatterOf = (text) => {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
};
const scalar = (block, name) => {
  const m = block.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'));
  if (!m) return null;
  let value = m[1].trim();
  if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { value = value.replace(/^"|"$/g, ''); } }
  else value = value.replace(/^'|'$/g, '');
  return value === '' ? null : String(value);
};

// Every top-level clipping that has a `source:` line, in directory order:
// { file, name, url, created, sourceHash, recaptureOf, twinUrl, fidelity } with null for a field the clipping does not carry.
// `source` is found as it always was, the first `source:` line of the file, so a clipping the clippers could read
// before is still read.
export function readClippings(vaultPath) {
  const dir = join(vaultPath, 'raw', 'clippings');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    const m = text.match(/^source:\s*"?([^"\n]+)"?/m);
    if (!m) continue;
    const block = frontmatterOf(text);
    out.push({
      file,
      name: file.slice(0, -3),
      url: m[1].trim(),
      created: scalar(block, 'created'),
      sourceHash: scalar(block, 'source-hash'),
      recaptureOf: scalar(block, 'recapture-of'),
      twinUrl: scalar(block, 'twin-url'),
      fidelity: scalar(block, 'fidelity'),
    });
  }
  return out;
}

// Map of normalized URL -> the clippings that hold it. A clipping stored from a plain-text twin holds the twin's URL too,
// so a later clip of the twin is known; `twins: false` leaves those keys out for a reader that counts or recaptures PAGES.
export function knownUrlIndex(vaultPath, { twins = true } = {}) {
  const index = new Map();
  const add = (key, entry) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(entry);
  };
  for (const entry of readClippings(vaultPath)) {
    add(urlKey(entry.url), entry);
    if (twins && entry.twinUrl && urlKey(entry.twinUrl) !== urlKey(entry.url)) add(urlKey(entry.twinUrl), entry);
  }
  return index;
}

export function clippingsForUrl(vaultPath, url) {
  return knownUrlIndex(vaultPath, { twins: false }).get(urlKey(url)) ?? [];
}

// The latest capture of a URL: the greatest `created`, then the greatest name. Names are compared without `.md`, so
// `Guide (recaptured ...)` follows `Guide` as it reads, not as the extension would sort it. null when there are none.
export function newestCapture(entries) {
  let best = null;
  for (const e of entries) {
    if (best === null) { best = e; continue; }
    const a = e.created ?? '';
    const b = best.created ?? '';
    if (a > b || (a === b && e.name > best.name)) best = e;
  }
  return best;
}

// The URLs the vault already holds: the source of every clipping, as the clippers have always read them, and the twin a
// clipping was stored from.
export function knownSourceUrls(vaultPath) {
  return readClippings(vaultPath).flatMap((e) => (e.twinUrl ? [e.url, e.twinUrl] : [e.url]));
}
