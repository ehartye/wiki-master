import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  parseFigureArgs, parsePageList, parsePdfimagesList, selectRasterPages, countSvgDrawing,
  selectVectorPages, planFigurePages, figureSidecar, setClippingFigures, resolveTool,
  wingetPopplerBins, renderFigures, resolveFigureTools, readFigureIndex, frontmatterOf, fmScalar,
} from '../scripts/lib/pdf-figures.mjs';
import { main as clipMain, pdfClipContent } from '../scripts/clip-pdf.mjs';
import { beginOp } from '../scripts/op-begin.mjs';
import { commitOp } from '../scripts/op-commit.mjs';
import { buildGraph, computeGraphMetrics } from '../scripts/lib/graph.mjs';
import { scanIntegrity } from '../scripts/health.mjs';

// ------------------------------------------------------------------ arguments

test('parseFigureArgs: bare --figures means auto; explicit modes and page lists parse', () => {
  assert.equal(parseFigureArgs(['a.pdf']).enabled, false);
  const bare = parseFigureArgs(['a.pdf', '--figures']);
  assert.deepEqual([bare.enabled, bare.mode], [true, 'auto']);
  assert.equal(parseFigureArgs(['--figures=all']).mode, 'all');
  const list = parseFigureArgs(['--figures=3,5-7']);
  assert.deepEqual([list.mode, list.pages], ['list', [3, 5, 6, 7]]);
  assert.equal(parseFigureArgs(['--figures', '--figures-max=12']).max, 12);
  assert.equal(parseFigureArgs(['--figures']).max, 40);
});

test('parseFigureArgs: malformed values are refused, not silently ignored', () => {
  assert.throws(() => parseFigureArgs(['--figures=3,x']), /invalid page list/);
  assert.throws(() => parseFigureArgs(['--figures=7-3']), /invalid page range/);
  assert.throws(() => parseFigureArgs(['--figures=0']), /invalid page range/);
  assert.throws(() => parseFigureArgs(['--figures-max=0']), /positive integer/);
  assert.throws(() => parseFigureArgs(['--figures-only']), /--clipping/);
  assert.throws(() => parseFigureArgs(['--clipping=x.md']), /--figures-only/);
});

test('parseFigureArgs: --figures-only takes --clipping as "=" or as a following argument', () => {
  const a = parseFigureArgs(['p.pdf', '--figures-only', '--clipping', 'raw/clippings/x.md']);
  assert.deepEqual([a.only, a.enabled, a.clipping], [true, true, 'raw/clippings/x.md']);
  assert.equal(parseFigureArgs(['--figures-only', '--clipping=y.md']).clipping, 'y.md');
});

test('parsePageList sorts and de-duplicates', () => {
  assert.deepEqual(parsePageList('5-6,2,5'), [2, 5, 6]);
});

// ------------------------------------------------------------------ detection

// Verbatim `pdfimages -list` output from the two reference documents.
const FMDOC3_LIST = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
  13     0 image     394   312  index   1   8  image  no        48  0   200   200  120K 100%
  13     1 smask     394   312  gray    1   8  image  no        48  0   200   200  120K 100%
  13     2 image     186   104  icc     3   8  image  no        50  0   199   200 56.7K 100%
  13     3 smask     186   104  gray    1   8  image  no        50  0   199   200 18.9K 100%`;

test('parsePdfimagesList reads poppler rows and skips headers', () => {
  const rows = parsePdfimagesList(FMDOC3_LIST);
  assert.equal(rows.length, 4);
  assert.deepEqual([rows[0].page, rows[0].type, rows[0].width, rows[0].xppi], [13, 'image', 394, 200]);
});

test('selectRasterPages ignores smasks, tiny icons and repeated header logos', () => {
  const row = (page, over = {}) => ({ page, type: 'image', width: 800, height: 600, object: `${page}:0`, xppi: 200, yppi: 200, ...over });
  const rows = [
    row(2, { type: 'smask' }),                    // alpha channel of an image, not a figure
    row(3, { width: 32, height: 32 }),            // icon, by pixels
    row(4, { width: 400, height: 400, xppi: 800, yppi: 800 }), // 0.5in square: a bullet, by size on page
    row(5),                                       // a real figure
    ...[1, 2, 3, 4, 5, 6].map((p) => ({ ...row(p), object: '99:0' })), // logo on every page
    row(6, { object: '7:0' }),
  ];
  assert.deepEqual(selectRasterPages(rows, 6), [6, 5].sort((a, b) => a - b));
});

test('selectRasterPages on the FMDOC3 reference keeps page 13 (two real rasters)', () => {
  assert.deepEqual(selectRasterPages(parsePdfimagesList(FMDOC3_LIST), 14), [13]);
});

test('countSvgDrawing counts body drawing and ignores glyph, clip and mask definitions', () => {
  const svg = `<svg><defs><g id="g1"><path d="M0 0"/><path d="M1 1"/></g><clipPath id="c"><path d="M0 0"/></clipPath></defs>
    <use xlink:href="#g1"/><path d="M0 0 L1 1"/><path d="M2 2 L3 3"/><rect width="1" height="1"/></svg>`;
  assert.equal(countSvgDrawing(svg), 3);
});

const page = (n, chars, paths) => ({ page: n, chars, paths });

test('selectVectorPages: a text-light, heavily drawn page is a figure; a prose page with a ruled table is not', () => {
  const stats = [page(1, 3000, 4), page(2, 3100, 35), page(3, 900, 400), page(4, 2900, 2), page(5, 3000, 5)];
  assert.deepEqual(selectVectorPages(stats), [3]);
});

test('selectVectorPages: a text-heavy page with a very dense drawing still counts', () => {
  assert.deepEqual(selectVectorPages([page(1, 3000, 3), page(2, 2900, 3), page(3, 3000, 900)]), [3]);
});

test('selectVectorPages: a document with no text layer (outlined text) selects every drawn page', () => {
  const stats = [page(1, 0, 1784), page(2, 0, 2465), page(3, 0, 20)];
  assert.deepEqual(selectVectorPages(stats), [1, 2]);
});

test('selectVectorPages: few drawing paths never qualify, however little text', () => {
  assert.deepEqual(selectVectorPages([page(1, 0, 5), page(2, 3000, 5)]), []);
});

test('planFigurePages: auto unions raster and vector with their kinds; all and lists override; the cap truncates', () => {
  const auto = planFigurePages({ mode: 'auto', pageCount: 10, raster: [2, 6], vector: [6, 9] });
  assert.deepEqual(auto.pages, [{ page: 2, kinds: ['raster'] }, { page: 6, kinds: ['raster', 'vector'] }, { page: 9, kinds: ['vector'] }]);
  assert.equal(planFigurePages({ mode: 'all', pageCount: 4 }).pages.length, 4);
  assert.deepEqual(planFigurePages({ mode: 'list', pageCount: 9, requested: [3, 7] }).pages.map((p) => p.page), [3, 7]);
  assert.throws(() => planFigurePages({ mode: 'list', pageCount: 5, requested: [3, 9] }), /beyond the document's 5 pages/);
  const capped = planFigurePages({ mode: 'all', pageCount: 100, max: 40 });
  assert.deepEqual([capped.pages.length, capped.total, capped.capped], [40, 100, true]);
});

// ------------------------------------------------------------------ sidecar

test('figureSidecar follows the vault convention and has no placeholders', () => {
  const md = figureSidecar({ title: 'Flight Model', source: 'https://x.test/a.pdf', page: 4, sha256: 'ab'.repeat(32), captured: '2026-10-07', clippingPath: 'raw/clippings/Flight Model.md', kinds: ['vector'] });
  const fm = frontmatterOf(md);
  assert.equal(fmScalar(fm, 'source'), 'https://x.test/a.pdf');
  assert.deepEqual(['page', 'crop', 'dpi', 'captured', 'ai-generated'].map((k) => fmScalar(fm, k)), ['4', 'full', '200', '2026-10-07', 'false']);
  assert.equal(fmScalar(fm, 'sha256'), 'ab'.repeat(32));
  assert.equal(fmScalar(fm, 'clipping'), '[[raw/clippings/Flight Model.md]]');
  assert.match(md, /\n# Flight Model, page 4\n/);
  assert.match(md, /Page 4 of Flight Model: rendered at 200 dpi; figure candidates detected: vector\./);
  assert.doesNotMatch(md, /TODO|TBD|placeholder|<[a-z ]+>/i);
});

// ------------------------------------------------------------------ clipping frontmatter

const CLIP = `---
title: "Doc"
source: "https://x.test/d.pdf"
created: 2026-10-07
tags: [clippings]
quality: medium
source-hash: ${'c'.repeat(64)}
---

# Body

Some text with ---
dashes.
`;

test('setClippingFigures edits the frontmatter only: the body is byte-identical', () => {
  const out = setClippingFigures(CLIP, ['raw/figures/doc-p2.md', 'raw/figures/doc-p10.md']);
  const body = (t) => t.slice(t.indexOf('\n---\n', 4) + 5);
  assert.equal(body(out), body(CLIP));
  assert.match(out, /\nsource-hash: c{64}\nfigures: \["raw\/figures\/doc-p2\.md", "raw\/figures\/doc-p10\.md"\]\n---\n/);
  // source-hash stays inside the first 800 bytes readClippingHashes reads.
  assert.ok(out.indexOf('source-hash') < 800);
});

test('setClippingFigures is idempotent and merges, ordering by page number', () => {
  const once = setClippingFigures(CLIP, ['raw/figures/doc-p10.md']);
  assert.equal(setClippingFigures(once, ['raw/figures/doc-p10.md']), once);
  const merged = setClippingFigures(once, ['raw/figures/doc-p2.md']);
  assert.match(merged, /figures: \["raw\/figures\/doc-p2\.md", "raw\/figures\/doc-p10\.md"\]/);
  assert.equal((merged.match(/^figures:/gm) || []).length, 1);
});

test('setClippingFigures keeps CRLF files CRLF and upgrades a block list', () => {
  const crlf = CLIP.replace(/\n/g, '\r\n');
  assert.ok(!/[^\r]\nfigures/.test(setClippingFigures(crlf, ['raw/figures/doc-p1.md'])));
  const block = CLIP.replace('---\n\n# Body', 'figures:\n  - raw/figures/doc-p3.md\n---\n\n# Body');
  const out = setClippingFigures(block, ['raw/figures/doc-p1.md']);
  assert.match(out, /figures: \["raw\/figures\/doc-p1\.md", "raw\/figures\/doc-p3\.md"\]\n---\n\n# Body/);
});

test('a clipping with figures: still hash-joins and is not flagged by the graph scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-fig-graph-'));
  try {
    mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
    mkdirSync(join(dir, 'raw', 'figures'), { recursive: true });
    mkdirSync(join(dir, 'wiki', 'sources'), { recursive: true });
    const clip = pdfClipContent({ title: 'Doc', source: 'x.pdf', text: 'word '.repeat(150) });
    writeFileSync(join(dir, 'raw', 'clippings', 'Doc.md'), setClippingFigures(clip.body, ['raw/figures/Doc-p1.md']));
    writeFileSync(join(dir, 'raw', 'figures', 'Doc-p1.md'), figureSidecar({ title: 'Doc', source: 'x.pdf', page: 1, sha256: 'a'.repeat(64), captured: '2026-10-07', clippingPath: 'raw/clippings/Doc.md', kinds: ['raster'] }));
    writeFileSync(join(dir, 'raw', 'figures', 'Doc-p1.png'), Buffer.from([137, 80, 78, 71]));
    const before = computeGraphMetrics(buildGraph(dir));
    // Unsummarized: only the clipping. Figures are neither clippings nor backlog.
    assert.deepEqual(before.unsummarizedSources, ['raw/clippings/Doc.md']);
    assert.deepEqual(before.missingHash, []);
    assert.deepEqual(before.unparsedSources, ['raw/clippings/Doc.md']);
    // Summarising the clipping by hash clears the backlog entirely.
    writeFileSync(join(dir, 'wiki', 'sources', 'Doc.md'), `---\ntype: source\nsources: ["[[raw/clippings/Doc.md]]"]\nsource-hashes: [${clip.hash}]\n---\n# Doc\n\nSummary text of the document with a few words in it for the stub floor. ![[raw/figures/Doc-p1.png]]\n`);
    const after = computeGraphMetrics(buildGraph(dir));
    assert.deepEqual(after.unsummarizedSources, []);
    assert.deepEqual(after.unparsedSources, []);
    assert.deepEqual(after.missingHash, []);
    assert.equal(scanIntegrity(dir).defectCount, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ tool resolution

test('resolveTool prefers PATH, then falls back to the winget poppler directory', () => {
  const enoent = Object.assign(new Error('nope'), { code: 'ENOENT' });
  const onPath = resolveTool('pdftoppm', { run: () => '', bins: ['C:/w'], exists: () => true });
  assert.equal(onPath, 'pdftoppm');
  const run = (cmd) => { if (cmd === 'pdftoppm') throw enoent; return ''; };
  const exists = (p) => p.replaceAll('\\', '/') === 'C:/w/pdftoppm.exe';
  assert.equal(resolveTool('pdftoppm', { run, bins: ['C:/w'], exists }).replaceAll('\\', '/'), 'C:/w/pdftoppm.exe');
  assert.equal(resolveTool('pdftoppm', { run, bins: [], exists: () => false }), null);
});

test('resolveTool: a nonzero exit from -v still means installed', () => {
  assert.equal(resolveTool('pdfimages', { run: () => { throw Object.assign(new Error('x'), { status: 1 }); }, bins: [] }), 'pdfimages');
});

test('wingetPopplerBins finds the Library/bin of the newest poppler package', () => {
  const tree = { base: ['oschwartz10612.Poppler_X', 'other.Pkg'], pkg: ['poppler-24.08.0', 'poppler-25.07.0'] };
  const list = (p) => (p.endsWith('Packages') ? tree.base : tree.pkg);
  const bins = wingetPopplerBins({ LOCALAPPDATA: 'C:/L' }, { list, exists: () => true }).map((b) => b.replaceAll('\\', '/'));
  assert.match(bins[0], /poppler-25\.07\.0\/Library\/bin$/);
  assert.deepEqual(wingetPopplerBins({}, { list, exists: () => true }), []);
});

test('renderFigures without pdftoppm is a clear, non-fatal skip', () => {
  const r = renderFigures({ pdfPath: 'x.pdf', vaultPath: tmpdir(), clippingPath: 'raw/clippings/x.md', title: 'x', source: 'x', selection: { mode: 'auto', max: 40 }, tools: { pdftoppm: null } });
  assert.equal(r.status, 'skipped');
  assert.match(r.message, /pdftoppm not found.*poppler/);
  assert.deepEqual(r.figures, []);
});

// ------------------------------------------------------------------ real poppler

const tools = resolveFigureTools();
const HAVE_POPPLER = Boolean(tools.pdftoppm && tools.pdfimages && tools.pdftocairo && tools.pdfinfo && tools.pdftotext);
const real = { skip: HAVE_POPPLER ? false : 'poppler not installed' };

// Three pages: prose, a vector plot with almost no text, and an embedded raster.
function buildPdf(out) {
  const prose = Array.from({ length: 40 }, (_, i) => `BT /F1 10 Tf 1 0 0 1 60 ${760 - i * 16} Tm (Paragraph line ${i} of ordinary prose that fills the page with text.) Tj ET`).join('\n');
  let plot = 'BT /F1 10 Tf 1 0 0 1 60 760 Tm (Fig) Tj ET\n0.5 w\n';
  for (let i = 0; i < 300; i++) plot += `${60 + (i * 7) % 480} ${100 + (i * 13) % 560} m ${70 + (i * 11) % 470} ${120 + (i * 17) % 540} l S\n`;
  const rasterPage = `q 300 0 0 300 100 300 cm /Im1 Do Q\nBT /F1 10 Tf 1 0 0 1 60 760 Tm (Photo) Tj ET`;
  const pix = Buffer.alloc(120 * 120, 0).map((_, i) => (i * 7) % 256).toString('latin1');
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [5 0 R 7 0 R 9 0 R] /Count 3 >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objs[4] = { dict: '/Type /XObject /Subtype /Image /Width 120 /Height 120 /ColorSpace /DeviceGray /BitsPerComponent 8', stream: pix };
  [prose, plot, rasterPage].forEach((c, i) => {
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = { dict: '', stream: c };
  });
  let pdf = '%PDF-1.4\n';
  const offs = [];
  for (let i = 1; i < objs.length; i++) {
    offs[i] = pdf.length;
    const o = objs[i];
    pdf += typeof o === 'string' ? `${i} 0 obj\n${o}\nendobj\n` : `${i} 0 obj\n<< ${o.dict} /Length ${o.stream.length} >>\nstream\n${o.stream}\nendstream\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(out, pdf, 'latin1');
}

function tempVault() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-fig-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '.wiki-master/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  return dir;
}

test('auto picks the vector plot and the embedded raster, not the prose page', real, () => {
  const dir = tempVault();
  try {
    const pdf = join(dir, 'in.pdf'); buildPdf(pdf);
    const r = renderFigures({ pdfPath: pdf, vaultPath: dir, clippingPath: 'raw/clippings/Doc.md', title: 'Doc', source: pdf, selection: { mode: 'auto', max: 40 }, log: () => {} });
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.plan.pages, [{ page: 2, kinds: ['vector'] }, { page: 3, kinds: ['raster'] }]);
    const fm = frontmatterOf(readFileSync(join(dir, 'raw', 'figures', 'Doc-p2.md'), 'utf8'));
    const png = readFileSync(join(dir, 'raw', 'figures', 'Doc-p2.png'));
    assert.equal(fmScalar(fm, 'sha256'), createHash('sha256').update(png).digest('hex'));
    assert.deepEqual(png.subarray(1, 4), Buffer.from('PNG'));
    assert.deepEqual(r.figures, ['raw/figures/Doc-p2.md', 'raw/figures/Doc-p3.md']);
    // Page 2 at 200 dpi on a 612x792pt page is 1700x2200.
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1700, 2200]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rendering is idempotent, dedupes identical images, and respects hand-cropped figures', real, () => {
  const dir = tempVault();
  try {
    const pdf = join(dir, 'in.pdf'); buildPdf(pdf);
    const args = (slug, mode = 'list', pages = [2, 3]) => ({ pdfPath: pdf, vaultPath: dir, clippingPath: `raw/clippings/${slug}.md`, title: slug, source: pdf, selection: { mode, pages, max: 40 }, log: () => {} });
    renderFigures(args('Doc'));
    const again = renderFigures(args('Doc'));
    assert.equal(again.written.length, 0);
    assert.equal(again.unchanged.length, 2);
    // The same PDF clipped under another slug stores no second copy of the image.
    const other = renderFigures(args('Other'));
    assert.equal(other.written.length, 0);
    assert.equal(other.duplicates.length, 2);
    assert.deepEqual(readdirSync(join(dir, 'raw', 'figures')).sort(), ['Doc-p2.md', 'Doc-p2.png', 'Doc-p3.md', 'Doc-p3.png']);
    assert.equal(readFigureIndex(join(dir, 'raw', 'figures')).size, 2);
    // A hand-cropped figure at the same slug is never overwritten.
    const md = join(dir, 'raw', 'figures', 'Doc-p2.md');
    writeFileSync(md, readFileSync(md, 'utf8').replace('crop: full', 'crop: 10,10,500,500'));
    const kept = renderFigures(args('Doc'));
    assert.deepEqual(kept.kept, ['raw/figures/Doc-p2.md']);
    assert.match(readFileSync(md, 'utf8'), /crop: 10,10,500,500/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('explicit page lists and "all" render exactly those pages; a bad page is an error', real, () => {
  const dir = tempVault();
  try {
    const pdf = join(dir, 'in.pdf'); buildPdf(pdf);
    const r = renderFigures({ pdfPath: pdf, vaultPath: dir, clippingPath: 'raw/clippings/D.md', title: 'D', source: pdf, selection: { mode: 'list', pages: [1], max: 40 }, log: () => {} });
    assert.deepEqual(r.figures, ['raw/figures/D-p1.md']);
    assert.match(readFileSync(join(dir, 'raw', 'figures', 'D-p1.md'), 'utf8'), /none detected \(page selected by request/);
    assert.throws(() => renderFigures({ pdfPath: pdf, vaultPath: dir, clippingPath: 'raw/clippings/D.md', title: 'D', source: pdf, selection: { mode: 'list', pages: [9], max: 40 }, log: () => {} }), /beyond the document's 3 pages/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --figures-only on an existing clipping, inside the operation bracket.
test('--figures-only renders for an existing clipping, edits only its frontmatter, and op-commit picks everything up', real, () => {
  const dir = tempVault();
  const prev = process.env.WIKI_MASTER_VAULT;
  try {
    const pdf = join(dir, 'in.pdf'); buildPdf(pdf);
    const text = execFileSync(tools.pdftotext, ['-q', '-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8' });
    const clip = pdfClipContent({ title: 'in', source: pdf, text });
    const clipFile = join(dir, 'raw', 'clippings', 'in.md');
    writeFileSync(clipFile, clip.body);
    execFileSync('git', ['add', '-A'], { cwd: dir }); execFileSync('git', ['commit', '-q', '-m', 'clip'], { cwd: dir });
    process.env.WIKI_MASTER_VAULT = dir;

    const token = beginOp(dir, 'clip-pdf');
    const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
    let res;
    try { res = clipMain([pdf, '--figures-only', '--clipping', 'raw/clippings/in.md']); } finally { console.log = orig; }
    assert.equal(res.status, 'figures');
    assert.equal(res.verified, 'match-text');

    const after = readFileSync(clipFile, 'utf8');
    assert.match(after, /\nfigures: \["raw\/figures\/in-p2\.md", "raw\/figures\/in-p3\.md"\]\n---/);
    assert.equal(after.slice(after.indexOf('\n---\n', 4)), clip.body.slice(clip.body.indexOf('\n---\n', 4)), 'body untouched');

    const commit = commitOp(dir, { op: 'clip-pdf', title: 'figures', token });
    assert.equal(commit.committed, true);
    assert.deepEqual(commit.paths, ['raw/clippings/in.md', 'raw/figures/in-p2.md', 'raw/figures/in-p2.png', 'raw/figures/in-p3.md', 'raw/figures/in-p3.png']);
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim(), '');

    // Re-running changes nothing at all.
    const token2 = beginOp(dir, 'clip-pdf');
    console.log = () => {};
    try { clipMain([pdf, '--figures-only', '--clipping', join(dir, 'raw', 'clippings', 'in.md')]); } finally { console.log = orig; }
    assert.equal(commitOp(dir, { op: 'clip-pdf', title: 'noop', token: token2 }).committed, false);

    // Ingest backlog is exactly the clipping; figure sidecars add nothing.
    const m = computeGraphMetrics(buildGraph(dir));
    assert.deepEqual(m.unsummarizedSources, ['raw/clippings/in.md']);
    assert.deepEqual(m.missingHash, []);
  } finally {
    if (prev === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--figures-only refuses a PDF that is not the clipping\'s source, unless told otherwise', real, () => {
  const dir = tempVault();
  const prev = process.env.WIKI_MASTER_VAULT;
  try {
    const pdf = join(dir, 'in.pdf'); buildPdf(pdf);
    const clip = pdfClipContent({ title: 'in', source: pdf, text: 'a completely different document '.repeat(40) });
    writeFileSync(join(dir, 'raw', 'clippings', 'in.md'), clip.body);
    process.env.WIKI_MASTER_VAULT = dir;
    const origErr = console.error; const errs = []; console.error = (...a) => errs.push(a.join(' '));
    const exit = process.exit; let code;
    process.exit = (c) => { code = c; throw new Error('exit'); };
    try { assert.throws(() => clipMain([pdf, '--figures-only', '--clipping', 'raw/clippings/in.md']), /exit/); }
    finally { process.exit = exit; console.error = origErr; }
    assert.equal(code, 1);
    assert.match(errs.join('\n'), /does not match/);
    assert.equal(existsSync(join(dir, 'raw', 'figures')), false, 'nothing was written');
    const orig = console.log; console.log = () => {}; console.error = () => {};
    try { const r = clipMain([pdf, '--figures-only', '--clipping', 'raw/clippings/in.md', '--allow-pdf-mismatch']); assert.equal(r.verified, 'mismatch-allowed'); }
    finally { console.log = orig; console.error = origErr; }
  } finally {
    if (prev === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--figures-only on a clipping with no source-hash warns instead of refusing', real, () => {
  const dir = tempVault();
  const prev = process.env.WIKI_MASTER_VAULT;
  try {
    const pdf = join(dir, 'in.pdf'); buildPdf(pdf);
    writeFileSync(join(dir, 'raw', 'clippings', 'old.md'), '---\ntitle: "old"\nsource: "https://x.test/old.pdf"\ncreated: 2026-01-01\ntags: [clippings]\n---\n\nbody\n');
    process.env.WIKI_MASTER_VAULT = dir;
    const origErr = console.error; const origLog = console.log; const errs = [];
    console.error = (...a) => errs.push(a.join(' ')); console.log = () => {};
    let r;
    try { r = clipMain([pdf, '--figures-only', '--clipping', 'raw/clippings/old.md', '--figures=2']); } finally { console.error = origErr; console.log = origLog; }
    assert.equal(r.verified, 'no-hash');
    assert.match(errs.join('\n'), /no source-hash/);
    assert.match(readFileSync(join(dir, 'raw', 'figures', 'old-p2.md'), 'utf8'), /source: "https:\/\/x\.test\/old\.pdf"/);
  } finally {
    if (prev === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
