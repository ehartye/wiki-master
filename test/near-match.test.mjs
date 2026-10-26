import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensMatch, alignWords, renderDiff, bestWindow, NEAR_THRESHOLD } from '../scripts/lib/near-match.mjs';
import { prepareDocument, tokenize } from '../scripts/lib/quote-match.mjs';

// The unverified tier mixes the page's own wording with a genuine quotation that has been altered, and
// nothing separates them. This aligns a quote with the best stretch of an evidence document, word by word,
// and shows the difference. Tokens are the lint's own (lower-case words), so the diff reads in lower case.

const GROCHOLA_QUOTE = 'not know what the sim did';
const GROCHOLA_SOURCE = 'one may not really knowing what the simulation did at that point';

test('tokensMatch: equal words, or one a prefix of the other when the shorter has three letters or more', () => {
  assert.ok(tokensMatch('know', 'knowing'));
  assert.ok(tokensMatch('sim', 'simulation'));
  assert.ok(tokensMatch('did', 'did'));
  assert.ok(!tokensMatch('at', 'attack'), 'two letters is too short to be a stem');
  assert.ok(!tokensMatch('explains', 'explaining'), 'a shared stem that is not a prefix is a different word');
});

test('tokensMatch never lets a negation or symbol stand for another word', () => {
  assert.ok(!tokensMatch('not', 'nothing'));
  assert.ok(!tokensMatch('not', 'note'));
  assert.ok(!tokensMatch('no', 'none'));
  assert.ok(!tokensMatch('never', 'neverending'));
  assert.ok(!tokensMatch('don', 'done'));
  assert.ok(tokensMatch('not', 'not'));
  assert.ok(!tokensMatch('%', '%x'));
});

test('alignWords and renderDiff: the Grochola quote shows the added source word and the stem pairs', () => {
  const a = alignWords(tokenize(GROCHOLA_QUOTE), tokenize('not really knowing what the simulation did'));
  assert.equal(a.matched, 6);
  assert.equal(a.score, 1);
  assert.equal(renderDiff(a.ops), 'not {+really+} know~knowing what the sim~simulation did');
});

test('alignWords marks a word the page added with [- -] and a word only the source has with {+ +}; in a gap the page words print first', () => {
  const a = alignWords(tokenize('the funding rate really explains price moves today'), tokenize('the funding rate changes explaining price moves'));
  assert.equal(renderDiff(a.ops), 'the funding rate [-really-] [-explains-] {+changes+} {+explaining+} price moves [-today-]');
  assert.equal(a.matched, 5);
  assert.ok(a.score < 0.7);
});

test('digits are never stems: 40 is not 400', () => {
  assert.ok(!tokensMatch('40', '400'));
  assert.ok(!tokensMatch('2026', '20261'));
  assert.ok(tokensMatch('40', '40'));
});

test('a negation is never aligned with a different word: it shows as a deletion and an insertion', () => {
  const a = alignWords(tokenize('it is not safe to proceed now'), tokenize('it is nothing safe to proceed now'));
  const diff = renderDiff(a.ops);
  assert.match(diff, /\[-not-\]/);
  assert.match(diff, /\{\+nothing\+\}/);
  assert.equal(a.matched, 6);
});

test('a coined question scores far below the threshold against an unrelated source', () => {
  const a = alignWords(tokenize('will this make my child different from the alternative'), tokenize('the trial followed adults for twelve years after treatment ended'));
  assert.ok(a.score < 0.5, String(a.score));
});

test('bestWindow finds the near-match stretch inside a long document and reports where', () => {
  const filler = (n, seed) => Array.from({ length: n }, (_, i) => `filler${seed}${i % 37}`).join(' ');
  const text = `${filler(900, 'a')} ${GROCHOLA_SOURCE} ${filler(900, 'b')}`;
  const doc = prepareDocument(text);
  const m = bestWindow(tokenize(GROCHOLA_QUOTE), doc);
  assert.ok(m.score >= NEAR_THRESHOLD, JSON.stringify(m.score));
  assert.match(renderDiff(m.ops), /\{\+really\+\}/);
  assert.equal(doc.tokens.slice(m.start, m.end).join(' '), 'not really knowing what the simulation did', 'the window is trimmed to the matched stretch');
});

test('bestWindow returns nothing useful for a document that does not hold the words', () => {
  const doc = prepareDocument('completely unrelated text about gardens and weather patterns in spring');
  const m = bestWindow(tokenize(GROCHOLA_QUOTE), doc);
  assert.ok(!m || m.score < 0.5);
});

test('bestWindow is deterministic: the same inputs give the same window and diff', () => {
  const text = `${GROCHOLA_SOURCE} and later one may not really knowing what the simulation did again`;
  const run = () => { const m = bestWindow(tokenize(GROCHOLA_QUOTE), prepareDocument(text)); return JSON.stringify([m.start, m.end, m.score, renderDiff(m.ops)]); };
  assert.equal(run(), run());
  assert.equal(JSON.parse(run())[0], 2, 'the earlier of two equal windows wins');
});
