import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromPdf, pdfClipContent, stripRunningHeadersFooters, assessFidelity } from '../scripts/clip-pdf.mjs';

test('titleFromPdf humanizes the filename, drops extension', () => {
  assert.equal(titleFromPdf('/a/b/Abdellatif_MultiState_DOT_Cost_Estimation_ML.pdf'),
    'Abdellatif MultiState DOT Cost Estimation ML');
  assert.equal(titleFromPdf('paper.PDF'), 'paper');
  assert.equal(titleFromPdf('/x/.pdf'), 'untitled');
});

test('stripRunningHeadersFooters drops the repeated title header and page-number footer', () => {
  // Four pages (form-feed separated), each wrapped in a running header + a
  // "5-6N" page-number footer — the exact chrome that got stitched into a quote.
  const text = [1, 2, 3, 4].map((n) => `Sphere Tracing\nBody of page ${n} sentence one.\nSentence two.\n5-${69 + n}`).join('\f');
  const out = stripRunningHeadersFooters(text);
  assert.ok(!out.includes('Sphere Tracing'), 'running header removed');
  assert.ok(!/5-7\d/.test(out), 'running page-number footer removed');
  assert.ok(out.includes('Body of page 3 sentence one.'), 'body prose preserved');
  // Too few pages to detect reliably → left intact (just form-feeds → newlines).
  assert.ok(stripRunningHeadersFooters('H\na\nF\fH\nb\nF').includes('H'));
});

test('assessFidelity flags math-mangled extractions, not clean prose', () => {
  assert.equal(assessFidelity('x2 ? 1 y2 ? 1 a2 ? 1 b2 ? 1 c2 ? 1 d2 ? 1 e2 ? 1 f2 ? 1 g2 ? 1').degraded, true);
  assert.equal(assessFidelity('(cid:12)(cid:13)(cid:14)(cid:15)(cid:16)(cid:17) glyph dump').degraded, true);
  assert.equal(assessFidelity('This is clean flowing academic prose with no mangled symbols at all.').degraded, false);
});

test('assessFidelity flags broken-font gibberish (mojibake), not long clean prose', () => {
  // Symbol/number-dominated mojibake, >200 non-space chars, ~no letters — the
  // failure mode that trips none of the math/cid/replacement checks.
  const gibberish = "345689 9 9 #$%&*+,+3 -./012 32.1145 ".repeat(12);
  const g = assessFidelity(gibberish);
  assert.equal(g.gibberish, true);
  assert.equal(g.degraded, true);
  // Long clean prose (well over the length gate) stays clean.
  const prose = 'The study examines how young learners build understanding through hands on classroom activities. '.repeat(4);
  assert.equal(assessFidelity(prose).degraded, false);
  // Short snippets never trip the gibberish gate regardless of composition.
  assert.equal(assessFidelity('12 34 #$%').gibberish, false);
});

test('pdfClipContent exposes the content hash (for slug disambiguation)', () => {
  const { hash } = pdfClipContent({ title: 'T', source: 's', text: 'Some real words here for hashing purposes.' });
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('pdfClipContent records fidelity: degraded in frontmatter when math is mangled', () => {
  const mangled = 'The sphere x2 ? 1 = 0 and y2 ? 1 and z2 ? 1 and a2 ? 1 and b2 ? 1 and c2 ? 1 and d2 ? 1 and e2 ? 1.';
  const { body, fidelity } = pdfClipContent({ title: 'T', source: 's', text: mangled });
  assert.equal(fidelity, 'degraded');
  assert.match(body, /fidelity: degraded/);
  // Clean prose omits the field (fidelity high is the default, not written).
  const clean = pdfClipContent({ title: 'T', source: 's', text: 'Clean prose, several plain words, nothing mangled here whatsoever.' });
  assert.equal(clean.fidelity, 'high');
  assert.doesNotMatch(clean.body, /fidelity:/);
});

test('pdfClipContent records extraction: ocr in frontmatter when OCR was used', () => {
  const clean = 'Béthune and colleagues present a clean, several-word prose paragraph here.';
  const ocr = pdfClipContent({ title: 'T', source: 's', text: clean, extraction: 'ocr' });
  assert.match(ocr.body, /extraction: ocr/);
  assert.equal(ocr.extraction, 'ocr');
  // Default text-layer extraction omits the field.
  const txt = pdfClipContent({ title: 'T', source: 's', text: clean });
  assert.doesNotMatch(txt.body, /extraction:/);
});

test('pdfClipContent stores extracted text as the markdown note, with provenance frontmatter', () => {
  const text = 'Abstract\r\n\r\n\r\nThis paper studies bidding.\n\n\n\nSection 1.';
  const { md, body, wordCount } = pdfClipContent({
    title: 'Sample Paper', source: 'raw/Sample.pdf', text, quality: 'high', created: '2026-07-18',
  });
  // CRLF normalized, 3+ blank lines collapsed, trimmed.
  assert.equal(md, 'Abstract\n\nThis paper studies bidding.\n\nSection 1.');
  assert.ok(wordCount >= 7);
  assert.match(body, /^---\n/);
  assert.match(body, /title: "Sample Paper"/);
  assert.match(body, /source: "raw\/Sample\.pdf"/);
  assert.match(body, /tags: \[clippings\]/);
  assert.match(body, /quality: high/);
  assert.match(body, /source-hash: [0-9a-f]{64}/);
  assert.ok(body.trimEnd().endsWith('Section 1.'));
});
