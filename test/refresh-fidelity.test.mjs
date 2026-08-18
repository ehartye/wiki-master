import test from 'node:test';
import assert from 'node:assert/strict';
import { clearFidelityLine, splitBody, fidelityIsExtractionDerived } from '../scripts/refresh-fidelity.mjs';

// `fidelity:` is a cached verdict from clip time that nothing re-validates, so a
// stale "degraded" outlives the heuristic that produced it. Absent means healthy —
// the convention the clippers already write — so clearing the line is the repair.

test('clearFidelityLine removes the flag and preserves everything else', () => {
  const text = '---\ntitle: "T"\nfidelity: degraded\nsource-hash: abc1234\n---\n\nbody text\n';
  const out = clearFidelityLine(text);
  assert.ok(!/^fidelity:/m.test(out), 'flag gone');
  assert.match(out, /^title: "T"$/m);
  assert.match(out, /^source-hash: abc1234$/m);
  assert.ok(out.endsWith('---\n\nbody text\n'), 'body and fence intact');
});

test('clearFidelityLine handles the flag as the last frontmatter line', () => {
  const text = '---\ntitle: "T"\nfidelity: degraded\n---\nbody\n';
  const out = clearFidelityLine(text);
  assert.ok(!/^fidelity:/m.test(out));
  assert.ok(out.endsWith('---\nbody\n'), 'no dangling blank line before the fence');
});

test('clearFidelityLine is a no-op when there is no flag', () => {
  const text = '---\ntitle: "T"\n---\nbody\n';
  assert.equal(clearFidelityLine(text), text);
});

test('clearFidelityLine does not touch a similarly-named key', () => {
  const text = '---\nfidelity-note: keep me\n---\nbody\n';
  assert.match(clearFidelityLine(text), /fidelity-note: keep me/);
});

test('splitBody returns the markdown after the frontmatter', () => {
  assert.equal(splitBody('---\na: 1\n---\nhello\n'), 'hello\n');
  assert.equal(splitBody('no frontmatter\n'), 'no frontmatter\n');
});

// A fidelity flag whose basis is the EXTRACTION cannot be re-derived from the
// stored text, so this script must not clear it. Both table extractions produce
// markdown that assesses perfectly clean — that is precisely the trap in #66 —
// so without this guard the next maintenance run would delete the only record
// that the rows are not to be trusted.
test('fidelityIsExtractionDerived protects table-derived flags from being cleared', () => {
  const fm = (extraction) => [
    'title: "T"',
    'quality: high',
    ...(extraction ? [`extraction: ${extraction}`] : []),
    'fidelity: tabular',
    'source-hash: abc1234',
  ].join('\n');

  // Rows reconstructed from layout, and rows lost outright: both extraction-derived.
  assert.equal(fidelityIsExtractionDerived(fm('table-aware')), true);
  assert.equal(fidelityIsExtractionDerived(fm('table-flattened')), true);

  // OCR damage and font mangling ARE re-derivable from the characters, so those
  // stay clearable — the script's original purpose must survive this change.
  assert.equal(fidelityIsExtractionDerived(fm('ocr')), false);
  assert.equal(fidelityIsExtractionDerived(fm(null)), false);

  // Quoted values, and `extraction` sitting anywhere in the block.
  assert.equal(fidelityIsExtractionDerived('extraction: "table-aware"\nfidelity: tabular'), true);
  // A `source:` line mentioning the word must not be mistaken for the field.
  assert.equal(fidelityIsExtractionDerived('source: "https://x/table-aware.pdf"\nfidelity: degraded'), false);
});
