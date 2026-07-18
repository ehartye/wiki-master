import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromPdf, pdfClipContent } from '../scripts/clip-pdf.mjs';

test('titleFromPdf humanizes the filename, drops extension', () => {
  assert.equal(titleFromPdf('/a/b/Abdellatif_MultiState_DOT_Cost_Estimation_ML.pdf'),
    'Abdellatif MultiState DOT Cost Estimation ML');
  assert.equal(titleFromPdf('paper.PDF'), 'paper');
  assert.equal(titleFromPdf('/x/.pdf'), 'untitled');
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
