/** @lane merge */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyQuotes, nearMatches, quotedSpans, quoteFragments } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

// Marks that are not quotation syntax must not open or close a quotation, and an author's edit glued to a word must not
// leave a stub that the verbatim check then fails on:
//   - a measurement (7'6", 4'33") is never a delimiter, and a straight mark after a digit opens nothing, though it still
//     closes an open straight quotation ("in 1999");
//   - a mark inside an inline code span or a fenced code block is code, not a delimiter;
//   - a bracket glued to a word ([E]ach, pi[ne]cones) is an edit of that word and drops the word, like an ellipsis, while
//     a Markdown link or a wikilink inside a quotation is kept and compared as the words a reader sees.

const SIX = 'one two three four five six';

test('measurement marks are not delimiters: feet-inches and minutes-seconds open and close nothing', () => {
  assert.deepEqual(quotedSpans(`He is 7'6" tall and the piece 4'33" is long; later "${SIX}" was said.`), [SIX]);
  assert.deepEqual(quotedSpans(`He is 7’6" tall and 5' 11" wide; later "${SIX}" was said.`), [SIX]);
});

test('a straight mark directly after a digit opens nothing', () => {
  assert.deepEqual(quotedSpans(`A 5" pipe, then "${SIX}".`), [SIX]);
});

test('a straight mark after a digit still closes an open straight quotation', () => {
  assert.deepEqual(quotedSpans('"it happened in the year 1999" and more'), ['it happened in the year 1999']);
});

test('a measurement inside a quotation stays part of it and does not close it', () => {
  assert.deepEqual(quotedSpans(`They wrote "the player is 7'6" tall and very fast" today.`), [`the player is 7'6" tall and very fast`]);
  // A space after the foot mark, and a curly foot mark, are measurements too: the digit rule alone would close here.
  assert.deepEqual(quotedSpans(`They wrote "the player is 5' 11" tall and very fast" today.`), [`the player is 5' 11" tall and very fast`]);
  assert.deepEqual(quotedSpans(`They wrote "the player is 7’6" tall and very fast" today.`), [`the player is 7’6" tall and very fast`]);
});

test('a stray straight mark that is not after a digit still never pairs across a blank line', () => {
  assert.deepEqual(quotedSpans(`A stray " mark here.\n\nLater "${SIX}" was said.`), [SIX]);
});

test('a quotation holding an inline code span is one quotation that keeps the code text', () => {
  const spans = quotedSpans('He wrote "set the value with `x="y"` before the first run" and left.');
  assert.equal(spans.length, 1, JSON.stringify(spans));
  assert.ok(spans[0].includes('`x="y"`'), spans[0]);
  assert.ok(spans[0].startsWith('set the value') && spans[0].endsWith('first run'), spans[0]);
});

test('a code span closes only on a backtick run of the same length, within its paragraph', () => {
  // ``a`b"c`` is one span of two-backtick runs; its single backtick and mark are code.
  assert.deepEqual(quotedSpans(`Use \`\`a\`b"c\`\` then "${SIX}" ends.`), [SIX]);
  // A lone backtick does not pair with one in the next paragraph and hide the quotation between them.
  assert.deepEqual(quotedSpans(`A stray \` here.\n\nLater "${SIX}" was said. \``), [SIX]);
});

test('a fenced code block yields no quotation, and the text after it is still read', () => {
  assert.deepEqual(quotedSpans('Example:\n\n```python\nprint("one two three four five six seven")\n```\n\nDone.'), []);
  assert.deepEqual(quotedSpans('Example:\n\n~~~\nprint("one two three four five six seven")\n~~~\n'), []);
  assert.deepEqual(quotedSpans(`\`\`\`\nx = "a"\n\`\`\`\nThen "${SIX}" was said.`), [SIX]);
});

test('a fence closes on a longer fence of the same character', () => {
  assert.deepEqual(quotedSpans(`\`\`\`\nprint("one two three four five six seven")\n\`\`\`\`\n\nThen "${SIX}" was said.`), [SIX]);
  assert.deepEqual(quotedSpans(`~~~\nprint("one two three four five six seven")\n~~~~~\n\nThen "${SIX}" was said.`), [SIX]);
});

test('a fence indented one to three spaces is a fence', () => {
  // The blank line inside keeps the backtick runs from pairing as an inline code span instead.
  assert.deepEqual(quotedSpans(' ```\n x = 1\n\n print("one two three four five six seven")\n ```\n'), []);
  assert.deepEqual(quotedSpans('   ~~~\n   print("one two three four five six seven")\n   ~~~\n'), []);
});

test('an unclosed fence hides nothing', () => {
  assert.deepEqual(quotedSpans(`\`\`\`python\nNo closing fence follows.\n\nThen "${SIX}" was said.`), [SIX]);
});

test('quoteFragments: a glued bracket removes the word it edits; a link and a wikilink are kept', () => {
  assert.deepEqual(quoteFragments('[E]ach vertex is typically influenced by no more than four joints'),
    ['vertex is typically influenced by no more than four joints']);
  assert.deepEqual(quoteFragments('Find sand, construction paper, pi[ne]cones, and cornflakes from the store'),
    ['Find sand, construction paper,', 'and cornflakes from the store']);
  assert.deepEqual(quoteFragments('it will borrow\\[ing\\] the rest of the frame budget'), ['the rest of the frame budget']);
  assert.deepEqual(quoteFragments('See [the docs](https://example.test/d) for more on this topic today'),
    ['See [the docs](https://example.test/d) for more on this topic today']);
  assert.deepEqual(quoteFragments('the [[Some Page|page]] says this is how it works'), ['the [[Some Page|page]] says this is how it works']);
  // A citation or footnote mark is not an edit: the word before it keeps its letters.
  assert.deepEqual(quoteFragments('the engine streams cells[12] as the player moves'), ['the engine streams cells', 'as the player moves']);
  assert.deepEqual(quoteFragments('the engine streams cells[^1] as the player moves'), ['the engine streams cells', 'as the player moves']);
});

const CLIPPING = [
  'Each vertex is typically influenced by no more than four joints.',
  'Find sand, construction paper, pinecones, and cornflakes.',
  'See the docs for more on this topic today.',
  'Web Audio solves the latency problem in browsers.',
  'An apple a day keeps the doctor away.',
  'So you know, if you are going to build this, plan ahead.',
  'It is that what we envisioned for the product.',
  'The engine renders the large scene at sixty frames each second.',
  'The committee met on Tuesday and approved the annual budget for the program.',
].join(' ');

const QUOTES = {
  each: '"[E]ach vertex is typically influenced by no more than four joints"',
  pinecones: '"Find sand, construction paper, pi[ne]cones, and cornflakes"',
  // Its stub "hen" is not in the clipping, so a split on the bracket alone would leave it unverified.
  when: '"[W]hen each vertex is typically influenced by no more than four joints"',
  eachChanged: '"[E]ach vertex is rarely influenced by no more than four joints"',
  link: '"See [the docs](https://example.test/d) for more on this topic today"',
  wholeWord: '"Web Audio [fixes] the latency problem in browsers"',
  leading: '"[An] apple a day keeps the doctor away"',
  sic: '"So you [sic] if you are going to build this"',
  sicMiddle: '"It is that what [sic] we envisioned for the product"',
  near: '"The engine renders the large scene [quickly] at ninety frames each second"',
  // Unaffected by any rule here: their ids must not move.
  plain: '"The committee met on Friday and approved the annual budget for the program"',
  elided: '"The committee met on Friday ... approved the annual budget"',
};

function vault(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-lint-fp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources']) mkdirSync(join(root, d), { recursive: true });
  const put = (p, text) => writeFileSync(join(root, p), text);
  put('index.md', '---\ntype: synthesis\n---\n# Index\n');
  put('raw/clippings/rig.md', `---\ntitle: "Rig notes"\nsource: "https://example.test/rig"\ncreated: 2026-10-26\ntags: [clippings]\nquality: high\n---\n${CLIPPING}\n`);
  put('wiki/sources/rig-page.md', '---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[rig]]"]\nai-generated: true\n---\n# Rig Page\nA summary of the clipping.\n');
  for (const [name, quote] of Object.entries(QUOTES)) {
    put(`wiki/concepts/${name}.md`, `---\ntype: concept\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[rig-page]]"]\nai-generated: true\n---\n# ${name}\nThe clipping says ${quote} in its notes.\n`);
  }
  return root;
}
const tierOf = (r, name) => r.findings.filter((f) => f.page === `wiki/concepts/${name}.md`).map((f) => f.tier);

test('a glued bracket is an edit of its word: the rest of the quotation verifies', t => {
  const root = vault(t);
  const r = classifyQuotes(root, buildGraph(root));
  assert.deepEqual(tierOf(r, 'each'), []);
  assert.deepEqual(tierOf(r, 'pinecones'), []);
  assert.deepEqual(tierOf(r, 'when'), []);
});

test('a changed word next to a glued bracket is still unverified', t => {
  const root = vault(t);
  assert.deepEqual(tierOf(classifyQuotes(root, buildGraph(root)), 'eachChanged'), ['unverified']);
});

test('a Markdown link inside a quotation is compared as its text, not split into a stub', t => {
  const root = vault(t);
  const tiers = tierOf(classifyQuotes(root, buildGraph(root)), 'link');
  assert.ok(!tiers.includes('unverified'), JSON.stringify(tiers));
});

test('whole-word bracketed insertions and [sic] still verify', t => {
  const root = vault(t);
  const r = classifyQuotes(root, buildGraph(root));
  for (const name of ['wholeWord', 'leading', 'sic', 'sicMiddle']) assert.deepEqual(tierOf(r, name), [], name);
});

test('--near leaves a whole-word bracketed insertion out of the word diff', t => {
  const root = vault(t);
  const g = buildGraph(root);
  const r = classifyQuotes(root, g);
  assert.deepEqual(tierOf(r, 'near'), ['unverified']);
  const listed = nearMatches(root, g, r.findings).listed.filter((n) => n.page === 'wiki/concepts/near.md');
  assert.equal(listed.length, 1, JSON.stringify(listed));
  assert.doesNotMatch(listed[0].diff, /quickly/);
  assert.equal(listed[0].diff, 'the engine renders the large scene at [-ninety-] {+sixty+} frames each second');
});

test('the ids of quotes no rule touches are unchanged', t => {
  const root = vault(t);
  const r = classifyQuotes(root, buildGraph(root));
  const ids = Object.fromEntries(r.findings.filter((f) => ['plain', 'elided'].some((n) => f.page.endsWith(`/${n}.md`))).map((f) => [f.page.split('/').pop(), f.id]));
  assert.deepEqual(ids, { 'plain.md': 'fd9b45959e73', 'elided.md': '4a9c0c720f49' });
});

// Direction-aware straight marks. A straight mark after the start of text, whitespace or ( [ { — – / and before a
// non-space character opens; one after a non-space character and before the end, whitespace or . , ; : ! ? ) ] } — –
// closes; any other mark alternates as before. An opener inside an open straight quotation nests, and a closer closes
// the nearest open straight quotation. Measurement and code marks are out of play before direction is judged.

test('direction: a straight quotation nests straight phrases inside it', () => {
  assert.deepEqual(quotedSpans('"Click "visit site", then "sign up" to finish the order"'),
    ['Click visit site, then sign up to finish the order']);
  const inner = 'six seven eight nine ten';
  assert.deepEqual(quotedSpans(`He said "one two three four five "${inner}" eleven twelve" then left.`),
    [`one two three four five ${inner} eleven twelve`, inner]);
});

test('direction: a closer closes the nearest open straight quotation, and a nested quote ending the outer one still closes both', () => {
  // The inner quotation's closer is followed by the outer one's: ' "1/4"' then ')"'.
  assert.deepEqual(quotedSpans(`He wrote "we call it "one-fourth" and write it "1/4")" in the table cell | next cell "${SIX}" ends.`),
    ['we call it one-fourth and write it 1/4)', SIX]);
});

test('direction: a closer with no open straight quotation opens nothing', () => {
  assert.deepEqual(quotedSpans(`It was fine" and then "${SIX}" was said.`), [SIX]);
});

test('direction: an ambiguous mark (a"b) alternates as before', () => {
  // No quotation is open, so it opens; one is open, so it closes.
  assert.deepEqual(quotedSpans(`The code a"${SIX}"b ends here.`), [SIX]);
  assert.deepEqual(quotedSpans(`He said "${SIX} a"b then left.`), [`${SIX} a`]);
});

test('direction: curly quotations are unaffected', () => {
  const C_OPEN = '“', C_CLOSE = '”';
  // Curly marks pair by glyph, wherever they sit.
  assert.deepEqual(quotedSpans(`He said${C_OPEN}${SIX}${C_CLOSE}then left.`), [SIX]);
  assert.deepEqual(quotedSpans(`He said ${C_OPEN}one two ${C_OPEN}three four five six seven${C_CLOSE} eight${C_CLOSE} then left.`),
    ['one two three four five six seven eight', 'three four five six seven']);
  // A closing curly mark with no curly opener is still ignored, even inside a straight quotation.
  assert.deepEqual(quotedSpans(`He said "one two three ${C_CLOSE} four five six" then left.`), ['one two three  four five six']);
  // A curly quotation still spans a blank line.
  assert.deepEqual(quotedSpans(`He said ${C_OPEN}one two three\n\nfour five six${C_CLOSE} then left.`), ['one two three\n\nfour five six']);
});

test('direction: a measurement or code mark inside a nested straight quotation is out of play before direction is judged', () => {
  // 7'6" is followed by a space, so by position alone it would close the inner quotation.
  assert.deepEqual(quotedSpans(`He wrote "the guide says "the player is 7'6" tall and fast" in its notes" today.`),
    [`the guide says the player is 7'6" tall and fast in its notes`, `the player is 7'6" tall and fast`]);
  // The mark inside the code span is followed by a space, so by position alone it would close the inner quotation.
  assert.deepEqual(quotedSpans('He wrote "the docs say "type `a" b` to start the run" in the guide" today.'),
    ['the docs say type `a" b` to start the run in the guide', 'type `a" b` to start the run']);
});
