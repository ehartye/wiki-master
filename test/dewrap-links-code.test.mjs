import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWrappedLinks, dewrapText, dewrapWhitespace } from '../scripts/lib/dewrap-links.mjs';
import { repairWrappedLinks } from '../scripts/repair-wrapped-links.mjs';

// A `[[` named inside a code span is not a link opener. The detector used to read it as one and match
// to the next `]]` however far away, so a page that mentioned "`[[`" in a checklist had a thousand
// characters of paragraphs, headings and list items "repaired" into one line. On a CRLF page the
// collapse also left the carriage returns behind (`\r \r`), which is the damage that made health
// misread the page's structure.

const none = { resolves: () => false };

// The shape of the real page: a code span with `[[`, then paragraphs, a heading and list items, then a
// real link much later.
const PAGE = [
  '- **Article invariants** - no editorial residue (`%%`, `[[`) survives the port; inline marks balanced.',
  '',
  'The graph today: **176 stars** across eight areas.',
  '',
  '## Known limits',
  '',
  '- **No tests.** A human will catch it or not at all.',
  '- **Voiced by CI** while Pages keeps deploying ([[retire-github-pages]]).',
  '',
].join('\n');

test('a [[ inside an inline code span is not the start of a wrapped link', () => {
  assert.deepEqual(findWrappedLinks(PAGE, none), []);
  const r = dewrapText(PAGE, none);
  assert.equal(r.fixed, 0);
  assert.equal(r.text, PAGE, 'the page is returned byte-identical');
});

test('a [[ inside a fenced code block is not a link either', () => {
  const text = 'Example:\n\n```\n[[a\nb]]\n```\n\nDone.\n';
  assert.deepEqual(findWrappedLinks(text, none), []);
  assert.equal(dewrapText(text, none).text, text);
});

test('a stray opener followed by a paragraph break is not one link, even outside code', () => {
  const text = 'An unclosed [[ opener here.\n\nA second paragraph that ends with a link to [[Real]].\n';
  assert.deepEqual(findWrappedLinks(text, none), []);
});

test('a stray closer after a paragraph break does not make the opener a link', () => {
  // No second opener between them, so only the blank-line rule stops this from being one 40-character "link".
  const text = 'An unclosed [[ opener.\n\nLater text with a stray closer ]] here.\n';
  assert.deepEqual(findWrappedLinks(text, none), []);
  assert.equal(dewrapText(text, none).text, text);
});

test('a stray opener in the same paragraph does not swallow the real wrapped link after it', () => {
  // No code span and no blank line, so only the nested-opener rule keeps the span to the real link.
  const text = 'A stray [[ opener, then like [[Tooling API\nGuide]] wraps.\n';
  const found = findWrappedLinks(text, none);
  assert.equal(found.length, 1);
  assert.equal(found[0].raw, 'Tooling API\nGuide');
  assert.equal(dewrapText(text, none).text, 'A stray [[ opener, then like [[Tooling API Guide]] wraps.\n');
});

test('a real wrapped link after a stray opener is still found, by its own opener', () => {
  const text = 'Notation: `[[` opens a link. Like [[Tooling API Reference and\nDeveloper Guide]], it helps.\n';
  const found = findWrappedLinks(text, none);
  assert.equal(found.length, 1);
  assert.equal(found[0].raw, 'Tooling API Reference and\nDeveloper Guide');
  assert.equal(dewrapText(text, none).text, 'Notation: `[[` opens a link. Like [[Tooling API Reference and Developer Guide]], it helps.\n');
});

test('on a CRLF page a genuine repair leaves no carriage return inside the link', () => {
  assert.equal(dewrapWhitespace('Tooling API\r\n  Guide'), 'Tooling API Guide');
  const text = 'Like [[Tooling API\r\nGuide]], its value.\r\n';
  const r = dewrapText(text, none);
  assert.equal(r.fixed, 1);
  assert.equal(r.text, 'Like [[Tooling API Guide]], its value.\r\n');
});

test('the repair script leaves the real-shaped page untouched on disk, apply or not', t => {
  const v = mkdtempSync(join(tmpdir(), 'wm-dewrap-code-'));
  t.after(() => rmSync(v, { recursive: true, force: true }));
  mkdirSync(join(v, 'wiki', 'concepts'), { recursive: true });
  const body = `---\ntype: concept\nsources: []\n---\n${PAGE}`;
  writeFileSync(join(v, 'wiki/concepts/checklist.md'), body);
  writeFileSync(join(v, 'wiki/concepts/retire-github-pages.md'), '---\ntype: concept\nsources: []\n---\n# Retire\n');
  for (const apply of [false, true]) {
    const r = repairWrappedLinks(v, { apply });
    assert.equal(r.fixed, 0, `apply=${apply}`);
    assert.equal(readFileSync(join(v, 'wiki/concepts/checklist.md'), 'utf8'), body);
  }
});
