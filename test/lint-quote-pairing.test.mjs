import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStyle, quotedSpans } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

// The README ("Content lint") and the wiki-lint skill describe how quotation marks pair and which spans
// are exempt from style flags. These tests pin each documented rule, so the text and the scanner cannot
// drift apart again. A first reader inferred the straight-mark rule from the regex and got it backwards.

const C_OPEN = '“', C_CLOSE = '”';

test('straight marks alternate: they do not nest, so a straight phrase inside a straight quotation is outside both', () => {
  // The marks are read in order: open, close, open, close. "one ... five " is one quote and the middle
  // phrase sits between the two quotes; the second quote is too short to be returned.
  const spans = quotedSpans('He said "one two three four five "six seven eight nine ten" eleven twelve thirteen" then left.');
  assert.deepEqual(spans, ['one two three four five ']);
});

test('a curly quotation nests: a straight or curly phrase inside it stays in the outer quote and is also returned on its own', () => {
  const inner = 'six seven eight nine ten';
  const outer = `one two three four five ${inner} eleven twelve`;
  for (const wrapped of [`${C_OPEN}one two three four five "${inner}" eleven twelve${C_CLOSE}`, `${C_OPEN}one two three four five ${C_OPEN}${inner}${C_CLOSE} eleven twelve${C_CLOSE}`, `"one two three four five ${C_OPEN}${inner}${C_CLOSE} eleven twelve"`]) {
    assert.deepEqual(quotedSpans(`He said ${wrapped} then left.`), [outer, inner], wrapped);
  }
});

test('a closing curly mark with no curly opener is ignored and does not disturb the next quote', () => {
  assert.deepEqual(quotedSpans(`It was fine${C_CLOSE} and then "one two three four five six" was said.`), ['one two three four five six']);
  // Inside an open straight quotation it is ignored too: it neither closes that quotation nor loses it.
  assert.deepEqual(quotedSpans(`He said "one two three${C_CLOSE} four five six" then left.`), ['one two three four five six']);
});

test('a straight mark never pairs across a blank line, a curly quotation may', () => {
  assert.deepEqual(quotedSpans('A 5" pipe is long.\n\nLater "one two three four five six" was said.'), ['one two three four five six']);
  assert.deepEqual(quotedSpans(`He said ${C_OPEN}one two three four five\n\nsix seven eight nine ten${C_CLOSE} then left.`), ['one two three four five\n\nsix seven eight nine ten']);
});

function styleVault(t, bodies) {
  const root = mkdtempSync(join(tmpdir(), 'wm-style-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'wiki/concepts'), { recursive: true });
  writeFileSync(join(root, 'index.md'), '---\ntype: synthesis\n---\n# Index\n');
  for (const [name, body] of Object.entries(bodies)) {
    writeFileSync(join(root, 'wiki/concepts', `${name}.md`), `---\ntype: concept\ncreated: 2026-10-26\nstatus: maintained\nsources: []\nai-generated: true\n---\n# ${name}\n${body}\n`);
  }
  return root;
}
const words = (root) => checkStyle(root, buildGraph(root)).map((f) => `${f.page.split('/').pop()}:${f.word}`).sort();

test('style flags: a pair of marks with no other quotation mark between them is exempt; an outer quotation around a nested one is not', t => {
  const root = styleVault(t, {
    simple: `He said ${C_OPEN}this is clearly it${C_CLOSE} and left.`,
    straight: 'He said "this is clearly it" and left.',
    nested: `He said ${C_OPEN}this is clearly a case where ${C_OPEN}clearly${C_CLOSE} matters${C_CLOSE} and left.`,
    bare: 'This is clearly it.',
  });
  // simple and straight: exempt. nested: the inner pair is exempt, the outer words are not. bare: flagged.
  assert.deepEqual(words(root), ['bare.md:clearly', 'nested.md:clearly']);
});
