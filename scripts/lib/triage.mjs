import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUrl } from './url.mjs';
import { DECLINE_TTL_DAYS } from './decline.mjs';
import { normalizeTopic } from './topic.mjs';

// The triage queue records sources that need a human decision — a link the
// pipeline could not resolve on its own. Design constraints, several learned the
// hard way:
//
//  - APPEND-ONLY JSONL, never read-modify-write. Two sessions clipping into one
//    vault is normal (observed 2026-07-20), and a rewritten JSON file has a
//    lost-update mode that erases the loser's entries silently. A file that only
//    ever gains lines cannot lose one.
//  - EVENTS, NOT STATE. Current status is folded from the log at read time, so a
//    disposition never rewrites the event it resolves. History stays auditable:
//    "declined twice, retried, failed again" is legible, and a bad disposition is
//    correctable by appending rather than editing.
//  - A RECURRENCE REOPENS. A failure observed after you dispositioned it is news,
//    not history — the world changed, or the disposition was wrong.
//  - Transient failures belong here, NOT in declined.json. A decline is a judgment
//    ("seen, considered, rejected"); a 403 is a fact about one fetch. Conflating
//    them buries recoverable sources under a 180-day TTL.

export const ISSUE_KINDS = [
  'failed', // fetch failed — 403, paywall, transient network
  'thin', // extracted, but SPA/paywall shell below the word floor
  'wrong-node', // extraction landed on the wrong DOM node
  'blocked', // domain on the blocklist, or an anti-bot gate that held
  // The source is DEAD — a 404/410, or a redirect onto an error page. Split out
  // of 'failed' because the two ask opposite things of a human: 'failed' means
  // "try this again, from a browser"; 'gone' means "stop trying, find another
  // source or drop the claim". Filing a dead link as maybe-transient is how a
  // queue accumulates rows nobody can ever action.
  'gone',
  'fidelity', // clipped, but degraded: gibberish, OCR damage, abstract-only
  'attention', // generic: a link the agent wants a human decision on
];

const LOG = 'triage.jsonl';

function logPath(vaultPath) {
  return join(vaultPath, '.wiki-master', LOG);
}

function key(url, kind) {
  return `${normalizeUrl(String(url ?? '').replace(/\\\\/g, '\\')).toLowerCase()}\u0000${kind}`;
}

function append(vaultPath, event) {
  mkdirSync(join(vaultPath, '.wiki-master'), { recursive: true });
  appendFileSync(logPath(vaultPath), JSON.stringify(event) + '\n');
  return event;
}

// `topic` is the research topic this issue came out of -- the argument the user
// gave /wiki-discover. It is carried here as well as in clipping frontmatter
// because these two populations do not overlap: a clip that 403s never becomes
// a file, so frontmatter cannot speak for it. See lib/topic.mjs.
export function recordIssue(vaultPath, { url, kind, reason, title = null, source = null, topic = null }) {
  if (!ISSUE_KINDS.includes(kind)) throw new Error(`unknown issue kind: ${kind}`);
  return append(vaultPath, {
    t: 'issue',
    url,
    kind,
    reason,
    title,
    source,
    topic: normalizeTopic(topic),
    at: new Date().toISOString(),
  });
}

export function disposeIssue(vaultPath, { url, kind, disposition, note = null }) {
  return append(vaultPath, {
    t: 'disposition',
    url,
    kind,
    disposition,
    note,
    at: new Date().toISOString(),
  });
}

// A corrupt line is skipped, never fatal. A half-written line from a killed
// process must not make the whole queue unreadable — that would turn a cosmetic
// fault into total data loss for every other entry.
export function loadIssueLog(vaultPath) {
  const f = logPath(vaultPath);
  if (!existsSync(f)) return [];
  let raw;
  try {
    raw = readFileSync(f, 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return events;
}

export function openIssues(log) {
  const state = new Map();
  for (const e of log) {
    if (!e || !e.url || !e.kind) continue;
    const k = key(e.url, e.kind);
    if (e.t === 'issue') {
      const prior = state.get(k);
      state.set(k, {
        url: e.url,
        kind: e.kind,
        reason: e.reason,
        title: e.title ?? prior?.title ?? null,
        source: e.source ?? prior?.source ?? null,
        // Prior-wins, like title and source: a recurrence recorded outside a
        // research run (a retry, a lint sweep) carries no topic, and letting
        // that null overwrite the original attribution would move a row into
        // Unattributed precisely because it recurred.
        topic: e.topic ?? prior?.topic ?? null,
        firstSeen: prior?.firstSeen ?? e.at,
        lastSeen: e.at,
        occurrences: (prior?.occurrences ?? 0) + 1,
      });
    } else if (e.t === 'disposition') {
      state.delete(k);
    }
  }
  return [...state.values()];
}

// Sources settled by a disposition — but only while nothing newer has happened.
// "A recurrence reopens an issue" (see the header): an issue recorded AFTER a
// disposition means the world changed or the disposition could not be honoured —
// a re-clip that 403s, an extraction still degraded — so suppression must yield to
// it, or unfulfillable work sits invisible behind a decision that did not stick.
// One identity for an issue, shared by every comparison. Doubled backslashes are
// collapsed inside `key` because the same local path arrives in two forms: a log
// entry stores it as passed (C:\x), frontmatter stores it YAML-escaped (C:\\x).
export { key as issueKey };

export function settledKeys(log) {
  const latest = new Map();
  for (const e of log) {
    if (!e?.url || !e.kind || (e.t !== 'issue' && e.t !== 'disposition')) continue;
    latest.set(key(e.url, e.kind), e.t);
  }
  return new Set([...latest].filter(([, t]) => t === 'disposition').map(([k]) => k));
}

// Both kinds can ask for a (re)clip: `fidelity` when the extraction was poor, and
// `failed` when the source could not be fetched at all — a paywalled PDF you then
// downloaded by hand. `downloaded` and `reclip` are both work orders, so the
// disposition IS the trigger; nothing else has to be remembered.
const CLIP_REQUEST_KINDS = new Set(['fidelity', 'failed']);
const CLIP_REQUESTS = new Set(['reclip', 'downloaded']);

// Sources whose LATEST disposition asked for a (re)clip. A disposition
// closes an issue but never performed the work it named, so re-clips piled up
// unnoticed. Latest-wins so changing your mind is honoured in both directions;
// de-duplicated so clicking three times is one job. Whether the re-clip is still
// NEEDED is derived from the vault (is the clipping still degraded?), never stored.
export function pendingReclips(log) {
  const latest = new Map();
  for (const e of log) {
    if (e?.t !== 'disposition' || !CLIP_REQUEST_KINDS.has(e.kind) || !e.url) continue;
    latest.set(normalizeUrl(e.url).toLowerCase(), { url: e.url, disposition: e.disposition, note: e.note ?? null });
  }
  // One source can be recorded under both kinds; it is still one job.
  const out = new Map();
  for (const v of latest.values()) {
    if (!CLIP_REQUESTS.has(v.disposition)) continue;
    const k = key(v.url, '');
    // A browse upload records the exact file it saved; that beats any inference,
    // so it wins over a bare request for the same source.
    out.set(k, { url: v.url, file: v.note || out.get(k)?.file || null });
  }
  return [...out.values()];
}

export function declinesNearingExpiry(vaultPath, { withinDays = 30 } = {}) {
  const f = join(vaultPath, '.wiki-master', 'declined.json');
  if (!existsSync(f)) return [];
  let entries;
  try {
    entries = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];

  const out = [];
  for (const e of entries) {
    const declinedAt = new Date(e.date).getTime();
    if (Number.isNaN(declinedAt)) continue;
    const expiresAt = declinedAt + DECLINE_TTL_DAYS * 86400_000;
    const daysRemaining = Math.ceil((expiresAt - Date.now()) / 86400_000);
    if (daysRemaining > 0 && daysRemaining <= withinDays) {
      out.push({ ...e, daysRemaining });
    }
  }
  return out.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
