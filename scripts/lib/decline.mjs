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

// The decline entries that still hold: not expired and not superseded. A superseded entry stays in the file (with the
// reason it was superseded for) until it expires, so the log can say why a source was clipped after being declined.
export function loadDeclines(vaultPath) {
  const f = storePath(vaultPath);
  if (!existsSync(f)) return [];
  let entries;
  try { entries = JSON.parse(readFileSync(f, 'utf8')); }
  catch { return []; }
  const cutoff = Date.now() - DECLINE_TTL_DAYS * 86400_000;
  return entries.filter((e) => new Date(e.date).getTime() >= cutoff && !e.superseded);
}

export function isDeclined(url, declines) {
  const n = normalizeUrl(url).toLowerCase();
  return declines.some((e) => !e.superseded && normalizeUrl(e.url).toLowerCase() === n);
}

// A decline the clippers recorded on their own, from what they read: a thin result or a wrong-node extraction. A
// decline someone chose (`--decline="reason"`, a discovery verdict) does not match, so it is never lifted by the
// flag that exists for the automatic kind. Reasons recorded by purge start with `purge`, and do not match either.
export const AUTOMATIC_REASON = /^(thin (content|text)\b|likely wrong-node extraction)/;
export function isAutomaticDecline(entry) {
  return AUTOMATIC_REASON.test(entry?.reason ?? '');
}

// The date a decline stops holding: the day it was recorded plus the TTL.
export function declineExpiry(entry) {
  return new Date(new Date(entry.date).getTime() + DECLINE_TTL_DAYS * 86400_000).toISOString().slice(0, 10);
}

// Every entry in the log, expired and superseded ones too, for the commands that show the log (decline.mjs). The
// readers that decide whether a source is declined use loadDeclines.
export function readDeclineLog(vaultPath) {
  const entries = readAll(vaultPath);
  return Array.isArray(entries) ? entries : [];
}

function readAll(vaultPath) {
  const f = storePath(vaultPath);
  if (!existsSync(f)) return [];
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return []; }
}

export function recordDecline(vaultPath, url, reason) {
  const dir = join(vaultPath, '.wiki-master');
  mkdirSync(dir, { recursive: true });
  const f = storePath(vaultPath);
  let entries = readAll(vaultPath);
  const n = normalizeUrl(url).toLowerCase();
  // Declining a URL again keeps what was decided before: the earlier decision joins the entry's history.
  const before = entries.find((e) => normalizeUrl(e.url).toLowerCase() === n);
  entries = entries.filter((e) => normalizeUrl(e.url).toLowerCase() !== n);
  const entry = { url, reason, date: new Date().toISOString().slice(0, 10) };
  if (before) {
    const { history = [], url: _url, ...past } = before;
    entry.history = [...history, past];
  }
  entries.push(entry);
  writeFileSync(f, JSON.stringify(entries, null, 2));
  return entries;
}

// Marks the active decline for `url` superseded with a new reason and date, instead of deleting it. With
// `onlyAutomatic` a decline someone recorded on purpose is left alone. Returns { done: true } or { done: false, why }.
export function supersedeDecline(vaultPath, url, reason, { onlyAutomatic = false } = {}) {
  const entries = readAll(vaultPath);
  const n = normalizeUrl(url).toLowerCase();
  const entry = entries.find((e) => normalizeUrl(e.url).toLowerCase() === n && !e.superseded);
  if (!entry) return { done: false, why: 'none' };
  if (onlyAutomatic && !isAutomaticDecline(entry)) return { done: false, why: 'not-automatic' };
  entry.superseded = { reason, date: new Date().toISOString().slice(0, 10) };
  writeFileSync(storePath(vaultPath), JSON.stringify(entries, null, 2));
  return { done: true };
}

// The inverse of recordDecline, for --restore: a file coming back is not a
// true undo of the purge that removed it if the decline it recorded on the
// way out survives for another 180 days — /wiki-discover would keep silently
// skipping a source the user now has back. Scoped to an EXACT reason match,
// not just the URL: a decline the user made independently (or that some
// other, later purge recorded against the same URL) must never be silently
// cleared just because a restore happens to touch that URL. Returns the
// count actually removed (0 or 1 — url is unique per entry), so the caller
// can report what changed rather than assert success unconditionally.
export function removeDecline(vaultPath, url, reason) {
  const f = storePath(vaultPath);
  if (!existsSync(f)) return 0;
  let entries;
  try { entries = JSON.parse(readFileSync(f, 'utf8')); } catch { return 0; }
  const n = normalizeUrl(url).toLowerCase();
  const before = entries.length;
  entries = entries.filter((e) => !(normalizeUrl(e.url).toLowerCase() === n && e.reason === reason));
  if (entries.length === before) return 0;
  writeFileSync(f, JSON.stringify(entries, null, 2));
  return before - entries.length;
}
