import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUrl } from './url.mjs';

// "Seen, considered, declined" must have a representation, or an un-clipped
// candidate is re-litigated on every discovery run forever. Design constraints
// from prior art:
//  - keyed by URL, not content hash (a re-clip gets a new hash; the decline
//    must match the *identity* of the source, which for the web is its URL)
//  - stored OUTSIDE raw/ (the artifact may never exist, or may be deleted —
//    the decision must outlive the artifact; Miniflux's tombstone lesson)
//  - in the .wiki-master/ dotfolder, which Obsidian cannot index
//  - TTL'd: a decline without an expiry loops forever as the world changes
//    (RFC 2308). Expired declines simply get re-evaluated once.

export const DECLINE_TTL_DAYS = 180;

function storePath(vaultPath) {
  return join(vaultPath, '.wiki-master', 'declined.json');
}

export function loadDeclines(vaultPath) {
  const f = storePath(vaultPath);
  if (!existsSync(f)) return [];
  let entries;
  try { entries = JSON.parse(readFileSync(f, 'utf8')); }
  catch { return []; }
  const cutoff = Date.now() - DECLINE_TTL_DAYS * 86400_000;
  return entries.filter((e) => new Date(e.date).getTime() >= cutoff);
}

export function isDeclined(url, declines) {
  const n = normalizeUrl(url).toLowerCase();
  return declines.some((e) => normalizeUrl(e.url).toLowerCase() === n);
}

export function recordDecline(vaultPath, url, reason) {
  const dir = join(vaultPath, '.wiki-master');
  mkdirSync(dir, { recursive: true });
  const f = storePath(vaultPath);
  let entries = [];
  if (existsSync(f)) {
    try { entries = JSON.parse(readFileSync(f, 'utf8')); } catch { entries = []; }
  }
  const n = normalizeUrl(url).toLowerCase();
  entries = entries.filter((e) => normalizeUrl(e.url).toLowerCase() !== n);
  entries.push({ url, reason, date: new Date().toISOString().slice(0, 10) });
  writeFileSync(f, JSON.stringify(entries, null, 2));
  return entries;
}
