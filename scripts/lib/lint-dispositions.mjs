import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// A record that a person read a lint finding and what they decided. The lint reported thousands of quotes on every run
// because nothing said one had been read. The record is a tracked file at the vault root (`lint-dispositions.jsonl`),
// one JSON object per line and append-only, so two machines that each add lines merge without a conflict (the vault marks
// the file `merge=union`); the latest line for an id is the verdict.
//
// A finding is identified by its page, its quote and the raw evidence behind it. Editing the quote, or replacing a
// clipping the page rests on, gives the finding a new identity: it is listed again for a new reading.

export const DISPOSITIONS_FILE = 'lint-dispositions.jsonl';
// own-wording: the page's own words in quotation marks; mention: the quote names or discusses a phrase; title: the quoted
// text is a title; markup: only markup or extraction spacing differs; accepted: read and kept; fixed: the page was corrected.
export const DISPOSITIONS = ['own-wording', 'mention', 'title', 'markup', 'accepted', 'fixed'];
const VERSION = 1;

const sha = (text) => createHash('sha256').update(text).digest('hex');

// Only raw clippings count: a wiki page used as a route to evidence is edited for other reasons, and a verdict about a
// quote should not lapse each time a summary is touched. Order does not matter.
export function evidenceHashOf(paths, bodies) {
  const raw = paths.map((p, i) => [p, bodies[i]]).filter(([p]) => p.startsWith('raw/')).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sha(raw.map(([p, body]) => `${p}\0${body}`).join('\0\0')).slice(0, 16);
}

export function findingId({ page, quote, evidenceHash }) {
  return sha(`${page}\0${String(quote).replace(/\s+/g, ' ').trim()}\0${evidenceHash}`).slice(0, 12);
}

// id -> the latest record. A line that is not JSON, has another version, or lacks an id is skipped, never fatal.
export function loadDispositions(file) {
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || rec.v !== VERSION || typeof rec.id !== 'string' || !rec.id) continue;
    out.set(rec.id, rec);
  }
  return out;
}

export function appendDispositions(file, records) {
  for (const r of records) {
    if (!DISPOSITIONS.includes(r.disposition)) throw new Error(`disposition must be one of ${DISPOSITIONS.join(', ')}`);
    if (!String(r.reviewer ?? '').trim()) throw new Error('a reviewer is required');
  }
  appendFileSync(file, records.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

// A verdict hides a finding, except `fixed`: a page that was corrected no longer has the finding, so one that is still
// there after a `fixed` verdict was not fixed, and it is listed.
export function reviewedBy(dispositions, finding) {
  const rec = dispositions.get(finding.id);
  return rec && rec.disposition !== 'fixed' ? rec : null;
}

export function recordFor(finding, { disposition, reviewer, note, date }) {
  return {
    v: VERSION, id: finding.id, page: finding.page, quote: finding.quote, evidence: finding.evidenceHash, tier: finding.tier,
    disposition, reviewer: reviewer.trim(), date, ...(note ? { note } : {}),
  };
}

// Removes the lines of a page that is gone. Dry by default. Every other line is kept as it is.
export function pruneDispositions(file, pageExists, { apply = false } = {}) {
  if (!existsSync(file)) return { removed: 0 };
  const kept = [];
  let removed = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let rec = null;
    try { rec = line.trim() ? JSON.parse(line) : null; } catch { /* keep a line we cannot read */ }
    if (rec && rec.v === VERSION && typeof rec.page === 'string' && !pageExists(rec.page)) { removed++; continue; }
    kept.push(line);
  }
  if (apply && removed) {
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, kept.join('\n'));
    renameSync(tmp, file);
  }
  return { removed };
}
