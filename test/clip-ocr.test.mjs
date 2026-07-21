import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFidelity, shouldTryOcr, preferBetterExtraction } from '../scripts/clip-pdf.mjs';

// Real bug, found migrating the bidding corpus: OCR escalation was gated on the
// text layer being THIN (wordCount < 100). A PDF whose embedded font decodes to
// garbage produces PLENTY of words — just corrupted ones — so a 34,121-word
// thesis whose every equation decoded to U+FFFD sailed past the thin check and
// was never escalated, landing as `fidelity: degraded` with OCR untried.
// Escalation must trigger on quality, not just quantity.

const words = (s) => (s.match(/\S+/g) || []).length;
const mk = (md) => ({ md, wordCount: words(md), fidelity: assessFidelity(md).degraded ? 'degraded' : 'high' });

const CLEAN = mk('The quick brown fox jumps over the lazy dog. '.repeat(30));
const DEGRADED = mk('The quick brown fox jumps over the lazy dog. '.repeat(30) + '�'.repeat(200));
const THIN = mk('only a few words here');

test('fixtures are what the test claims (guards against a silent fixture drift)', () => {
  assert.equal(CLEAN.fidelity, 'high');
  assert.equal(DEGRADED.fidelity, 'degraded');
  assert.ok(DEGRADED.wordCount >= 100, 'the degraded fixture is FAT, not thin — that is the whole bug');
});

test('shouldTryOcr: a thin text layer escalates (existing behaviour)', () => {
  assert.equal(shouldTryOcr(THIN), true);
});

test('shouldTryOcr: an abundant but DEGRADED text layer escalates (the fix)', () => {
  assert.equal(shouldTryOcr(DEGRADED), true, 'plenty of words but corrupted must still reach OCR');
});

test('shouldTryOcr: clean, abundant text does not pay for OCR', () => {
  assert.equal(shouldTryOcr(CLEAN), false);
});

test('preferBetterExtraction: degraded text layer yields to a clean OCR pass', () => {
  assert.equal(preferBetterExtraction(DEGRADED, CLEAN), CLEAN);
});

test('preferBetterExtraction: a clean text layer is NOT replaced by a degraded OCR pass', () => {
  assert.equal(preferBetterExtraction(CLEAN, DEGRADED), CLEAN);
});

test('preferBetterExtraction: a thin text layer yields to any usable OCR text', () => {
  assert.equal(preferBetterExtraction(THIN, CLEAN), CLEAN);
});

test('preferBetterExtraction: OCR that comes back thin is discarded', () => {
  assert.equal(preferBetterExtraction(DEGRADED, THIN), DEGRADED, 'never trade real text for nothing');
});
