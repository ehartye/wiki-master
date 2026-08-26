import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectTabular, planExtraction, pdfClipContent, pdfToText } from '../scripts/clip-pdf.mjs';
import { pdftotextCapabilities, pdftotextPresent, tabularity } from '../scripts/lib/pdf-extract.mjs';
import { makePdf, tablePages, prosePages } from './fixtures/make-pdf.mjs';

const LF = String.fromCharCode(10);

// These exercise the detector against a REAL pdftotext, which is where the
// thresholds actually live. pdftotext is not guaranteed on CI, so skip rather
// than fail when it is absent -- a missing tool is not a broken detector.
// Use the shared probe, NOT an exit-code check: Xpdf's pdftotext exits 99 for
// -v, so the naive version skipped these tests on exactly the installs whose
// -table mode they are meant to cover.
const skip = pdftotextPresent() ? false : 'pdftotext not installed';

test('detectTabular separates a real table from a two-column paper', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-tab-'));
  try {
    const table = makePdf(tablePages(), join(dir, 'table.pdf'));
    const prose = makePdf(prosePages(), join(dir, 'prose.pdf'));
    const canTable = pdftotextCapabilities().table;

    const t = detectTabular(table, { canTable });
    assert.equal(t.sampled, true);
    assert.equal(t.tabular, true, `table PDF must be detected as tabular (promoFrac=${t.promoFrac})`);

    const p = detectTabular(prose, { canTable });
    assert.equal(p.tabular, false, `two-column prose must NOT be detected as tabular (promoFrac=${p.promoFrac})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the -layout detector used on poppler still sees the table', { skip }, () => {
  // Poppler has no -table mode, so it cannot RECOVER the rows -- but it must
  // still DETECT them, because detection is what produces the warning and the
  // degraded stamp. If detection failed here, poppler users would silently get
  // the original bug back.
  const dir = mkdtempSync(join(tmpdir(), 'wm-tab2-'));
  try {
    const table = makePdf(tablePages(), join(dir, 'table.pdf'));
    const t = detectTabular(table, { canTable: false });
    assert.equal(t.tabular, true, `poppler-path detection must still flag the table (promoFrac=${t.promoFrac})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('aligned mode re-attaches every row key that reading-order mode detaches', { skip: skip || (!pdftotextCapabilities().table && 'no -table mode') }, () => {
  // The bug, end to end: in reading-order mode the standard codes stand alone
  // (detached from their text); in -table mode each one leads its row.
  const dir = mkdtempSync(join(tmpdir(), 'wm-tab3-'));
  try {
    const table = makePdf(tablePages(1), join(dir, 'table.pdf'));
    const dflt = pdfToText(table);
    const aligned = pdfToText(table, ['-table']);

    // Line comparisons, not regexes: the codes contain '.' and the assertions
    // are about line SHAPE, which reads more plainly as a predicate anyway.
    const lines = (t) => t.split(LF).map((l) => l.trim());
    const standalone = (t, code) => lines(t).includes(code);
    const leadsRow = (t, code) => lines(t).some((l) => l.startsWith(code + ' ') && l.length > code.length + 8);
    const rowFor = (t, code) => lines(t).find((l) => l.startsWith(code + ' ')) || '';

    for (const code of ['5.31', '5.32', '5.33', '5.34', '5.35', '5.36']) {
      assert.ok(standalone(dflt, code), `${code} stands detached from its text in reading-order mode`);
      assert.ok(leadsRow(aligned, code), `${code} leads its own row in -table mode`);
    }
    // And the pairing is the CORRECT one, not merely some pairing. This is the
    // assertion that would have caught the original bug: every cell can be
    // present and correct while the rows pair the wrong key to the wrong value.
    assert.ok(rowFor(aligned, '5.34').includes('Explain how the western boundary'));
    assert.ok(rowFor(aligned, '5.36').includes('Examine the growth of the cotton economy'));
    assert.equal(tabularity(dflt, aligned).tabular, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a poppler install cannot silently flatten a table: it warns and marks it degraded', { skip }, () => {
  // The branch that carries the guarantee, and the one that CANNOT be reached on
  // a machine that has -table -- so the capability set is injected rather than
  // probed. Poppler ships no -table mode, so there is no faithful reading
  // available; the clipping must say so instead of claiming high fidelity.
  const dir = mkdtempSync(join(tmpdir(), 'wm-tab4-'));
  try {
    const table = makePdf(tablePages(), join(dir, 'table.pdf'));
    const poppler = { table: false, layout: true, flavor: 'poppler' };

    const { tab, mode } = planExtraction(table, { caps: poppler });
    assert.equal(tab.tabular, true, 'detection must still fire without -table');
    assert.equal(mode.fidelityFloor, 'degraded');
    assert.deepEqual(mode.args, [], '-layout must NOT be used to produce the clipping');
    assert.match(mode.warning, /pairings are LOST/);

    // And the floor actually reaches the written note, whose text assesses clean.
    const clip = pdfClipContent({
      title: 'T', source: 's', text: pdfToText(table, mode.args),
      extraction: mode.extraction, fidelityFloor: mode.fidelityFloor,
    });
    assert.equal(clip.assessed, 'high', 'a flattened table reads as clean prose -- that is the trap');
    assert.equal(clip.fidelity, 'degraded');
    assert.match(clip.body, /fidelity: degraded/);

    // Xpdf, same document: recovered, and stamped as reconstructed rather than verbatim.
    // The real installed pdftotext on THIS machine may not have -table at all (this is
    // exactly the poppler case the first half of this test covers) -- asking the real
    // binary to run with `-table` on such a machine doesn't simulate "an Xpdf install",
    // it just fails (poppler exits with a usage error for a flag it doesn't recognise),
    // which `detectTabular`'s try/catch swallows into a null result and silently defeats
    // this half of the test. `detect` is stubbed here for the same reason `caps` is
    // injected above the block comment: this branch verifies planExtraction's WIRING
    // (given tabular detection + table capability, does it choose -table mode?), not
    // detection itself -- which the poppler-path checks above and detectTabular's own
    // tests elsewhere already exercise against a real binary.
    const xpdf = planExtraction(table, {
      caps: { table: true, layout: true, flavor: 'xpdf' },
      detect: () => ({ tabular: true }),
    });
    assert.deepEqual(xpdf.mode.args, ['-table']);
    assert.equal(xpdf.mode.extraction, 'table-aware');
    assert.equal(xpdf.mode.fidelityFloor, 'tabular');
    assert.equal(xpdf.mode.warning, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a prose document is untouched by all of this', { skip }, () => {
  // The regression that would hurt most: routing a two-column paper through an
  // aligned mode interleaves its columns and makes every quote untraceable.
  const dir = mkdtempSync(join(tmpdir(), 'wm-tab5-'));
  try {
    const prose = makePdf(prosePages(), join(dir, 'prose.pdf'));
    for (const caps of [{ table: true, layout: true, flavor: 'xpdf' }, { table: false, layout: true, flavor: 'poppler' }]) {
      const { mode } = planExtraction(prose, { caps });
      assert.deepEqual(mode.args, [], `${caps.flavor}: prose stays in reading-order mode`);
      assert.equal(mode.fidelityFloor, undefined, `${caps.flavor}: no fidelity floor`);
      assert.equal(mode.warning, undefined, `${caps.flavor}: nothing to warn about`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
