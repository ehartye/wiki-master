import { knownUrlIndex, urlKey, newestCapture } from './known-urls.mjs';
import { loadDeclines, isDeclined } from './decline.mjs';

// `--probe` on clip.mjs and clip-pdf.mjs: what a clip of this address would do, with nothing written to the vault.
//
// A probe is not a second implementation. It runs the clipper's own function with the three vault writers (the decline
// list, the triage queue, the closing of triage rows) replaced by recorders, and returns at the point where the clipper
// would choose a file name and write. What the recorders caught says what a real clip would have recorded, so the
// answer cannot drift from the clipper's: there is one code path, and the probe is that path without its writes.

// How many pages a probe recognises of a PDF that goes to OCR. A whole document can take minutes; the sample answers
// "does OCR read this at all" in seconds.
export const PROBE_OCR_PAGES = 2;

export function newProbe() {
  return { issues: [], declines: [] };
}

// The names a clipper's body calls, for a probe: the writers record instead of writing, and stdout is kept for the one
// JSON line (the clipper's own outcome lines say what was recorded, which would be untrue here). stderr is unchanged.
export function probeWriters(probe) {
  return {
    recordDecline: (_vaultPath, _url, reason) => { probe.declines.push({ reason }); },
    recordIssue: (_vaultPath, { kind, reason }) => { probe.issues.push({ kind, reason }); },
    closeIssuesResolvedByClip: () => {},
    console: { log: () => {}, error: (...args) => console.error(...args) },
  };
}

// Whether the vault already holds this address, and whether it is declined: two read-only lookups, the ones the
// clippers make before they fetch.
export function vaultStanding(vaultPath, source) {
  const held = newestCapture(knownUrlIndex(vaultPath).get(urlKey(source)) ?? []);
  const decline = loadDeclines(vaultPath).find((d) => isDeclined(source, [d]));
  return { existing: held ? `raw/clippings/${held.file}` : null, declineReason: decline ? decline.reason : null };
}

// A clipper's result status is coarser than the triage kind it queues: a wrong-node page and a login wall both return
// `thin`, and a page that is gone or blocked returns `failed`. The probe reports the kind the clip would have queued.
const KIND_REFINES = { thin: ['wrong-node'], failed: ['gone', 'blocked'] };
function outcomeOf(status, issues) {
  const kind = issues.at(-1)?.kind;
  return KIND_REFINES[status]?.includes(kind) ? kind : status;
}

// The one line a probe prints. Every field is always present; null where it does not apply.
//   outcome        what a real clip would have returned: clipped, duplicate, declined, blocked, thin, wrong-node, failed,
//                  gone, ocr-unavailable or error
//   extraction     how the text was read: text, rendered, plaintext, plaintext-twin, manual, ocr, table-aware...
//   words          words in the text that would be stored (for an OCR sample, the words of the sampled pages)
//   title          the title the clipping would carry
//   captured       the vault already holds this address (`existing` is the clipping)
//   declined       the address has an active decline (`declineReason` is its reason)
//   wouldDecline   a real clip would record a decline for this outcome
//   wouldQueue     a real clip would add a row to the triage queue
//   ocr            { pagesSampled, pages, words } when OCR ran on a sample; `estimate` is true when the sample is not
//                  the whole document, so the outcome and the word count are projected from it
export function probeReport({ url, result = {}, probe, standing = {} }) {
  const status = result.status ?? 'error';
  const existing = result.path ?? result.file ?? standing.existing ?? null;
  return {
    probe: true,
    url,
    outcome: outcomeOf(status, probe.issues),
    extraction: result.extraction ?? null,
    words: Number.isInteger(result.words) ? result.words : null,
    title: result.title ?? null,
    captured: status === 'duplicate' || Boolean(standing.existing),
    existing: status === 'clipped' ? null : existing,
    declined: status === 'declined' || Boolean(standing.declineReason),
    declineReason: standing.declineReason ?? null,
    reason: result.reason ?? result.error ?? probe.issues.at(-1)?.reason ?? null,
    wouldDecline: probe.declines.length > 0,
    wouldQueue: probe.issues.length > 0,
    ocr: probe.ocr ?? null,
    estimate: probe.estimate === true,
  };
}

// The JSON line on stdout for whatever reads the probe, and one short line on stderr for a person.
export function printProbe(report, { out = console.log, err = console.error } = {}) {
  out(JSON.stringify(report));
  const how = [report.extraction, Number.isInteger(report.words) ? `${report.words} words` : null,
    report.ocr ? `OCR sample ${report.ocr.pagesSampled} of ${report.ocr.pages ?? '?'} pages` : null].filter(Boolean).join(', ');
  err(`probe: ${report.outcome}${how ? ` (${how})` : ''}${report.reason ? ` — ${String(report.reason).split('\n')[0]}` : ''}: ${report.url}; nothing was written`);
}
