import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromDocx, docxClipContent } from '../scripts/clip-docx.mjs';

test('titleFromDocx humanizes the filename, drops .docx/.doc extension', () => {
  assert.equal(titleFromDocx('/a/b/Uses_Artificial_intelligence_in_Math.docx'),
    'Uses Artificial intelligence in Math');
  assert.equal(titleFromDocx('paper.DOCX'), 'paper');
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
