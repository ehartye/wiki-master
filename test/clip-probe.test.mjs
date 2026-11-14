/** @lane merge
 * @subject scripts/lib/clip-probe.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as clipPage } from '../scripts/clip.mjs';
import { main as clipPdf, pdfToTextOcr, pdfPageCount } from '../scripts/clip-pdf.mjs';
import { CLIP_SPECS, checkClipArgs, probeConflict } from '../scripts/lib/clip-args.mjs';
import { PROBE_OCR_PAGES } from '../scripts/lib/clip-probe.mjs';
import { makePdf } from './fixtures/make-pdf.mjs';

// `--probe` answers "what would a clip of this do?" by running the clipper's own function with its vault writers replaced by
// recorders, and stopping before the write. Two things are pinned here: the answer is the real clip's answer, and the vault
// is byte-for-byte what it was. Fetching, extraction, the browser and OCR are injected, so nothing reaches the network.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(' ');
const article = (title, n = 150) => ({ title, contentMarkdown: `# ${title}\n\n${words(n)}` });
const NO_BROWSER = () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'No browser' });
const NO_TWIN = () => ({ ok: false, reason: 'status 404' });
const HELD = 'https://held.example.test/guide';
const DECLINED = 'https://declined.example.test/page';

// Every file under the vault with the hash of its bytes, and every folder: a probe may not add, remove or change one.
function snapshot(root) {
  const seen = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const at = join(dir, name), key = rel ? `${rel}/${name}` : name;
      if (statSync(at).isDirectory()) { seen[`${key}/`] = 'dir'; walk(at, key); }
      else seen[key] = createHash('sha256').update(readFileSync(at)).digest('hex');
    }
  };
  walk(root, '');
  return seen;
}

// A vault that already holds a clipping, an active decline, an open triage row and a log entry: each store a clip writes to
// exists, so a probe that appended to one would change its hash.
function vault(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-clip-probe-'));
  for (const dir of ['raw/clippings', '.wiki-master', 'log']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'raw', 'clippings', 'held-guide.md'), `---\ntitle: "Held Guide"\nsource: "${HELD}"\ncreated: 2026-01-02\ntags: [clippings]\nquality: high\nsource-hash: abc\n---\n\n${words(150)}\n`);
  writeFileSync(join(root, '.wiki-master', 'declined.json'), JSON.stringify([{ url: DECLINED, reason: 'not a primary source', date: new Date().toISOString().slice(0, 10) }], null, 2));
  writeFileSync(join(root, '.wiki-master', 'triage.jsonl'), `${JSON.stringify({ t: 'issue', at: '2026-01-02T00:00:00.000Z', url: HELD, kind: 'failed', reason: 'fetch failed' })}\n`);
  writeFileSync(join(root, 'log', '2026-01-02.md'), '# 2026-01-02\n\n- an earlier entry\n');
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  return { root, before: snapshot(root), unchanged() { assert.deepEqual(snapshot(root), this.before, 'the vault is what it was'); } };
}

// Runs a clipper's main with console captured; returns what it returned, the parsed JSON lines of stdout, and the exit code it left.
function run(main, argv, deps = {}) {
  const out = [], err = [];
  const log = console.log, error = console.error, exit = process.exit, code = process.exitCode;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  process.exit = (c) => { throw Object.assign(new Error(`process.exit(${c})`), { exited: c }); };
  process.exitCode = undefined;
  try {
    let result, exited = null;
    try { result = main(argv, deps); } catch (e) { if (e.exited === undefined) throw e; exited = e.exited; }
    return { result, out, err, exitCode: exited ?? process.exitCode ?? 0, reports: exited === null && argv.includes('--probe') ? out.map((line) => JSON.parse(line)) : [] };
  } finally { console.log = log; console.error = error; process.exit = exit; process.exitCode = code; }
}
const page = (argv, deps = {}) => run(clipPage, argv, { fetchTwin: NO_TWIN, render: NO_BROWSER, sleep: () => {}, runtimeAvailable: () => true, ...deps });

const REPORT_FIELDS = ['probe', 'url', 'outcome', 'extraction', 'words', 'title', 'captured', 'existing', 'declined', 'declineReason', 'reason', 'wouldDecline', 'wouldQueue', 'ocr', 'estimate'];

// ---------------------------------------------------------------- pages

test('a page only a browser can read probes as clipped and rendered, with its words and title, and the vault is unchanged', (t) => {
  const v = vault(t);
  const url = 'https://app.example.test/docs/start';
  const rendered = [];
  const r = page([url, '--probe'], {
    extract: () => ({ title: 'Start', contentMarkdown: 'Back to top' }),
    render: (target) => { rendered.push(target); return { ok: true, data: article('Getting Started', 400) }; },
  });
  assert.equal(r.exitCode, 0);
  assert.equal(r.out.length, 1, 'stdout is the one JSON line');
  const [report] = r.reports;
  assert.deepEqual(Object.keys(report), REPORT_FIELDS);
  assert.deepEqual(rendered, [url], 'the browser rung ran, as it would for a clip');
  assert.deepEqual({ ...report, words: null }, {
    probe: true, url, outcome: 'clipped', extraction: 'rendered', words: null, title: 'Getting Started', captured: false, existing: null,
    declined: false, declineReason: null, reason: null, wouldDecline: false, wouldQueue: false, ocr: null, estimate: false,
  });
  assert.ok(report.words >= 400, String(report.words));
  assert.ok(r.err.some((line) => line.startsWith('probe: clipped (rendered, ') && line.endsWith('nothing was written')), r.err.join('\n'));
  v.unchanged();
});

test('a probe and a clip of the same page agree on the title, the extraction and the outcome', (t) => {
  const v = vault(t);
  const url = 'https://docs.example.test/a';
  const deps = { extract: () => article('A Page of Docs') };
  const [report] = page([url, '--probe'], deps).reports;
  v.unchanged();
  const clipped = page([url], deps).result;
  assert.equal(report.outcome, clipped.status);
  assert.equal(report.extraction, clipped.extraction);
  const text = readFileSync(clipped.file, 'utf8');
  assert.match(text, new RegExp(`^title: ${JSON.stringify(report.title)}$`, 'm'));
  assert.equal(report.words, (text.split('---\n').slice(2).join('---\n').match(/\S+/g) || []).length);
});

test('a page a browser read and found thin probes as thin, says a clip would decline and queue it, and records neither', (t) => {
  const v = vault(t);
  const thin = { title: 'Shell', contentMarkdown: 'Loading the application' };
  // The made-up address on the same site reads differently, so the site tells its addresses apart and the verdict stands.
  const render = (target) => (target.includes('wiki-master-probe-') ? { ok: false, kind: 'gone', reason: 'HTTP 404' } : { ok: true, data: thin });
  const [report] = page(['https://app.example.test/shell', '--probe'], { extract: () => thin, render }).reports;
  assert.equal(report.outcome, 'thin');
  assert.equal(report.extraction, 'text');
  assert.equal(report.words, 3);
  assert.equal(report.wouldDecline, true);
  assert.equal(report.wouldQueue, true);
  assert.match(report.reason, /thin content/);
  v.unchanged();
});

test('a thin page with no browser probes as thin and says a clip would queue it without a decline', (t) => {
  const v = vault(t);
  const [report] = page(['https://app.example.test/shell', '--probe'], { extract: () => ({ title: 'Shell', contentMarkdown: 'Loading' }) }).reports;
  assert.equal(report.outcome, 'thin');
  assert.equal(report.wouldDecline, false);
  assert.equal(report.wouldQueue, true);
  v.unchanged();
});

test('a description the body does not carry probes as wrong-node, the kind a clip would queue', (t) => {
  const v = vault(t);
  const data = { title: 'An Article', contentMarkdown: 'Related stories and more', description: 'Regulators published extensive guidance covering laboratory developed diagnostics, manufacturer obligations and enforcement discretion timelines' };
  const [report] = page(['https://news.example.test/item', '--probe'], { extract: () => data }).reports;
  assert.equal(report.outcome, 'wrong-node');
  assert.equal(report.wouldQueue, true);
  v.unchanged();
});

test('a failed fetch whose render is blocked or gone probes under the render kind, and nothing is queued', (t) => {
  for (const kind of ['blocked', 'gone', 'failed']) {
    const v = vault(t);
    const [report] = page(['https://site.example.test/x', '--probe'], {
      extract: () => { throw new Error('fetch failed'); },
      render: () => ({ ok: false, kind, reason: `render says ${kind}` }),
    }).reports;
    assert.equal(report.outcome, kind);
    assert.equal(report.reason, `render says ${kind}`);
    assert.equal(report.wouldQueue, true);
    assert.equal(report.wouldDecline, false);
    v.unchanged();
  }
});

test('an address the vault holds probes as duplicate with the clipping named, fetches nothing and leaves its open triage row open', (t) => {
  const v = vault(t);
  const r = page([HELD, '--probe'], { extract: () => { throw new Error('a duplicate is not fetched'); } });
  const [report] = r.reports;
  assert.equal(report.outcome, 'duplicate');
  assert.equal(report.captured, true);
  assert.equal(report.existing, 'raw/clippings/held-guide.md');
  assert.equal(report.declined, false);
  v.unchanged();
});

test('a declined address probes as declined with the reason, and fetches nothing', (t) => {
  const v = vault(t);
  const [report] = page([DECLINED, '--probe'], { extract: () => { throw new Error('a declined address is not fetched'); } }).reports;
  assert.equal(report.outcome, 'declined');
  assert.equal(report.declined, true);
  assert.equal(report.declineReason, 'not a primary source');
  assert.equal(report.captured, false);
  v.unchanged();
});

test('a saved page can be probed with --from-file through the real script: one JSON line, exit 0, nothing written', (t) => {
  const v = vault(t);
  const file = join(dirname(v.root), `${v.root.split(/[\\/]/).pop()}-page.md`);
  writeFileSync(file, `# A supplied page\n\n${'This page is described here in enough plain words that it counts as real content. '.repeat(20)}\n`);
  t.after(() => rmSync(file, { force: true }));
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'clip.mjs'), 'https://docs.example.test/saved', '--from-file', file, '--probe'], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, WIKI_MASTER_VAULT: v.root },
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, r.stdout);
  const report = JSON.parse(lines[0]);
  assert.equal(report.outcome, 'clipped');
  assert.equal(report.extraction, 'manual');
  assert.equal(report.title, 'A supplied page');
  assert.match(r.stderr, /^probe: clipped \(manual, \d+ words\): https:\/\/docs\.example\.test\/saved; nothing was written/m);
  v.unchanged();
});

test('--list --probe prints one JSON line per address in order, a bad line as an error, and the count on stderr', (t) => {
  const v = vault(t);
  const listFile = join(dirname(v.root), `${v.root.split(/[\\/]/).pop()}-urls.txt`);
  writeFileSync(listFile, ['https://one.example.test/a', 'not an address', HELD, 'https://two.example.test/b'].join('\n'));
  t.after(() => rmSync(listFile, { force: true }));
  const r = page(['--list', listFile, '--probe'], { extract: (url) => article(`Page ${new URL(url).host}`) });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.reports.map((x) => x.outcome), ['clipped', 'error', 'duplicate', 'clipped']);
  assert.deepEqual(r.reports.map((x) => x.url), ['https://one.example.test/a', null, HELD, 'https://two.example.test/b']);
  assert.ok(r.err.includes('list: 4 URLs: clipped 2, duplicate 1, error 1'), r.err.join('\n'));
  v.unchanged();
});

// ---------------------------------------------------------------- option combinations

test('--probe is refused with every option that asks for a write, on the command line and in a programmatic call', (t) => {
  const cases = {
    clip: ['--decline=no', '--slug=name', '--recapture', '--ledger=run.jsonl', '--find-twin', '--override-decline', '--supersede-decline=why'],
    'clip-pdf': ['--decline=no', '--slug=name', '--figures', '--figures=all', '--figures-max=3', '--figures-only', '--clipping=raw/clippings/x.md', '--allow-pdf-mismatch', '--override-decline', '--supersede-decline=why'],
  };
  for (const [name, options] of Object.entries(cases)) {
    const spec = CLIP_SPECS[name];
    assert.deepEqual([...new Set(options.map((o) => o.slice(2).split('=')[0]))].sort(), spec.probeRefuses.filter((n) => n !== 'doctor').sort(), `${name}: every refused option is covered`);
    for (const option of options) {
      const optionName = option.slice(2).split('=')[0];
      const expected = `--probe cannot be used with --${optionName}: a probe writes nothing`;
      assert.deepEqual(checkClipArgs(['https://docs.example.test/a', option, '--probe'], spec), { error: expected });
      assert.equal(probeConflict(['https://docs.example.test/a', option], spec), null, 'without --probe the option is not a conflict');
    }
  }
  assert.deepEqual(checkClipArgs(['--doctor', '--probe'], CLIP_SPECS['clip-pdf']), { error: '--probe cannot be used with --doctor: a probe writes nothing' });
  for (const allowed of [['--quality=high', '--topic=Docs', '--expand'], ['--from-file', 'page.md']]) {
    assert.deepEqual(checkClipArgs(['https://docs.example.test/a', ...allowed, '--probe'], CLIP_SPECS.clip), { ok: true });
  }
  assert.deepEqual(checkClipArgs(['file.pdf', '--source=https://docs.example.test/a.pdf', '--mode=table', '--ocr', '--ocr-lang=deu', '--title=T', '--probe'], CLIP_SPECS['clip-pdf']), { ok: true });

  const v = vault(t);
  const programmatic = page(['https://docs.example.test/a', '--probe', '--decline=no'], { extract: () => article('A') });
  assert.equal(programmatic.exitCode, 2);
  assert.deepEqual(programmatic.out, []);
  const pdf = run(clipPdf, ['file.pdf', '--probe', '--slug=name'], { toolchain: () => ({ ok: true, fatal: false, lines: [] }) });
  assert.equal(pdf.exitCode, 2);
  assert.equal(pdf.err[0], 'clip-pdf.mjs: --probe cannot be used with --slug: a probe writes nothing');
  v.unchanged();
});

test('the real scripts refuse --probe with a write option with exit 2, the problem and the usage, and write nothing', (t) => {
  const v = vault(t);
  for (const [script, name, args] of [['clip.mjs', 'clip', ['https://docs.example.test/a', '--probe', '--recapture']], ['clip-pdf.mjs', 'clip-pdf', ['https://docs.example.test/a.pdf', '--probe', '--figures']]]) {
    const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', timeout: 30000, env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
    assert.equal(r.status, 2, r.stderr);
    const lines = r.stderr.replace(/\r\n/g, '\n').trimEnd().split('\n');
    assert.equal(lines[0], `${script}: --probe cannot be used with --${args[2].slice(2)}: a probe writes nothing`);
    assert.deepEqual(lines.slice(1), CLIP_SPECS[name].usage);
    assert.equal(r.stdout, '');
  }
  v.unchanged();
});

// ---------------------------------------------------------------- PDFs

const READY = () => ({ ok: true, fatal: false, lines: [] });
const noOcr = { ocrAvailable: () => false, ocrText: () => { throw new Error('OCR is not reachable'); }, ocrPages: () => null };
// An OCR that reads `perPage` words from each page it is asked for, of a document of `pages` pages. `calls` is what it was asked.
function fakeOcr(pages, perPage) {
  const calls = [];
  const ocrText = (_pdfPath, options) => { calls.push(options); return Array.from({ length: Math.min(pages, options.lastPage ?? pages) }, () => words(perPage)).join('\f'); };
  return Object.defineProperty({ ocrAvailable: () => true, ocrText, ocrPages: () => pages }, 'calls', { value: calls });
}
function pdfFile(v, name = 'A_Scanned_Report.pdf') {
  const file = join(dirname(v.root), `${v.root.split(/[\\/]/).pop()}-${name}`);
  writeFileSync(file, '%PDF-1.4\n% a stand-in: the text layer and OCR are injected\n%%EOF\n');
  return file;
}
const pdf = (argv, deps = {}) => run(clipPdf, argv, { toolchain: READY, pdfTitle: () => null, ...noOcr, ...deps });

test('a PDF with a text layer probes as clipped from text, with its words and title, and the vault is unchanged', (t) => {
  const v = vault(t);
  const file = pdfFile(v);
  t.after(() => rmSync(file, { force: true }));
  const r = pdf([file, '--source=https://docs.example.test/report.pdf', '--probe'], { extractText: () => words(160), pdfTitle: () => 'Annual Report of the Board' });
  assert.equal(r.exitCode, 0);
  assert.equal(r.out.length, 1, 'stdout is the one JSON line');
  const [report] = r.reports;
  assert.deepEqual(Object.keys(report), REPORT_FIELDS);
  assert.deepEqual(report, {
    probe: true, url: 'https://docs.example.test/report.pdf', outcome: 'clipped', extraction: 'text', words: 160, title: 'Annual Report of the Board',
    captured: false, existing: null, declined: false, declineReason: null, reason: null, wouldDecline: false, wouldQueue: false, ocr: null, estimate: false,
  });
  v.unchanged();
});

test('an image-only PDF probes as clipped by OCR from a sample of its first pages, and says the answer is an estimate', (t) => {
  const v = vault(t);
  const file = pdfFile(v);
  t.after(() => rmSync(file, { force: true }));
  const ocr = fakeOcr(12, 80);
  const [report] = pdf([file, '--probe', '--ocr-lang=deu'], { extractText: () => '', ...ocr }).reports;
  assert.deepEqual(ocr.calls, [{ lang: 'deu', lastPage: PROBE_OCR_PAGES }], 'OCR ran once, on the sample only');
  assert.equal(report.outcome, 'clipped');
  assert.equal(report.extraction, 'ocr');
  assert.deepEqual(report.ocr, { pagesSampled: 2, pages: 12, words: 160 });
  assert.equal(report.words, 160);
  assert.equal(report.estimate, true);
  assert.equal(report.wouldDecline, false);
  v.unchanged();
});

test('a sparse sample of a long scanned PDF is projected over its pages, not declined on two thin pages', (t) => {
  const v = vault(t);
  const file = pdfFile(v);
  t.after(() => rmSync(file, { force: true }));
  const [report] = pdf([file, '--probe'], { extractText: () => '', ...fakeOcr(12, 20) }).reports;
  assert.equal(report.outcome, 'clipped', '40 words on 2 of 12 pages projects to 240');
  assert.equal(report.extraction, 'ocr');
  assert.equal(report.words, 40);
  assert.equal(report.estimate, true);
  assert.equal(report.wouldDecline, false);
  v.unchanged();
});

test('a PDF whose every page was sampled gets the real thin verdict: a clip would decline it, and the probe does not', (t) => {
  const v = vault(t);
  const file = pdfFile(v);
  t.after(() => rmSync(file, { force: true }));
  const [report] = pdf([file, '--probe'], { extractText: () => 'three words only', ...fakeOcr(2, 4) }).reports;
  assert.equal(report.outcome, 'thin');
  assert.deepEqual(report.ocr, { pagesSampled: 2, pages: 2, words: 8 });
  assert.equal(report.estimate, false);
  assert.equal(report.wouldDecline, true);
  assert.match(report.reason, /OCR ran and also failed/);
  v.unchanged();
});

test('an OCR sample that reads nothing of a longer PDF probes as thin, marked as an estimate', (t) => {
  const v = vault(t);
  const file = pdfFile(v);
  t.after(() => rmSync(file, { force: true }));
  const [report] = pdf([file, '--probe'], { extractText: () => '', ...fakeOcr(30, 0) }).reports;
  assert.equal(report.outcome, 'thin');
  assert.equal(report.estimate, true);
  v.unchanged();
});

test('a thin PDF on a machine without OCR probes as ocr-unavailable, which is no verdict on the document', (t) => {
  const v = vault(t);
  const file = pdfFile(v);
  t.after(() => rmSync(file, { force: true }));
  const [report] = pdf([file, '--probe'], { extractText: () => '' }).reports;
  assert.equal(report.outcome, 'ocr-unavailable');
  assert.equal(report.ocr, null);
  assert.equal(report.wouldDecline, false);
  v.unchanged();
});

test('an OCR tool that fails on the sample probes as failed with the tool\'s words, and nothing is queued', (t) => {
  const v = vault(t);
  const file = pdfFile(v);
  t.after(() => rmSync(file, { force: true }));
  const broken = { ocrAvailable: () => true, ocrText: () => { throw new Error('pdftoppm could not rasterize the PDF (exit 1)'); }, ocrPages: () => 9 };
  const [report] = pdf([file, '--probe'], { extractText: () => '', ...broken }).reports;
  assert.equal(report.outcome, 'failed');
  assert.equal(report.reason, 'OCR failed: pdftoppm could not rasterize the PDF (exit 1)');
  assert.equal(report.wouldQueue, true);
  assert.equal(report.wouldDecline, false);
  v.unchanged();
});

test('a PDF address that cannot be downloaded probes as failed with the reason, and nothing is queued', (t) => {
  const v = vault(t);
  const url = 'https://files.example.test/missing.pdf';
  const [report] = pdf([url, '--probe'], { download: () => ({ ok: false, code: 'HTTP', reason: 'the server answered 404' }) }).reports;
  assert.equal(report.url, url);
  assert.equal(report.outcome, 'failed');
  assert.equal(report.reason, 'download failed: the server answered 404');
  assert.equal(report.wouldQueue, true);
  v.unchanged();
});

test('a PDF address the vault holds or has declined probes as duplicate or declined before any download', (t) => {
  const v = vault(t);
  const download = () => { throw new Error('nothing is downloaded'); };
  const [held] = pdf([HELD, '--probe'], { download }).reports;
  assert.equal(held.outcome, 'duplicate');
  assert.equal(held.captured, true);
  assert.equal(held.existing, 'raw/clippings/held-guide.md');
  const [declined] = pdf([DECLINED, '--probe'], { download }).reports;
  assert.equal(declined.outcome, 'declined');
  assert.equal(declined.declineReason, 'not a primary source');
  v.unchanged();
});

// ---------------------------------------------------------------- the real tools, where they are installed

// The dimensions of a baseline or progressive JPEG, from its start-of-frame segment.
function jpegSize(buf) {
  for (let i = 2; i < buf.length;) {
    const marker = buf[i + 1], length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), components: buf[i + 9] };
    i += 2 + length;
  }
  throw new Error('no start-of-frame segment');
}

// A PDF whose pages are pictures of text and nothing else: each page is one JPEG, so it has no text layer.
function imageOnlyPdf(jpegs, out) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => { const b = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1'); chunks.push(b); length += b.length; };
  const object = (n, ...parts) => { offsets[n] = length; push(`${n} 0 obj\n`); for (const part of parts) push(part); push('\nendobj\n'); };
  push('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${jpegs.length} >>`);
  jpegs.forEach((jpeg, i) => {
    const page = 3 + i * 3;
    const { width, height, components } = jpegSize(jpeg);
    const content = 'q 612 0 0 792 0 0 cm /Im0 Do Q';
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    object(page + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(page + 2, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${components === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream');
  });
  const xref = length;
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let n = 1; n < offsets.length; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  writeFileSync(out, Buffer.concat(chunks));
}

function realToolsMissing() {
  const runs = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch (e) { return e.code !== 'ENOENT'; } };
  if (!runs('pdftotext', ['-v'])) return 'pdftotext not installed';
  if (!runs('pdftoppm', ['-v'])) return 'pdftoppm not installed';
  if (!runs('tesseract', ['--version'])) return 'tesseract not installed';
  return false;
}

test('with the real tools, an image-only PDF of 3 pages is probed by recognising its first 2, and nothing is written', { skip: realToolsMissing() }, (t) => {
  const v = vault(t);
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'wm-clip-probe-pdf-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const sentence = 'The committee reviewed every recommendation and agreed that the schedule should stay as written.';
  const textPdf = join(work, 'text.pdf');
  makePdf([1, 2, 3].map((n) => Array.from({ length: 12 }, (_, i) => ({ x: 60, y: 720 - i * 40, size: 14, text: `Page ${n} line ${i + 1}. ${sentence}` }))), textPdf);
  try { execFileSync('pdftoppm', ['-jpeg', '-r', '150', textPdf, join(work, 'scan')], { stdio: 'ignore' }); } catch { return t.skip('this pdftoppm cannot write JPEG'); }
  const jpegs = readdirSync(work).filter((f) => f.endsWith('.jpg')).sort().map((f) => readFileSync(join(work, f)));
  assert.equal(jpegs.length, 3);
  const scanned = join(work, 'Minutes_of_the_Committee.pdf');
  imageOnlyPdf(jpegs, scanned);

  assert.equal(pdfPageCount(scanned), 3, 'pdftotext ends a page with no text layer with a form feed too');
  const sample = pdfToTextOcr(scanned, { dpi: 150, lastPage: 1 });
  assert.match(sample, /Page 1 line/);
  assert.doesNotMatch(sample, /Page 2 line/, 'lastPage stops the recognition after that page');

  const r = spawnSync(process.execPath, [join(SCRIPTS, 'clip-pdf.mjs'), scanned, '--probe'], { encoding: 'utf8', timeout: 110000, env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, r.stdout);
  const report = JSON.parse(lines[0]);
  assert.equal(report.outcome, 'clipped');
  assert.equal(report.extraction, 'ocr');
  assert.equal(report.ocr.pagesSampled, 2);
  assert.equal(report.ocr.pages, 3);
  assert.ok(report.ocr.words >= 100, String(report.ocr.words));
  assert.equal(report.estimate, true);
  v.unchanged();
});
