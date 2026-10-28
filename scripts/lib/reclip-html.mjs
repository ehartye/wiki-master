import { createHash } from 'node:crypto';
import { runDefuddleJson, renderAttempt, stripArchiveChrome, looksLikePdfUrl, THIN_WORD_FLOOR } from '../clip.mjs';
import { tokenize } from './quote-match.mjs';
import { classifyInterstitial } from './interstitial.mjs';

// HTML pages in the re-clip transaction (lib/reclip.mjs). A PDF is fixed; a page is not, so a replacement is only
// made when the new text still holds nearly all of the old, and the reading of the page is the clipper's own ladder
// (static read, then a browser render when the text is thin) without its side effects: no decline, no triage row.

const words = (text) => (String(text).match(/\S+/g) || []).length;

// Which route a clipping takes. A page clipped by clip.mjs has an http(s) source that does not look like a PDF and
// no extraction mark (or `rendered`); the PDF clippers mark theirs (`ocr`, `table-aware`, `table-flattened`, a
// `tabular` or `degraded` grade) and a local file is not a page. An explicit kind wins.
export function clippingKind(text, kind = 'auto') {
  if (kind === 'html' || kind === 'pdf') return kind;
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const field = (key) => {
    const value = new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)`, 'm').exec(header)?.[1]?.trim() ?? '';
    try { return JSON.parse(value); } catch { return value.replace(/^'|'$/g, ''); }
  };
  const source = field('source');
  if (!/^https?:\/\//i.test(source) || looksLikePdfUrl(source)) return 'pdf';
  if (['ocr', 'table-aware', 'table-flattened'].includes(field('extraction'))) return 'pdf';
  if (['tabular', 'degraded', 'ocr'].includes(field('fidelity'))) return 'pdf';
  return 'html';
}

// The words that make a quote findable are the same ones the lint matches against, so "retained" is measured the
// way a quote is: windows of this many consecutive words, case and markup removed.
const WINDOW = 8;
// The share of the old text a replacement must still hold. A repair adds what an older extractor dropped, so the old
// text should survive almost whole; a page the owner rewrote since the clip should not silently replace the evidence
// that summaries quote.
// Measured on 42 real pages of one vault (clippings 2 days to 3 months old, each read again through this ladder, the
// share of the stored text the new read still holds): 37 held at least 0.9 (most exactly 1), two held 0.88 and 0.89,
// and three held 0.65, 0.72 and 0.74, which were a discussion thread that had grown by half and two news pages edited
// since they were clipped. The gap between 0.74 and 0.88 is where this sits. Ten more reads failed for want of a
// browser and are failed repairs, not shares.
export const MIN_RETAINED = 0.8;

export function retainedShare(oldText, newText) {
  const before = tokenize(oldText);
  if (before.length < WINDOW) return 1;
  const after = tokenize(newText);
  const have = new Set();
  for (let i = 0; i + WINDOW <= after.length; i++) have.add(after.slice(i, i + WINDOW).join(' '));
  let kept = 0, total = 0;
  for (let i = 0; i + WINDOW <= before.length; i++) { total++; if (have.has(before.slice(i, i + WINDOW).join(' '))) kept++; }
  return kept / total;
}

// Reads a page as clip.mjs would and returns what the transaction needs: the body, its hash, the grade and the
// extraction mark (`rendered` when a browser had to build the page; absent for the static read, as the clipper
// writes it). Throws when the page cannot be read, so a failure is a failed repair and never a thin clipping.
export async function readPageForReclip(url, { extract = runDefuddleJson, render = renderAttempt, thinFloor = THIN_WORD_FLOOR } = {}) {
  if (looksLikePdfUrl(url)) throw new Error('this address serves a PDF; re-clip it through the PDF route (--kind pdf)');
  let data;
  let extraction;
  try { data = await extract(url); }
  catch (error) {
    const rendered = render(url);
    if (!rendered.ok) throw new Error(rendered.reason ?? String(error.message ?? error));
    data = rendered.data;
    extraction = 'rendered';
  }
  let md = stripArchiveChrome(data.contentMarkdown || data.content || '');
  if (words(md) < thinFloor && extraction !== 'rendered') {
    const rendered = render(url);
    const text = rendered.ok ? stripArchiveChrome(rendered.data.contentMarkdown || rendered.data.content || '') : '';
    if (words(text) >= thinFloor) { data = rendered.data; md = text; extraction = 'rendered'; }
    else if (rendered.unavailable) throw new Error(`the page reads as thin (${words(md)} words) and the browser render is unavailable: ${rendered.reason}`);
  }
  if (words(md) < thinFloor) throw new Error(`the page reads as thin (${words(md)} words), also after a browser render`);
  // A page that now serves a login or age gate must not replace the evidence it used to be.
  const shell = classifyInterstitial({ markdown: md, title: data.title });
  if (shell) throw new Error(shell.reason);
  const warnings = data.fidelityWarnings ?? [];
  return {
    md, wordCount: words(md), hash: createHash('sha256').update(md).digest('hex'),
    fidelity: warnings.length ? 'partial' : 'high', extraction,
    fidelityChecks: data.fidelityAssessment?.checked, fidelityIgnored: data.fidelityAssessment?.ignored?.length,
    warning: warnings.length ? `possible selective extraction loss: ${warnings.map((w) => `${w.kind}: ${w.label}`).join('; ').slice(0, 500)}` : undefined,
  };
}
