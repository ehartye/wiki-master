import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeLineEndings, clipperText, clippingHash } from '../scripts/lib/clipping-hash.mjs';
import { pdfClipContent } from '../scripts/clip-pdf.mjs';
import { docxClipContent } from '../scripts/clip-docx.mjs';
import { pptxClipContent } from '../scripts/clip-pptx.mjs';
import { xlsxClipContent } from '../scripts/clip-xlsx.mjs';
import { confluenceClipContent } from '../scripts/clip-confluence.mjs';
import { fileClipContent } from '../scripts/clip-gh.mjs';
import { plainTextPage } from '../scripts/lib/plain-text.mjs';

// A clipping's source-hash is the SHA-256 of its body with the line endings made LF. A vault's Git attributes (`text=auto
// eol=lf`) rewrite line endings on commit and checkout, so only a hash that ignores them survives. Every writer stores LF.

const sha = (s) => createHash('sha256').update(s).digest('hex');
const crlf = (s) => s.replace(/\n/g, '\r\n');
const loneCr = (s) => s.replace(/\n/g, '\r');
const stored = (md) => `---\ntitle: "T"\nsource-hash: ${sha(md)}\n---\n\n${md}\n`;

test('normalizeLineEndings turns CRLF and a lone CR into LF, and leaves LF alone', () => {
  assert.equal(normalizeLineEndings('a\r\nb'), 'a\nb');
  assert.equal(normalizeLineEndings('a\rb'), 'a\nb');
  assert.equal(normalizeLineEndings('a\r\r\nb'), 'a\n\nb', 'a doubled CR before LF is two line breaks');
  assert.equal(normalizeLineEndings('a\n\rb\r'), 'a\n\nb\n');
  assert.equal(normalizeLineEndings('a\nb\n'), 'a\nb\n');
  assert.equal(normalizeLineEndings(''), '');
});

test('a clipping hashes the same with LF, CRLF or lone-CR line endings, and that hash is the recorded one', () => {
  const md = '# Heading\n\nA paragraph.\n\n```\ncode();\n```';
  const file = stored(md);
  const recorded = file.match(/^source-hash: (.*)$/m)[1];
  assert.equal(clippingHash(file), recorded);
  assert.equal(clippingHash(crlf(file)), recorded, 'the file converted to CRLF, frontmatter included');
  assert.equal(clippingHash(loneCr(file)), recorded, 'the file with lone carriage returns');
  assert.equal(clipperText(crlf(file)), md);
  assert.equal(clipperText(loneCr(file)), md);
});

test('the helper strips the one blank line and the one line break the writer frames the body with, and nothing more', () => {
  const frame = (md) => `---\ntitle: "T"\n---\n\n${md}\n`;
  assert.equal(clipperText(frame('Plain')), 'Plain');
  assert.equal(clipperText(frame('Two\n')), 'Two\n', 'a line break that belongs to the Markdown stays');
  assert.equal(clipperText(frame('Trailing space ')), 'Trailing space ');
  assert.equal(clipperText(frame('Ends with a return\r')), 'Ends with a return', 'a final CR is half of a CRLF line break, not text');
  assert.equal(clipperText('no frontmatter\n'), 'no frontmatter');
});

// Each clipper's pure content step: given text with lone CRs and CRLFs, the stored body has no CR and the hash is what is stored.
const WRITERS = [
  ['clip-pdf', (text) => pdfClipContent({ title: 'T', source: 's', text, created: '2026-11-27' })],
  ['clip-docx', (text) => docxClipContent({ title: 'T', source: 's', text, created: '2026-11-27' })],
  ['clip-pptx', (text) => pptxClipContent({ title: 'T', source: 's', text, created: '2026-11-27' })],
  ['clip-xlsx', (text) => xlsxClipContent({ title: 'T', source: 's', text, created: '2026-11-27' })],
  ['clip-confluence', (body) => confluenceClipContent({ title: 'T', source: 's', body, created: '2026-11-27' })],
  ['clip-gh (a Markdown file)', (content) => fileClipContent({ owner: 'o', repo: 'r', ref: 'main', relPath: 'docs/a.md', content, created: '2026-11-27' })],
  ['clip-gh (a code file)', (content) => fileClipContent({ owner: 'o', repo: 'r', ref: 'main', relPath: 'src/a.js', content, created: '2026-11-27' })],
];
for (const [name, write] of WRITERS) {
  test(`${name} stores LF for lone CR and CRLF input, and records the hash of what it stores`, () => {
    const out = write('First line\rsecond line\r\n\r\nThird paragraph\r');
    assert.ok(!out.md.includes('\r'), JSON.stringify(out.md));
    assert.ok(!out.body.includes('\r'), 'no carriage return in the file');
    assert.match(out.md, /First line\nsecond line\n\nThird paragraph/);
    assert.equal(clippingHash(out.body), out.hash);
  });
}

test('the plain-text URL route stores LF for lone CR and CRLF input', () => {
  const page = plainTextPage('https://example.test/files/notes.txt', 'one\rtwo\r\nthree\r');
  assert.ok(!page.contentMarkdown.includes('\r'), JSON.stringify(page.contentMarkdown));
  assert.match(page.contentMarkdown, /one\ntwo\nthree/);
});
