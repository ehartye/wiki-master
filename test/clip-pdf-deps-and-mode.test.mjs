import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseExtraction, dependencyReport, parseMode } from '../scripts/lib/pdf-extract.mjs';
import { thinOutcome } from '../scripts/clip-pdf.mjs';

// ---------------------------------------------------------------- reading mode

test('parseMode defaults to auto and accepts the two explicit modes', () => {
  assert.equal(parseMode([]), 'auto');
  assert.equal(parseMode(['file.pdf', '--quality=high']), 'auto');
  assert.equal(parseMode(['--mode=auto']), 'auto');
  assert.equal(parseMode(['--mode=reading-order']), 'reading-order');
  assert.equal(parseMode(['--mode=table']), 'table');
});

test('parseMode rejects an unknown mode rather than silently falling back to auto', () => {
  // Silently defaulting is the failure this whole module exists to prevent: the
  // operator believes they overrode the detector and the clipping says otherwise.
  assert.throws(() => parseMode(['--mode=layout']), /unknown reading mode/i);
});

test('--mode=reading-order overrides a tabular detection and RECORDS that it did', () => {
  // The real case: the CCSS Progressions volume is a body+margin two-column
  // layout that scores right at the tabular threshold (0.30-0.37 across the
  // document). -table interleaves the margin standards notes into the body
  // column line-by-line and leaves hyphenated breaks unjoined, so no span of it
  // is quotable. A human who has looked at the document must be able to say so.
  const c = chooseExtraction({ tabular: true, canTable: true, override: 'reading-order' });
  assert.deepEqual(c.args, [], 'reads in reading-order mode');
  assert.equal(c.extraction, 'reading-order-forced');
  assert.equal(c.overrode, true, 'the override diverged from the detector');
  // A human override asserts the detector was WRONG, so it must not manufacture
  // a fidelity claim in either direction -- neither 'tabular' nor 'degraded'.
  assert.equal(c.fidelityFloor, undefined);
  assert.match(c.warning, /detector/i);
});

test('--mode=reading-order on a document the detector already called prose is a silent no-op', () => {
  // Nothing diverged, so there is nothing to annotate or warn about; the
  // clipping must be byte-identical to the automatic one.
  const c = chooseExtraction({ tabular: false, canTable: true, override: 'reading-order' });
  assert.deepEqual(c, chooseExtraction({ tabular: false, canTable: true }));
});

test('--mode=table forces aligned reading and still floors fidelity at tabular', () => {
  // Aligned output IS reconstructed from horizontal position regardless of what
  // the detector thought, so the tabular fidelity floor is a property of the
  // MODE, not of the detection.
  const c = chooseExtraction({ tabular: false, canTable: true, override: 'table' });
  assert.deepEqual(c.args, ['-table']);
  assert.equal(c.extraction, 'table-aware');
  assert.equal(c.fidelityFloor, 'tabular');
  assert.equal(c.overrode, true);
});

test('--mode=table is refused, not silently downgraded, when pdftotext has no -table', () => {
  const c = chooseExtraction({ tabular: true, canTable: false, override: 'table' });
  assert.ok(c.error, 'refuses rather than producing a clipping in the wrong mode');
  assert.match(c.error, /xpdf/i);
});

// ------------------------------------------------------------- dependency yell

test('dependencyReport is silent only when every tool is present', () => {
  const r = dependencyReport({ pdftotext: true, table: true, pdftoppm: true, tesseract: true });
  assert.equal(r.ok, true);
  assert.equal(r.fatal, false);
  assert.deepEqual(r.missing, []);
});

test('dependencyReport treats a missing pdftotext as FATAL', () => {
  const r = dependencyReport({ pdftotext: false, table: false, pdftoppm: false, tesseract: false });
  assert.equal(r.fatal, true);
  assert.ok(r.missing.includes('pdftotext'));
  assert.match(r.lines.join('\n'), /xpdfreader\.com/);
});

test('dependencyReport names the exact capability lost to each missing tool', () => {
  // "Missing tesseract" means nothing to a reader; "scanned PDFs cannot be read
  // at all" is the fact they need. Every missing tool must state its consequence.
  const noOcr = dependencyReport({ pdftotext: true, table: true, pdftoppm: true, tesseract: false });
  assert.equal(noOcr.ok, false);
  assert.equal(noOcr.fatal, false, 'OCR is a fallback, not a hard requirement');
  assert.equal(noOcr.ocr, false);
  assert.deepEqual(noOcr.missing, ['tesseract']);
  const text = noOcr.lines.join('\n');
  assert.match(text, /scanned/i, 'says which documents are now unreadable');
  assert.match(text, /tesseract/i, 'says how to fix it');

  const noTable = dependencyReport({ pdftotext: true, table: false, pdftoppm: true, tesseract: true });
  assert.equal(noTable.ok, false);
  assert.match(noTable.lines.join('\n'), /row/i, 'says table row pairings are lost');
});

test('dependencyReport reports OCR down when EITHER OCR tool is missing', () => {
  for (const missing of ['pdftoppm', 'tesseract']) {
    const caps = { pdftotext: true, table: true, pdftoppm: true, tesseract: true, [missing]: false };
    const r = dependencyReport(caps);
    assert.equal(r.ocr, false, `${missing} missing disables OCR`);
    assert.deepEqual(r.missing, [missing]);
  }
});

// ------------------------------------------- a tooling gap is not a judgement

test('a thin extraction records a decline only when OCR was actually TRIED', () => {
  // A decline carries a 180-day TTL. Recording one because Tesseract is not
  // installed buries a perfectly recoverable source behind a judgement nobody
  // made -- the exact "transient failures are not declines" guardrail.
  const tried = thinOutcome({ ocrAvailable: true });
  assert.equal(tried.decline, true);
  assert.match(tried.reason, /scanned|encrypted/i);

  const neverTried = thinOutcome({ ocrAvailable: false });
  assert.equal(neverTried.decline, false, 'no decline for a missing-toolchain failure');
  assert.equal(neverTried.status, 'ocr-unavailable');
  assert.match(neverTried.message, /tesseract/i, 'tells the operator what to install');
});
