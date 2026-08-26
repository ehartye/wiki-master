import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePdftotextCapabilities, pdftotextCapabilities, shortKeyLines, tabularity, chooseExtraction,
} from '../scripts/lib/pdf-extract.mjs';

test('parsePdftotextCapabilities detects the Xpdf -table mode, and its absence in poppler', () => {
  // Xpdf 4.x advertises -table; poppler never has. The flavor decides whether a
  // tabular PDF can be recovered at all, so it must be PROBED, not assumed --
  // the repo's prose says "poppler" while a very common install is Xpdf.
  const xpdf = [
    'pdftotext version 4.06 [www.xpdfreader.com]',
    '  -layout                : maintain original physical layout',
    '  -table                 : similar to -layout, but optimized for tables',
    '  -enc <string>          : output text encoding name',
  ].join('\n');
  const cap = parsePdftotextCapabilities(xpdf);
  assert.equal(cap.table, true);
  assert.equal(cap.layout, true);
  assert.equal(cap.flavor, 'xpdf');

  const poppler = [
    'pdftotext version 24.02.0',
    'Copyright 2005-2024 The Poppler Developers',
    '  -layout              : maintain original physical layout',
    '  -enc <string>        : output text encoding name',
  ].join('\n');
  const pc = parsePdftotextCapabilities(poppler);
  assert.equal(pc.table, false, 'poppler has no -table mode');
  assert.equal(pc.flavor, 'poppler');

  // An unreadable/absent probe must not masquerade as capable.
  assert.equal(parsePdftotextCapabilities('').table, false);
  assert.equal(parsePdftotextCapabilities('').flavor, 'unknown');
});

// Real bug, found live: poppler is a fork of Xpdf's original codebase, and a
// real, current poppler build's own banner text credits BOTH "The Poppler
// Developers" AND "Copyright ... Glyph & Cog, LLC" (Xpdf's author) -- confirmed
// on poppler 26.01.0's actual `pdftotext -v` output. The old flavor check tested
// for "Glyph & Cog" FIRST, so this genuine poppler install (no -table) was
// misclassified as 'xpdf'.
test('parsePdftotextCapabilities classifies a poppler banner that also credits Xpdf\'s author as poppler, not xpdf', () => {
  const popplerWithLegacyCredit = [
    'pdftotext version 26.01.0',
    'Copyright 2005-2026 The Poppler Developers - http://poppler.freedesktop.org',
    'Copyright 1996-2011, 2022 Glyph & Cog, LLC',
    '  -layout              : maintain original physical layout',
  ].join('\n');
  const cap = parsePdftotextCapabilities(popplerWithLegacyCredit);
  assert.equal(cap.flavor, 'poppler', 'an explicit "poppler" mention must win over the incidental Xpdf-author credit line');
  assert.equal(cap.table, false, 'this poppler build has no -table mode');
});

// Real bug, found live: a poppler build (26.01.0) exits 0 for `-h`/`-v` and writes
// its ENTIRE banner + usage listing to stderr, never stdout. spawnSync-based probes
// must capture stderr on a SUCCESSFUL (exit-0) run, not only inside a catch/failure
// branch — an execFileSync-based probe that only returns its success value (stdout)
// silently discards that text and misreports a real, working poppler install as
// `flavor: 'unknown'`, which then reports the whole PDF toolchain as absent (fatal)
// even though it is fully installed and functional. Xpdf's own pdftotext exits 99
// for `-v`, which is why this exact case never surfaced on an Xpdf machine.
test('pdftotextCapabilities captures stderr text even when the probe exits 0', () => {
  const popplerBannerOnStderr = [
    'pdftotext version 26.01.0',
    'Copyright 2005-2026 The Poppler Developers - http://poppler.freedesktop.org',
    'Usage: pdftotext [options] <PDF-file> [<text-file>]',
    '  -layout              : maintain original physical layout',
  ].join('\n');
  // Fakes exactly the real shape: exit 0, stdout empty, everything on stderr.
  const probe = () => ({ status: 0, stdout: '', stderr: popplerBannerOnStderr });
  const caps = pdftotextCapabilities({ probe });
  assert.equal(caps.flavor, 'poppler', 'must not misreport an installed, working pdftotext as unknown');
  assert.equal(caps.layout, true);
  assert.equal(caps.table, false);
});

test('shortKeyLines picks out standalone key-column cells, not prose lines', () => {
  const text = [
    '5.35',
    'Describe the steps that Tennessee took to become a state, including the vote.',
    'G, H, P, T',
    'This is an ordinary flowing sentence of prose that should never count.',
  ].join('\n');
  const shorts = shortKeyLines(text);
  assert.deepEqual(shorts, ['5.35', 'G, H, P, T']);
});

test('tabularity separates a real table from two-column prose via the promotion test', () => {
  // The signal is RELATIONAL: a short standalone line in reading-order mode that
  // becomes the LEADING token of a longer line in aligned mode is a key column
  // being re-attached to its value. Line-length statistics alone do not separate
  // these (measured: shortFrac 0.30 tabular vs 0.25 prose -- useless).
  const dflt = ['5.35', 'Describe the steps that Tennessee took to become a state.',
    '5.36', 'Identify the year Tennessee became a state and its first governor.',
    '5.37', 'Describe involvement in the War of 1812 including Andrew Jackson.',
    '5.38', 'Analyze the impact of the presidency on the American Indian population.',
    '5.39', 'Explain how the western boundary was expanded with the Purchase.',
    '5.40', 'Identify the impact of important Tennesseans prior to the Civil War.',
    '5.41', 'Examine the issue of slavery in the three grand divisions of the state.',
    '5.42', 'Describe the significance of the following Civil War events and battles.'].join('\n');
  const aligned = ['5.35  Describe the steps that Tennessee took to become a state.',
    '5.36  Identify the year Tennessee became a state and its first governor.',
    '5.37  Describe involvement in the War of 1812 including Andrew Jackson.',
    '5.38  Analyze the impact of the presidency on the American Indian population.',
    '5.39  Explain how the western boundary was expanded with the Purchase.',
    '5.40  Identify the impact of important Tennesseans prior to the Civil War.',
    '5.41  Examine the issue of slavery in the three grand divisions of the state.',
    '5.42  Describe the significance of the following Civil War events and battles.'].join('\n');
  const t = tabularity(dflt, aligned);
  assert.equal(t.tabular, true);
  assert.equal(t.promoFrac, 1);

  // Prose: the short lines stay standalone in aligned mode -- nothing is promoted.
  const proseD = Array.from({ length: 10 }, (_, i) =>
    `[${i + 1}]\nA full sentence of flowing academic prose that carries the argument forward.`).join('\n');
  const proseA = proseD;
  assert.equal(tabularity(proseD, proseA).tabular, false);
});

test('tabularity abstains when there are too few key lines to judge', () => {
  // Below the sample floor the ratio is noise. Abstaining (tabular:false,
  // sampled:false) is not the same as "measured and found to be prose" -- the
  // caller must be able to tell those apart.
  const t = tabularity('5.1\nSome text here that is long enough to matter.', '5.1  Some text here.');
  assert.equal(t.sampled, false);
  assert.equal(t.tabular, false);
});

test('chooseExtraction routes prose to reading-order and tables to -table', () => {
  // Prose keeps today's behaviour exactly: reading-order mode, no extra stamps.
  const prose = chooseExtraction({ tabular: false, canTable: true });
  assert.deepEqual(prose.args, []);
  assert.equal(prose.extraction, undefined);
  assert.equal(prose.fidelityFloor, undefined);
  assert.equal(prose.warning, undefined);

  const table = chooseExtraction({ tabular: true, canTable: true });
  assert.deepEqual(table.args, ['-table']);
  assert.equal(table.extraction, 'table-aware');
  assert.equal(table.fidelityFloor, 'tabular');
});

test('chooseExtraction refuses to silently flatten a table when -table is unavailable', () => {
  // THE BUG. Without -table there is no faithful reading, so the clipping must
  // NOT claim high fidelity, and the user must be told which library to install.
  // -layout is deliberately NOT used as a fallback: measured on the real source
  // PDF it stacks consecutive codes into a column while their text drifts, so
  // 5.36 visually pairs with the tail of 5.35 -- confidently wrong, which is
  // strictly worse than visibly broken.
  const c = chooseExtraction({ tabular: true, canTable: false });
  assert.deepEqual(c.args, [], 'falls back to reading-order, never -layout');
  assert.equal(c.fidelityFloor, 'degraded');
  assert.ok(c.warning, 'must emit a warning naming the missing capability');
  assert.match(c.warning, /-table/);
  assert.match(c.warning, /xpdf/i, 'names the library that provides it');
});
