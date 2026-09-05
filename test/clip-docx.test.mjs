import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromDocx, docxClipContent, shouldDeclineAsThin, parseAllowShort, overridesDecline, THIN_DECLINE_REASON } from '../scripts/clip-docx.mjs';

test('titleFromDocx humanizes the filename, drops .docx/.doc extension', () => {
  assert.equal(titleFromDocx('/a/b/Uses_Artificial_intelligence_in_Math.docx'),
    'Uses Artificial intelligence in Math');
  assert.equal(titleFromDocx('paper.DOCX'), 'paper');
  // Windows-style path on any platform — the case that caught titleFromXlsx.
  assert.equal(titleFromDocx('C:\\x\\Cost_Report_2025.docx'), 'Cost Report 2025');
  assert.equal(titleFromDocx('/x/legacy.doc'), 'legacy');
  assert.equal(titleFromDocx('/x/.docx'), 'untitled');
});

test('docxClipContent stores extracted text as the markdown note, with provenance frontmatter', () => {
  const text = 'Abstract\r\n\r\n\r\nThis paper studies AI in math education.\n\n\n\nSection 1.';
  const { md, body, wordCount } = docxClipContent({
    title: 'Sample Paper', source: 'https://example.edu/1', text, quality: 'high', created: '2026-07-18',
  });
  // CRLF normalized, 3+ blank lines collapsed, trimmed.
  assert.equal(md, 'Abstract\n\nThis paper studies AI in math education.\n\nSection 1.');
  assert.ok(wordCount >= 7);
  assert.match(body, /^---\n/);
  assert.match(body, /title: "Sample Paper"/);
  assert.match(body, /source: "https:\/\/example\.edu\/1"/);
  assert.match(body, /tags: \[clippings\]/);
  assert.match(body, /quality: high/);
  assert.match(body, /source-hash: [0-9a-f]{64}/);
  assert.ok(body.trimEnd().endsWith('Section 1.'));
});

test('docxClipContent omits fidelity/extraction fields — pandoc yields clean text', () => {
  // Unlike pdftotext, pandoc reads the docx XML directly, so there is no math-font
  // mangling to flag: the fidelity/extraction frontmatter fields are never emitted.
  const { body } = docxClipContent({ title: 'T', source: 's', text: 'Clean prose, several plain words here.' });
  assert.doesNotMatch(body, /fidelity:/);
  assert.doesNotMatch(body, /extraction:/);
});

test('docxClipContent exposes the content hash (for slug disambiguation)', () => {
  const { hash } = docxClipContent({ title: 'T', source: 's', text: 'Some real words here for hashing purposes.' });
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('shouldDeclineAsThin declines a near-empty extraction', () => {
  // The floor's real job: pandoc produced almost nothing, which usually means a
  // corrupt, image-only, or password-protected document.
  assert.equal(shouldDeclineAsThin(0), true);
  assert.equal(shouldDeclineAsThin(12), true);
  assert.equal(shouldDeclineAsThin(99), true);
});

test('shouldDeclineAsThin passes anything at or above the floor', () => {
  assert.equal(shouldDeclineAsThin(100), false);
  assert.equal(shouldDeclineAsThin(5000), false);
});

test('allowShort overrides the floor for genuinely short documents', () => {
  // A one-page classroom handout — a bare list of case names, a blank analysis
  // form — is complete at 40 words. Word count cannot tell it apart from an
  // empty extraction, so the override is a human asserting they looked.
  assert.equal(shouldDeclineAsThin(40, { allowShort: true }), false);
  assert.equal(shouldDeclineAsThin(0, { allowShort: true }), false);
});

test('allowShort is off by default — the safety net stays on unless asked for', () => {
  assert.equal(shouldDeclineAsThin(40, {}), true);
  assert.equal(shouldDeclineAsThin(40, { allowShort: false }), true);
});

test('parseAllowShort reads the flag off argv', () => {
  assert.equal(parseAllowShort(['f.docx', '--allow-short']), true);
  assert.equal(parseAllowShort(['f.docx', '--quality=high']), false);
  assert.equal(parseAllowShort([]), false);
});

test('allowShort overrides a prior automated thin decline', () => {
  // You only learn a document needs --allow-short AFTER a first pass declines it,
  // so the flag is useless if the recorded decline short-circuits ahead of it.
  const entry = { reason: THIN_DECLINE_REASON, date: '2026-09-01' };
  assert.equal(overridesDecline(entry, { allowShort: true }), true);
});

test('allowShort does NOT override a deliberate --decline', () => {
  // A human declining a source by hand outranks the flag; --allow-short speaks
  // only to "word count refused this", never to "I decided not to keep it".
  const manual = { reason: 'paywalled, not worth chasing', date: '2026-09-01' };
  assert.equal(overridesDecline(manual, { allowShort: true }), false);
});

test('overridesDecline is inert without the flag, or with no decline', () => {
  assert.equal(overridesDecline({ reason: THIN_DECLINE_REASON }, {}), false);
  assert.equal(overridesDecline(null, { allowShort: true }), false);
  assert.equal(overridesDecline(undefined, { allowShort: true }), false);
});
