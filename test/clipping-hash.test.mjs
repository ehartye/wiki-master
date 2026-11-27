import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLineEndings, clipperText, clippingHash, verifyClippingHash, CLIPPING_HASH_STATUSES, EQUIVALENT_HASH_STATUSES } from '../scripts/lib/clipping-hash.mjs';
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
    assert.equal(verifyClippingHash(out.body, out.hash), 'match', 'what a writer stores verifies as a match');
  });
}

test('the plain-text URL route stores LF for lone CR and CRLF input', () => {
  const page = plainTextPage('https://example.test/files/notes.txt', 'one\rtwo\r\nthree\r');
  assert.ok(!page.contentMarkdown.includes('\r'), JSON.stringify(page.contentMarkdown));
  assert.match(page.contentMarkdown, /one\ntwo\nthree/);
});

// ---------------------------------------------------------------- verifyClippingHash
// The rule before line endings were normalized: strip the framing and hash what is left, carriage returns included.
// A recorded hash may have been made by it, so the predicate recognises the text it was made over.
const oldRuleText = (fileText) => {
  const m = fileText.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = m ? fileText.slice(m[0].length) : fileText;
  return body.replace(/^\r?\n/, '').replace(/\n$/, '');
};
const MD = '# Heading\n\nA paragraph.\n\n```\ncode();\n```';
const frame = (md, hash = 'HASH') => `---\ntitle: "T"\nsource-hash: ${hash}\n---\n\n${md}\n`;

test('the statuses: two matches, two equivalents and a mismatch, in that order', () => {
  assert.deepEqual(CLIPPING_HASH_STATUSES, ['match', 'match-raw', 'crlf-variant', 'trailing-newline', 'mismatch']);
  assert.deepEqual(EQUIVALENT_HASH_STATUSES, ['crlf-variant', 'trailing-newline']);
});

test('match: the hash of the LF-normalized body, whatever line endings the file has now', () => {
  const file = frame(MD);
  assert.equal(verifyClippingHash(file, sha(MD)), 'match');
  assert.equal(verifyClippingHash(crlf(file), sha(MD)), 'match', 'a CRLF checkout of an LF-hashed clipping');
  assert.equal(verifyClippingHash(file, sha(MD).toUpperCase()), 'match', 'the recorded hash is compared without regard to case');
  assert.equal(verifyClippingHash(file, ` ${sha(MD)} `), 'match', 'and without surrounding space');
});

test('match-raw: a body that still has its carriage returns, hashed by the old rule', () => {
  const allCrlf = crlf(frame(MD));
  assert.notEqual(oldRuleText(allCrlf), MD, 'the old rule kept the CRs');
  assert.equal(verifyClippingHash(allCrlf, sha(oldRuleText(allCrlf))), 'match-raw');
  const loneCrs = frame('one\rtwo\r\nthree');
  assert.equal(verifyClippingHash(loneCrs, sha('one\rtwo\r\nthree')), 'match-raw', 'lone CRs and CRLF in an LF frame');
});

test('crlf-variant: the file is LF now, and its hash was recorded by the old rule over the same text with CRLF', () => {
  const file = frame(MD);
  // A writer that framed with LF and kept the source's CRLF inside the body.
  assert.equal(verifyClippingHash(file, sha(crlf(MD))), 'crlf-variant', 'the body as CRLF');
  // A file that was CRLF throughout: the old rule left the final CR of the closing line break in the text.
  assert.equal(verifyClippingHash(file, sha(oldRuleText(crlf(file)))), 'crlf-variant', 'the whole file as CRLF');
  assert.equal(sha(oldRuleText(crlf(file))), sha(`${crlf(MD)}\r`));
});

test('trailing-newline: the same text with one more line break at the end, under either rule', () => {
  assert.equal(verifyClippingHash(frame(MD), sha(`${MD}\n`)), 'trailing-newline', 'the normalized body plus a line feed');
  const crBody = 'one\r\ntwo';
  assert.equal(verifyClippingHash(frame(crBody), sha(`${crBody}\n`)), 'trailing-newline', 'the raw body plus a line feed');
});

test('mismatch: other text, a line ending variant of other text, two extra line breaks, a short or empty-looking hash', () => {
  const file = frame(MD);
  assert.equal(verifyClippingHash(file, sha('Other text')), 'mismatch');
  assert.equal(verifyClippingHash(file, sha(crlf('Other text'))), 'mismatch');
  assert.equal(verifyClippingHash(file, sha(`${MD}\n\n`)), 'mismatch', 'two more line breaks are not one');
  assert.equal(verifyClippingHash(file, sha(MD).slice(0, 7)), 'mismatch', 'a prefix of the hash is not the hash');
  // A mixed-ending body (CRLF inside an LF code fence) is not a variant the predicate tries.
  const mixed = MD.replace('code();', 'code();\r\nmore();');
  assert.equal(verifyClippingHash(frame(MD.replace('code();', 'code();\nmore();')), sha(mixed)), 'mismatch');
});

test('a missing recorded hash is a caller error, not a status', () => {
  for (const recorded of [undefined, null, '', '   ', 42]) assert.throws(() => verifyClippingHash(frame(MD), recorded), TypeError, String(recorded));
});

// Every clipping fixture under test/fixtures that records a full SHA-256 verifies as a match. The purge fixtures
// carry short placeholder tags (aaa1111), which are no hash of anything: they are listed so a new one is seen.
test('every clipping fixture that records a full hash still verifies as a match; the rest are named placeholders', () => {
  const root = fileURLToPath(new URL('./fixtures/', import.meta.url));
  const found = [];
  (function walk(dir, rel) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name), r = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else if (name.endsWith('.md') && /(^|\/)raw\/clippings\//.test(r)) found.push([r, readFileSync(abs, 'utf8')]);
    }
  })(root, '');
  const placeholders = [];
  for (const [path, text] of found) {
    const recorded = text.match(/^source-hash:\s*"?([0-9a-fA-F]+)"?\s*$/m)?.[1];
    if (!recorded) continue;
    if (recorded.length === 64) assert.equal(verifyClippingHash(text, recorded), 'match', path);
    else placeholders.push(path);
  }
  assert.deepEqual(placeholders.sort(), ['purge-vault/raw/clippings/Only-aaa1111.md', 'purge-vault/raw/clippings/Shared-bbb2222.md']);
});
