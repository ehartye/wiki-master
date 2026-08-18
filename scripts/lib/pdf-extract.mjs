// Choosing HOW to read a PDF's text layer.
//
// pdftotext has two incompatible-by-design reading modes, and the right one
// depends on the document:
//
//  - Reading-order (default) follows the text stream column-by-column. Correct
//    for a two-column paper: each column reads top-to-bottom and hyphenated line
//    breaks are joined, so prose comes out quotable.
//  - Aligned (`-table`) preserves horizontal position, so a row's cells stay on
//    one output line. Correct for a table; it interleaves a two-column paper.
//
// Applying either one globally is wrong for half of all documents. Reading-order
// applied to a TABLE emits it column-block-wise -- the whole key column, then the
// whole value column -- so every row's key is detached from its value and the
// pairing is unrecoverable from the output. The characters are all correct, so
// assessFidelity sees clean prose and stamps `fidelity: high`. That is the one
// failure mode where the extraction is CONFIDENTLY wrong rather than visibly
// degraded, which under guardrail #5 (clippings win) is the worst kind: a page
// can state every cell correctly while pairing the wrong key to the wrong value.
// See ehartye/wiki-master#66.
//
// So the mode is chosen per document, and when the faithful mode is unavailable
// the clipping says so instead of quietly claiming fidelity it does not have.
import { execFileSync } from 'node:child_process';

// A key-column cell: short and standalone. Tuned to admit "5.35", "SSP.01",
// "G, H, P, T" and reject any real sentence.
const KEY_MAX_WORDS = 4;
const KEY_MAX_CHARS = 28;

// Below this many distinct key lines the promotion ratio is noise, not signal.
const MIN_KEY_LINES = 8;

// Measured, not guessed. Promotion ratio over real documents:
//   Tennessee social studies standards (the reported source) .. 0.45 - 0.51
//   "Attention Is All You Need" (two-column, table-rich) ...... 0.24
//   BERT (two-column academic) ................................ 0.26
// 0.35 sits between them with roughly 30% relative headroom on each side.
//
// The errors are deliberately asymmetric. A false NEGATIVE is the bug above:
// silent, confidently-wrong pairings. A false POSITIVE interleaves a prose
// document's columns -- ugly and obviously wrong to any reader, and stamped
// `fidelity: tabular` besides. Bias toward the visible failure.
const TABULAR_PROMOTION = 0.35;

// Pages sampled for detection. Running both modes over a 250-page PDF to decide
// how to read it is wasteful; the first pages track the whole-document score
// closely (measured 0.508 vs 0.481 on the 247-page source PDF).
export const SAMPLE_PAGES = 24;

export function parsePdftotextCapabilities(helpText) {
  const t = String(helpText || '');
  // 'unknown' means the probe told us nothing we recognise -- treat that as
  // absent, not as a capable install we failed to name.
  const flavor = /xpdfreader|Glyph & Cog/i.test(t) ? 'xpdf'
    : /poppler/i.test(t) ? 'poppler'
    : /pdftotext/i.test(t) ? 'unnamed'
    : 'unknown';
  return {
    // Xpdf 4.x only. Poppler has -layout but no -table, and -layout is not an
    // acceptable substitute (see chooseExtraction).
    table: /^\s*-table\b/m.test(t),
    layout: /^\s*-layout\b/m.test(t),
    flavor,
  };
}

// Probe once per process. pdftotext prints usage to stdout (Xpdf) or stderr
// (poppler) and exits non-zero for -h on some builds, so capture both streams
// and ignore the exit code.
let capsCache;
export function pdftotextCapabilities() {
  if (capsCache) return capsCache;
  let out = '';
  for (const flag of ['-h', '-v']) {
    try {
      out += execFileSync('pdftotext', [flag], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '';
    } catch (err) {
      out += `${err.stdout || ''}${err.stderr || ''}`;
    }
  }
  capsCache = parsePdftotextCapabilities(out);
  return capsCache;
}

// Is pdftotext installed at all? Deliberately NOT `pdftotext -v && exit 0`:
// Xpdf's pdftotext exits 99 for -v, so an exit-code check reports 'not installed'
// on every Xpdf box -- which is exactly the install that has the -table mode we
// most want. Presence is decided by whether the probe SAID anything recognisable.
export function pdftotextPresent() {
  return pdftotextCapabilities().flavor !== 'unknown';
}

export function shortKeyLines(text) {
  return String(text).split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((l) => l.length <= KEY_MAX_CHARS && l.split(/\s+/).length <= KEY_MAX_WORDS);
}

// The detector. The discriminating signal is RELATIONAL, not statistical: a
// short standalone line in reading-order mode that becomes the LEADING token of
// a longer line in aligned mode is a key cell being re-attached to its value.
// Line-length statistics do not separate the two cases (measured: short-line
// fraction 0.30 for a table vs 0.25 for a paper).
export function tabularity(defaultText, alignedText) {
  const keys = [...new Set(shortKeyLines(defaultText))];
  const aligned = String(alignedText).split('\n').map((s) => s.trim()).filter(Boolean);
  if (keys.length < MIN_KEY_LINES) {
    return { sampled: false, tabular: false, keys: keys.length, promoted: 0, promoFrac: 0 };
  }
  const promoted = keys.filter((k) =>
    aligned.some((l) => l.startsWith(k) && l.length > k.length + 3)).length;
  const promoFrac = promoted / keys.length;
  return {
    sampled: true,
    tabular: promoFrac >= TABULAR_PROMOTION,
    keys: keys.length,
    promoted,
    promoFrac: Number(promoFrac.toFixed(3)),
  };
}

// Decide the extraction mode, and what the resulting clipping is allowed to
// claim about itself.
//
//  - prose            -> reading-order, no stamps (today's behaviour, unchanged)
//  - table + -table   -> aligned mode, `extraction: table-aware`, `fidelity: tabular`
//  - table, no -table -> reading-order, `fidelity: degraded` + a loud warning
//
// `fidelity: tabular` is not a lesser `high`: it means the rows were RECONSTRUCTED
// from horizontal position rather than read off a structured source, so a reader
// should confirm a pairing before quoting it as verbatim. Recovered rows were
// verified against an independent pdfplumber cell-geometry extraction of the
// reported source document and matched on every spot-checked standard.
//
// -layout is deliberately NOT used when -table is missing. On the real source PDF
// it stacks consecutive keys into a column while their values drift, so 5.36
// visually pairs with the tail of 5.35's text. That reads as fixed and is not --
// the same confidently-wrong failure this whole module exists to prevent.
export function chooseExtraction({ tabular, canTable }) {
  if (!tabular) return { args: [] };
  if (canTable) return { args: ['-table'], extraction: 'table-aware', fidelityFloor: 'tabular' };
  return {
    args: [],
    extraction: 'table-flattened',
    fidelityFloor: 'degraded',
    warning:
      'tabular layout detected, but this pdftotext has no -table mode, so every row\'s '
      + 'key column is detached from its value and the pairings are LOST. Marked '
      + 'fidelity: degraded -- do not trust row pairings in this clipping. Install the '
      + 'Xpdf command-line tools (which provide -table) and re-clip: '
      + 'https://www.xpdfreader.com/download.html',
  };
}
