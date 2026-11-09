import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as clipPdf from '../scripts/clip-pdf.mjs';
import { resolveTool } from '../scripts/lib/pdf-figures.mjs';
import { makePdf, prosePages } from './fixtures/make-pdf.mjs';

const { main, pdfinfoTitle, titleFromPdf } = clipPdf;
const choosePdfTitle = (...a) => clipPdf.choosePdfTitle(...a);

// The title chain: --title, then a plausible pdfinfo Title, then the stem with a warning. Every main run here injects
// the toolchain, the text and the pdfinfo title, so nothing needs pdftotext, pdfinfo or the network.

const BODY = Array.from({ length: 160 }, (_, i) => `word${i % 40}`).join(' ');
const READY = () => ({ ok: true, fatal: false, lines: [] });
const warning = (stem, from) => `WARNING: no usable title in the PDF; the clipping is titled "${stem}" from ${from}. Pass --title=<text> to name it`;

// A fresh vault per run: every run clips the same body, and a second clip of it would be a duplicate.
function vault(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-clip-pdf-title-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => {
    if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

// main with stdout and stderr captured apart, returning the written clipping's title: line.
function clip(t, target, extra, deps) {
  const root = vault(t);
  const out = [], err = [];
  const log = console.log, error = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  let result;
  try { result = main([target, ...extra], { toolchain: READY, extractText: () => BODY, ...deps }); }
  finally { console.log = log; console.error = error; }
  assert.equal(result.status, 'clipped', [...out, ...err].join('\n'));
  const written = readFileSync(join(root, 'raw', 'clippings', `${result.slug}.md`), 'utf8');
  return { result, out, err, title: /^title: "(.*)"$/m.exec(written)?.[1] };
}

// A local PDF on disk. Its bytes are never read: the text is injected.
function localPdf(t, name) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'wm-pdf-title-src-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  writeFileSync(file, '%PDF-1.4\n%%EOF\n');
  return file;
}

// A download that writes a stub PDF and records the folder it was given, so the test can check that folder is gone.
function fakeDownload() {
  const dirs = [];
  return {
    dirs,
    download: (_url, dest) => { dirs.push(dirname(dest)); writeFileSync(dest, '%PDF-1.4\n%%EOF\n'); return { ok: true }; },
  };
}

test('--title wins over a plausible pdfinfo title, for a local file and for an address', (t) => {
  const local = clip(t, localPdf(t, 'quarterly_notes.pdf'), ['--title=Chosen Name'], { pdfTitle: () => 'From The Document' });
  assert.equal(local.title, 'Chosen Name');
  assert.equal(local.result.titleSource, 'option');
  assert.deepEqual(local.err, []);

  const fetched = fakeDownload();
  const remote = clip(t, 'https://docs.example.test/files/quarterly_notes.pdf', ['--title=Chosen Name'], { pdfTitle: () => 'From The Document', download: fetched.download });
  assert.equal(remote.title, 'Chosen Name');
  assert.equal(remote.result.titleSource, 'option');
});

test('a plausible pdfinfo title names a local file, and pdfinfo is asked about that file', (t) => {
  const file = localPdf(t, 'quarterly_notes.pdf');
  const asked = [];
  const { title, result, err } = clip(t, file, [], { pdfTitle: (p) => { asked.push(p); return '  Quarterly Planning Notes  '; } });
  assert.deepEqual(asked, [file]);
  assert.equal(title, 'Quarterly Planning Notes');
  assert.equal(result.titleSource, 'pdfinfo');
  assert.deepEqual(err, [], 'no warning when the document names itself');
});

test('a plausible pdfinfo title names a download, and no temporary folder is left after the run', (t) => {
  const fetched = fakeDownload();
  const { title, result, err } = clip(t, 'https://docs.example.test/files/quarterly_notes.pdf?download=1', [], { pdfTitle: () => 'Quarterly Planning Notes', download: fetched.download });
  assert.equal(title, 'Quarterly Planning Notes');
  assert.equal(result.titleSource, 'pdfinfo');
  assert.deepEqual(err, []);
  assert.equal(fetched.dirs.length, 1);
  assert.equal(existsSync(fetched.dirs[0]), false, 'the download folder is removed');
});

// One row per rule of the junk filter. Each example is rejected and the clipping falls to the stem, with the warning.
const IMPLAUSIBLE = [
  ['shorter than 4 characters after trimming', ['Rpt', '  ab  ']],
  ['a placeholder word', ['Untitled', 'document', 'TITLE', 'None', 'null', 'Unknown', 'No Title']],
  ['a placeholder word with digits', ['Untitled1', 'Document12', 'no title3']],
  ['a "Microsoft Word -" prefix', ['Microsoft Word - Annual Program Summary']],
  ['a "Microsoft PowerPoint -" prefix', ['Microsoft PowerPoint - Annual Program Summary']],
  ['a "Microsoft Excel -" prefix', ['Microsoft Excel - Annual Program Summary']],
  ['a file extension', ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.pdf', '.tex', '.rtf', '.odt', '.indd'].map((ext) => `Annual Program Summary${ext}`)],
  ['a drive-letter path', ['C:\\Reports\\Annual Program Summary', 'd:/drafts/annual summary']],
  ['a / path', ['/home/someone/annual summary']],
  ['only digits, dots and dashes', ['2024-03-15', '1.2.3', '20240315']],
];
for (const [rule, examples] of IMPLAUSIBLE) {
  test(`a pdfinfo title that is ${rule} is rejected, and a local file falls to its stem with the warning`, (t) => {
    for (const junk of examples) {
      const { title, result, err } = clip(t, localPdf(t, 'quarterly_planning_notes.pdf'), [], { pdfTitle: () => junk });
      assert.equal(title, 'quarterly planning notes', junk);
      assert.equal(result.titleSource, 'stem', junk);
      assert.deepEqual(err, [warning('quarterly planning notes', 'the file name')], junk);
    }
  });
}

test('an address with a junk or missing pdfinfo title falls to its decoded last segment, warning "from the address"', (t) => {
  for (const pdfTitle of [() => 'Microsoft Word - draft.docx', () => null]) {
    const fetched = fakeDownload();
    const { title, result, err } = clip(t, 'https://docs.example.test/reports/Annual%20Review_2025.pdf?download=1', [], { pdfTitle, download: fetched.download });
    assert.equal(title, 'Annual Review 2025');
    assert.equal(result.titleSource, 'stem');
    assert.deepEqual(err, [warning('Annual Review 2025', 'the address')]);
    assert.equal(existsSync(fetched.dirs[0]), false, 'the download folder is removed');
  }
});

test('a local file with no pdfinfo title falls to its stem with the warning', (t) => {
  const { title, result, err } = clip(t, localPdf(t, 'Field_Survey_Methods.pdf'), [], { pdfTitle: () => null });
  assert.equal(title, 'Field Survey Methods');
  assert.equal(result.titleSource, 'stem');
  assert.deepEqual(err, [warning('Field Survey Methods', 'the file name')]);
});

test('titles near a rule but outside it are kept', () => {
  for (const kept of ['Maps', 'Document Management Guide', 'Untitled Territories', 'Title IX Compliance Review', '2024 Annual Report', 'Notes on Microsoft Word', 'A Guide to .pdf Files in Practice']) {
    assert.deepEqual(choosePdfTitle({ pdfinfo: kept, stem: 'x' }), { title: kept, titleSource: 'pdfinfo', warning: null }, kept);
  }
});

test('choosePdfTitle: an empty or blank --title does not count, and the warning names where the stem came from', () => {
  assert.deepEqual(choosePdfTitle({ option: '   ', pdfinfo: 'Field Survey Methods', stem: 'x' }), { title: 'Field Survey Methods', titleSource: 'pdfinfo', warning: null });
  assert.deepEqual(choosePdfTitle({ option: '', pdfinfo: null, stem: 'field survey' }), { title: 'field survey', titleSource: 'stem', warning: warning('field survey', 'the file name') });
  assert.deepEqual(choosePdfTitle({ pdfinfo: 'Rpt', stem: 'field survey', fromAddress: true }), { title: 'field survey', titleSource: 'stem', warning: warning('field survey', 'the address') });
});

test('the stem is the file name without .pdf, underscores as spaces, from either path separator', () => {
  assert.equal(titleFromPdf('/a/b/Regional_Transit_Cost_Study_Final.pdf'), 'Regional Transit Cost Study Final');
  assert.equal(titleFromPdf('paper.PDF'), 'paper');
  // A Windows-style path on any platform.
  assert.equal(titleFromPdf('C:\\x\\Bid_Tabs_2025.pdf'), 'Bid Tabs 2025');
  assert.equal(titleFromPdf('/x/.pdf'), 'untitled');
});

test('pdfinfoTitle reads the Title: line, and is null without the tool, without a title, or when pdfinfo fails', () => {
  const info = (text) => () => text;
  assert.equal(pdfinfoTitle('x.pdf', { tool: 'pdfinfo', run: info('Title:          Setup Guide\nPages:          3\n') }), 'Setup Guide');
  assert.equal(pdfinfoTitle('x.pdf', { tool: 'pdfinfo', run: info('Pages:          3\n') }), null);
  assert.equal(pdfinfoTitle('x.pdf', { tool: 'pdfinfo', run: info('Title:   \nPages: 3\n') }), null);
  assert.equal(pdfinfoTitle('x.pdf', { tool: null, run: () => assert.fail('no tool, no run') }), null);
  assert.equal(pdfinfoTitle('x.pdf', { tool: 'pdfinfo', run: () => { throw new Error('damaged'); } }), null);
});

const pdfinfo = resolveTool('pdfinfo');
test('a generated PDF with an /Info title is named by the real pdfinfo, and one without falls to its stem', { skip: pdfinfo ? false : 'pdfinfo not installed' }, (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'wm-pdf-title-info-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const titled = makePdf(prosePages(1), join(dir, 'titled_scan.pdf'), { info: { title: 'A Plausible Report Title' } });
  const bare = makePdf(prosePages(1), join(dir, 'bare_scan.pdf'));
  assert.equal(pdfinfoTitle(titled), 'A Plausible Report Title');
  assert.equal(pdfinfoTitle(bare), null);
  // Parentheses and a backslash in a title are escaped in the PDF string, so the file stays valid.
  const marked = makePdf(prosePages(1), join(dir, 'marked_scan.pdf'), { info: { title: 'A Report (Draft) on A\\B Methods' } });
  assert.equal(pdfinfoTitle(marked), 'A Report (Draft) on A\\B Methods');
  // The default pdfTitle dependency is the real pdfinfo, for a local file too.
  const named = clip(t, titled, [], {});
  assert.equal(named.title, 'A Plausible Report Title');
  assert.equal(named.result.titleSource, 'pdfinfo');
  const stem = clip(t, bare, [], {});
  assert.equal(stem.title, 'bare scan');
  assert.deepEqual(stem.err, [warning('bare scan', 'the file name')]);
  assert.deepEqual(readdirSync(dir).sort(), ['bare_scan.pdf', 'marked_scan.pdf', 'titled_scan.pdf']);
});
