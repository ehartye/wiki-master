import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, pdfToTextOcr, toolFailure } from '../scripts/clip-pdf.mjs';
import { gated, ocrCapability } from './helpers/pdf-tools.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

// The OCR fallback ran pdftoppm and Tesseract with no handling: a PDF the rasterizer could not open ended the clip with Node's stack
// trace, and nothing was written, declined or queued. A failed OCR tool is now an outcome like a failed download.

// What execFileSync throws for a tool that exits nonzero with its stderr piped.
const exited = (status, stderr) => Object.assign(new Error('Command failed'), { status, signal: null, stderr });
const XREF = "Syntax Error: Couldn't find trailer dictionary\nSyntax Error: Couldn't find trailer dictionary\nSyntax Error: Couldn't read xref table\n";

const READY = () => ({ ok: true, fatal: false, lines: [] });
const SOURCE = 'https://docs.example.test/files/scan.pdf';
const PROSE = Array.from({ length: 160 }, (_, i) => `word${i % 40}`).join(' ');

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-ocr-fail-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const pdf = join(root, 'scan.pdf');
  writeFileSync(pdf, '%PDF-1.4\n% a file no tool can open\n%%EOF\n');
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const read = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  return {
    root,
    pdf,
    names: () => readdirSync(join(root, 'raw', 'clippings')),
    clipping: (name) => readFileSync(join(root, 'raw', 'clippings', name), 'utf8'),
    declines: () => JSON.parse(read('declined.json') ?? '[]'),
    rows: () => (read('triage.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t === 'issue'),
  };
}

// main with console captured, the text layer supplied, and an OCR whose rasterizer fails the way the real one does. `dirs` is every
// temp folder the OCR pass was given: none may survive it.
function clip(argv, { text = '', run, ...deps } = {}) {
  const dirs = [];
  const failing = run ?? ((cmd, args) => { if (cmd === 'pdftoppm') { dirs.push(dirname(args.at(-1))); throw exited(1, XREF); } return ''; });
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const result = main(argv, {
      toolchain: READY, extractText: () => text, pdfTitle: () => null, ocrAvailable: () => true,
      ocrText: (pdfPath, options) => pdfToTextOcr(pdfPath, { ...options, run: failing }), ...deps,
    });
    return { result, lines, shown: lines.join('\n'), dirs };
  } finally { console.log = log; console.error = err; }
}
const noTrace = (shown) => !/^\s+at \S/m.test(shown) && !/Node\.js v\d/.test(shown) && !/Command failed/.test(shown);

test('toolFailure: one line with how the tool ended and its own words, repeats dropped and the temp paths left out', () => {
  assert.equal(
    toolFailure('pdftoppm', 'rasterize the PDF', exited(1, XREF)),
    "pdftoppm could not rasterize the PDF (exit 1): Syntax Error: Couldn't find trailer dictionary; Syntax Error: Couldn't read xref table",
  );
  assert.equal(toolFailure('pdftoppm', 'rasterize the PDF', exited(1, '')), 'pdftoppm could not rasterize the PDF (exit 1)');
  assert.equal(toolFailure('tesseract', 'recognize page 2 of 9', Object.assign(new Error('spawn'), { code: 'ENOENT' })), 'tesseract could not recognize page 2 of 9 (not found)');
  assert.equal(toolFailure('tesseract', 'recognize page 1 of 1', { status: null, signal: 'SIGKILL', stderr: '' }), 'tesseract could not recognize page 1 of 1 (stopped by SIGKILL)');
  const hidden = toolFailure('pdftoppm', 'rasterize the PDF', exited(1, "I/O Error: Couldn't open file '/work/tmp-7/download.pdf'"), ['/work/tmp-7/download.pdf']);
  assert.equal(hidden, "pdftoppm could not rasterize the PDF (exit 1): I/O Error: Couldn't open file '<temp>'");
  assert.ok(toolFailure('pdftoppm', 'rasterize the PDF', exited(1, 'x'.repeat(5000))).length < 260, 'a long error is cut');
});

test('pdfToTextOcr: a rasterizer that fails throws its one line and leaves no temp folder', () => {
  let dir;
  const run = (cmd, args) => { dir = dirname(args.at(-1)); assert.ok(existsSync(dir)); throw exited(1, XREF); };
  assert.throws(() => pdfToTextOcr('scan.pdf', { run }), (e) => {
    assert.match(e.message, /^pdftoppm could not rasterize the PDF \(exit 1\): Syntax Error: Couldn't find trailer dictionary; /);
    return true;
  });
  assert.equal(existsSync(dir), false, 'the temp folder is removed');
});

test('pdfToTextOcr: a recognizer that fails on one page names the page and leaves no temp folder', () => {
  let dir;
  const run = (cmd, args) => {
    if (cmd === 'pdftoppm') {
      dir = dirname(args.at(-1));
      for (const n of [1, 2, 3]) writeFileSync(`${args.at(-1)}-${n}.png`, 'image bytes');
      return '';
    }
    if (args[0].endsWith('-2.png')) throw exited(1, 'Error in pixReadStream: Unknown format: no pix returned');
    return 'recognized text';
  };
  assert.throws(() => pdfToTextOcr('scan.pdf', { run }), /^Error: tesseract could not recognize page 2 of 3 \(exit 1\): Error in pixReadStream/);
  assert.equal(existsSync(dir), false);
});

test('pdfToTextOcr: pages are recognized in page order and joined with a form feed', () => {
  const run = (cmd, args) => {
    if (cmd === 'pdftoppm') { for (const n of [10, 2, 1]) writeFileSync(`${args.at(-1)}-${n}.png`, 'image bytes'); return ''; }
    return `page ${/-(\d+)\.png$/.exec(args[0])[1]}`;
  };
  assert.equal(pdfToTextOcr('scan.pdf', { run }), ['page 1', 'page 2', 'page 10'].join('\f'));
});

test('a thin text layer whose OCR rasterizer fails: one clip failed line, a failed row with the topic, no decline, no clipping', (t) => {
  const v = vault(t);
  const { result, lines, shown, dirs } = clip([v.pdf, `--source=${SOURCE}`, '--topic=Scans', '--title=A scan']);
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /^OCR failed: pdftoppm could not rasterize the PDF \(exit 1\): Syntax Error: Couldn't find trailer dictionary/);
  const failed = lines.filter((l) => l.startsWith('clip failed'));
  assert.equal(failed.length, 1);
  assert.equal(failed[0], `clip failed — ${result.reason} (queued for triage): ${SOURCE}`);
  assert.ok(noTrace(shown), shown);
  assert.deepEqual(v.names(), []);
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows().map((r) => [r.url, r.kind, r.topic, r.reason]), [[SOURCE, 'failed', 'Scans', result.reason]]);
  assert.equal(dirs.length, 1);
  assert.equal(existsSync(dirs[0]), false, 'the OCR temp folder is removed');
  assert.ok(!shown.includes(dirs[0]), 'the output does not name the temp folder');
});

test('--ocr whose rasterizer fails ends the same way', (t) => {
  const v = vault(t);
  const { result, shown } = clip([v.pdf, `--source=${SOURCE}`, '--ocr'], { text: PROSE });
  assert.equal(result.status, 'failed');
  assert.match(shown, /clip failed — OCR failed: pdftoppm could not rasterize the PDF \(exit 1\)/);
  assert.ok(noTrace(shown), shown);
  assert.deepEqual(v.names(), []);
  assert.deepEqual(v.declines(), []);
  assert.equal(v.rows()[0].kind, 'failed');
});

test('a degraded text layer whose OCR fails is still clipped, as degraded, with a warning', (t) => {
  const v = vault(t);
  const degraded = `${PROSE} ${'� '.repeat(40)}`;
  const { result, shown } = clip([v.pdf, `--source=${SOURCE}`], { text: degraded });
  assert.equal(result.status, 'clipped', shown);
  assert.match(shown, /WARNING: OCR failed, so the degraded text layer is kept: pdftoppm could not rasterize the PDF \(exit 1\)/);
  assert.match(v.clipping(`${result.slug}.md`), /^fidelity: degraded$/m);
  assert.deepEqual(v.rows(), []);
  assert.ok(noTrace(shown), shown);
});

test('an OCR that reads nothing is still the thin outcome, with its decline', (t) => {
  const v = vault(t);
  const { result } = clip([v.pdf, `--source=${SOURCE}`], { ocrText: () => '' });
  assert.equal(result.status, 'thin');
  assert.equal(v.declines().length, 1);
});

// The OCR gate is the product's own: ocrReachable, which needs pdftoppm -v and tesseract --version to exit 0. A presence
// check let Xpdf's pdftoppm (exit 99 on -v) through, and the command then reported no OCR toolchain at all.
test('the OCR gate follows ocrReachable, and names the tool and what it found otherwise', () => {
  const probe = (command, args, outcome, status, stdout = '') => ({ command, args, outcome, status, stdout, stderr: '' });
  const passed = [probe('pdftoppm', ['-v'], 'passed', 0), probe('tesseract', ['--version'], 'passed', 0)];
  const diagnosis = (probes = passed) => ({ capabilities: { ocrRuntimeGate: { probes } } });
  // `text` is the pdftotext gate: the command reads the PDF's text layer before it decides on OCR.
  const reads = { ok: true, reason: null };
  const crashes = { ok: false, reason: 'needs a pdftotext that reads a PDF; pdftotext crashed (exit 3221225477) reading a one-page fixture' };
  assert.deepEqual(ocrCapability({ reachable: true, text: reads, diagnosis: diagnosis() }), { ok: true, reason: null });
  const xpdf = [probe('pdftoppm', ['-v'], 'unusable', 99, 'pdftoppm version 4.06 [www.xpdfreader.com]\n'), passed[1]];
  assert.deepEqual(ocrCapability({ reachable: false, text: reads, diagnosis: diagnosis(xpdf) }), { ok: false, reason: 'needs Poppler pdftoppm and tesseract for OCR; found a pdftoppm that exits 99 on -v (Xpdf)' });
  const noTesseract = [passed[0], { command: 'tesseract', args: ['--version'], outcome: 'missing' }];
  assert.equal(ocrCapability({ reachable: false, text: reads, diagnosis: diagnosis(noTesseract) }).reason, 'needs Poppler pdftoppm and tesseract for OCR; found no tesseract');
  assert.deepEqual(ocrCapability({ reachable: true, text: crashes, diagnosis: diagnosis() }), crashes);
  // ocrReachable decides, even when the doctor's probes disagree with it.
  assert.equal(ocrCapability({ reachable: false, text: reads, diagnosis: diagnosis() }).ok, false);
  assert.equal(ocrCapability({ reachable: true, text: reads, diagnosis: diagnosis(xpdf) }).ok, true);
});

// The whole command against the real tools, where they are usable: the file starts like a PDF and nothing can open it.
test('clip-pdf.mjs on a PDF that no tool can open prints no stack trace and exits like other failed captures', gated('ocr', (t) => {
  const v = vault(t);
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'clip-pdf.mjs'), v.pdf, `--source=${SOURCE}`, '--topic=Scans', '--title=A scan'], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
  const shown = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, shown);
  assert.match(r.stdout, /^clip failed — OCR failed: pdftoppm could not rasterize the PDF \(exit \d+\).* \(queued for triage\): https:\/\/docs\.example\.test\/files\/scan\.pdf$/m);
  assert.ok(noTrace(shown), shown);
  assert.deepEqual(v.names(), []);
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows().map((row) => [row.url, row.kind, row.topic]), [[SOURCE, 'failed', 'Scans']]);
}));
