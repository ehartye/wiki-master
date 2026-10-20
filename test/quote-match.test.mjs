import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize, prepareDocument, matchFragment, classifyFragments,
  GAP_MAX_RUN, GAP_SHORT_QUOTE, GAP_SHORT_BUDGET, GAP_CAP, maxInserted, DECLARES_ABSENT,
} from '../scripts/lib/quote-match.mjs';

const doc = (text) => prepareDocument(text);
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

// ── tokenize: the markdown-aware, punctuation-insensitive word stream ─────────

test('tokenize drops markdown link targets, wikilink paths, escapes and list/quote markers', () => {
  assert.deepEqual(
    tokenize('> - The [committee](https://example.com/c) said [[wiki/x|plan]] a\\_b\n1) done'),
    ['the', 'committee', 'said', 'plan', 'a', 'b', 'done']);
});

test('tokenize folds ligatures and compatibility forms, case and all punctuation', () => {
  assert.deepEqual(tokenize('Ten ﬁnal “drafts” — don’t stop… 42%'), ['ten', 'final', 'drafts', 'don', 't', 'stop', '42', '%']);
});

test('tokenize keeps non-ASCII letters and digits (the regex needs its u flag)', () => {
  assert.deepEqual(tokenize('Größe naïve 数据 ١٢٣'), ['größe', 'naïve', '数据', '١٢٣']);
});

test('tokenize drops footnote markers and html tags/entities without eating real text', () => {
  assert.deepEqual(tokenize('x < y but y > z&nbsp;and <b>bold</b>[1][^note]'), ['x', '<', 'y', 'but', 'y', '>', 'z', 'and', 'bold']);
});

test('tokenize keeps comparison and arithmetic symbols: a changed operator is a changed word', () => {
  assert.deepEqual(tokenize('If a < b and 3 × 4 = 12 (40%) then x ≤ y, a \> b'), ['if', 'a', '<', 'b', 'and', '3', '×', '4', '=', '12', '40', '%', 'then', 'x', '≤', 'y', 'a', '>', 'b']);
});

test('tokenize keeps a negative-number sign as a symbol whether it is a hyphen or a true minus', () => {
  assert.deepEqual(tokenize('about −24 LUFS and -3 dB'), ['about', '−', '24', 'lufs', 'and', '−', '3', 'db']);
  // a hyphen inside a range or a compound is punctuation, not a sign
  assert.deepEqual(tokenize('1990-1995, pages 5-10 and well-known (a - b)'), ['1990', '1995', 'pages', '5', '10', 'and', 'well', 'known', 'a', 'b']);
});

// ── tier 2: convention — same words, different markup / punctuation / spacing ─

test('matchFragment: markup and punctuation differences are convention, not drift', () => {
  const d = doc('The [committee](https://e.com/c) concluded that sampling error, rather than bias, explained the divergence.');
  const m = matchFragment('The committee concluded that sampling error rather than bias explained the divergence', [d]);
  assert.equal(m.tier, 'convention');
  assert.deepEqual(m.inserted, []);
});

test('matchFragment: extraction-split words match by a boundary-aligned space-free compare', () => {
  const d = doc('Operators must keep the loop running while ensur ing that students operating with the third multiplica tive concept continue.');
  assert.equal(matchFragment('keep the loop running while ensuring that students', [d]).tier, 'convention');
  assert.equal(matchFragment('students operating with the third multiplicative concept continue', [d]).tier, 'convention');
});

test('matchFragment: a space-free match must start and end on evidence word boundaries', () => {
  // "he art of war" is NOT the sentence in the source: compact "heartofwar" occurs
  // inside "theartofwar", but starts mid-word. Silent-letter-drop must not pass.
  const d = doc('Read the art of war before the meeting starts today.');
  assert.equal(matchFragment('he art of war before the meeting', [d]).tier, null);
});

// ── tier 3: gapped — all words in order, extra evidence words between them ────

test('matchFragment: running-header noise inside a sentence is gapped and reports the inserted words', () => {
  const d = doc('The pipeline runs each stage in order and 148 Chapter 8 then hands the result to the next stage without delay.');
  const m = matchFragment('The pipeline runs each stage in order and then hands the result to the next stage without delay', [d]);
  assert.equal(m.tier, 'gapped');
  assert.deepEqual(m.inserted, ['148 chapter 8']);
});

test('matchFragment: a silent splice that drops a sentence is gapped with the dropped words shown', () => {
  const d = doc('Do not create an activity with lots of small pieces of analysis at the start of the lesson before the real work begins. Help us understand why we are here. Give us the larger problem now and the details later.');
  const m = matchFragment('Do not create an activity with lots of small pieces of analysis at the start of the lesson before the real work begins give us the larger problem now and the details later', [d]);
  assert.equal(m.tier, 'gapped');
  assert.deepEqual(m.inserted, ['help us understand why we are here']);
});

test('matchFragment: a gap longer than GAP_MAX_RUN is not a match', () => {
  const filler = words(GAP_MAX_RUN + 1);
  const lead = words(40).replace(/w/g, 'a');
  const tail = words(40).replace(/w/g, 'b');
  const d = doc(`${lead} ${filler} ${tail}`);
  assert.equal(matchFragment(`${lead} ${tail}`, [d]).tier, null);
});

test('matchFragment: total insertions beyond the budget for a short quote are not a match', () => {
  const n = 8;
  const extra = maxInserted(n) + 1;
  const parts = Array.from({ length: extra }, (_, i) => `x${i}`);
  // spread insertions in runs of 1 so only the TOTAL budget can reject it
  const q = Array.from({ length: n }, (_, i) => `q${i}`);
  const ev = q.flatMap((t, i) => (i > 0 && parts[i - 1] ? [parts[i - 1], t] : [t]));
  assert.equal(matchFragment(q.join(' '), [doc(ev.join(' '))]).tier, null);
});

test('maxInserted: short quotes skip little, longer quotes a quarter of their length, capped', () => {
  assert.equal(maxInserted(GAP_SHORT_QUOTE - 1), GAP_SHORT_BUDGET);
  assert.equal(maxInserted(40), 10);
  assert.equal(maxInserted(10_000), GAP_CAP);
});

test('matchFragment: a short quote scattered over a long hole is not a match', () => {
  // "technically halt the [8 words] progression of game time": every quoted word is
  // present in order, but the hole is wider than the quote itself.
  const d = doc('You can technically halt the same purpose and has the same structure progression of game time here.');
  assert.equal(matchFragment('technically halt the progression of game time', [d]).tier, null);
});

test('matchFragment: dropping a negation is never passed as a gapped quote', () => {
  const d = doc('The treatment does not improve accuracy on the held-out set in any of the trials.');
  const m = matchFragment('The treatment does improve accuracy on the held-out set in any of the trials', [d]);
  assert.equal(m.tier, null, 'the inserted word "not" flips the claim, so it stays unverified');
});

test('matchFragment: dropped contraction negation (don t) is also never gapped', () => {
  const d = doc("Students don't generalize this rule to new cases without practice and feedback.");
  assert.equal(matchFragment('Students generalize this rule to new cases without practice and feedback', [d]).tier, null);
});

// ── what must stay unverified ─────────────────────────────────────────────────

test('matchFragment: a substituted word is unverified', () => {
  const d = doc('The sample showed a forty percent improvement across all tested configurations.');
  assert.equal(matchFragment('The sample showed a fifty percent improvement across all tested configurations', [d]).tier, null);
});

test('matchFragment: an added negation is unverified', () => {
  const d = doc('The sample showed an improvement across all tested configurations in the trial.');
  assert.equal(matchFragment('The sample showed no improvement across all tested configurations in the trial', [d]).tier, null);
});

test('matchFragment: a flipped comparison, operator or dropped percent sign is unverified', () => {
  const d = doc('Accuracy rose when a < b held and 3 × 4 = 12 for the 40% improvement across all tested configurations.');
  assert.equal(matchFragment('Accuracy rose when a < b held and 3 × 4 = 12 for the 40% improvement across all tested configurations', [d]).tier, 'convention');
  for (const bad of [
    'Accuracy rose when a > b held and 3 × 4 = 12 for the 40% improvement across all tested configurations',
    'Accuracy rose when a < b held and 3 + 4 = 12 for the 40% improvement across all tested configurations',
    'Accuracy rose when a < b held and 3 × 4 = 12 for the 40 improvement across all tested configurations',
  ]) assert.equal(matchFragment(bad, [d]).tier, null, bad);
});

test('matchFragment: a true minus sign matches the capture hyphen, but a dropped sign does not', () => {
  const d = doc('The program loudness is almost equivalent to -24 LUFS without a gating method in this guideline.');
  assert.equal(matchFragment('The program loudness is almost equivalent to −24 LUFS without a gating method in this guideline', [d]).tier, 'convention');
  assert.equal(matchFragment('The program loudness is almost equivalent to 24 LUFS without a gating method in this guideline', [d]).tier, null);
});

test('matchFragment: reordered words are unverified', () => {
  const d = doc('Alpha precedes beta in the sorted list of all tested configurations.');
  assert.equal(matchFragment('Beta precedes alpha in the sorted list of all tested configurations', [d]).tier, null);
});

test('matchFragment: an extra quote word absent from the evidence is unverified', () => {
  const d = doc('Alpha precedes beta in the sorted list of all tested configurations.');
  assert.equal(matchFragment('Alpha clearly precedes beta in the sorted list of all tested configurations', [d]).tier, null);
});

test('matchFragment: tiers are decided within ONE document, never stitched across documents', () => {
  const a = doc('Alpha precedes beta in the sorted list');
  const b = doc('of all tested configurations in the end');
  assert.equal(matchFragment('Alpha precedes beta in the sorted list of all tested configurations', [a, b]).tier, null);
});

test('matchFragment prefers the strictest tier across documents', () => {
  const noisy = doc('Alpha precedes beta in 12 03 the sorted list of all tested configurations');
  const clean = doc('Alpha precedes beta in the sorted list of all tested configurations');
  assert.equal(matchFragment('Alpha precedes beta in the sorted list of all tested configurations', [noisy, clean]).tier, 'convention');
});

// ── classifyFragments: a quote is as weak as its weakest fragment ─────────────

test('classifyFragments takes the weakest tier over fragments and unions the inserted words', () => {
  const d = doc('First the pipeline runs each stage 148 Chapter 8 and then the result is checked. Second the audit finds the real cause.');
  const frags = ['First the pipeline runs each stage and then the result is checked', 'Second the audit finds the real cause'];
  const r = classifyFragments(frags, [d]);
  assert.equal(r.tier, 'gapped');
  assert.deepEqual(r.inserted, ['148 chapter 8']);
  const bad = classifyFragments([...frags, 'Third the invented claim appears nowhere'], [d]);
  assert.equal(bad.tier, 'unverified');
});

test('classifyFragments with no evidence documents is unverified', () => {
  assert.equal(classifyFragments(['some quoted words that nobody holds'], []).tier, 'unverified');
});

// ── memory: a document that cannot match is never fully indexed ──────────────

test('matchFragment does not tokenize-and-index documents that lack a quoted word', () => {
  const hit = doc('Alpha precedes beta in 12 03 the sorted list of all tested configurations');
  const miss = doc('Nothing here resembles the quotation at all, not one of its rarer words.');
  const q = 'Alpha precedes beta in the sorted list of all tested configurations';
  assert.equal(matchFragment(q, [miss, hit]).tier, 'gapped');
  assert.equal(miss.indexBuilt, false, 'the non-matching document never built its word index');
  assert.equal(hit.indexBuilt, true);
});

test('prepared documents build the compact form with typed boundary arrays', () => {
  const d = doc('ensur ing that multiplica tive concepts hold');
  assert.equal(matchFragment('ensuring that multiplicative concepts hold', [d]).tier, 'convention');
  assert.ok(d.compact.starts instanceof Uint8Array && d.compact.ends instanceof Uint8Array);
  assert.equal(d.compact.starts.length, d.compact.text.length);
});

// ── declared-absent sentences ────────────────────────────────────────────────

test('DECLARES_ABSENT matches the page saying the text is not in the source, in several wordings', () => {
  for (const s of [
    'Attribution recorded as unsourced: "x"',
    'these Tron descriptions are not in the clipped source and are paraphrase',
    'the phrase is not in the captured source',
    'this wording is nowhere in the vault',
    'that line is not in the vault yet',
  ]) assert.ok(DECLARES_ABSENT.test(s), s);
  for (const s of ['The source says it is in the vault', 'not a source of truth', 'sourced from the clipping']) {
    assert.ok(!DECLARES_ABSENT.test(s), s);
  }
});
