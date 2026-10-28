import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { CLIP_SPECS, checkClipArgs, guardClipArgs } from '../scripts/lib/clip-args.mjs';
import { main as clipMain } from '../scripts/clip.mjs';
import { main as docxMain } from '../scripts/clip-docx.mjs';
import { main as pptxMain } from '../scripts/clip-pptx.mjs';
import { main as xlsxMain } from '../scripts/clip-xlsx.mjs';
import { main as confluenceMain } from '../scripts/clip-confluence.mjs';
import { writeFileClips, writeDigest } from '../scripts/clip-gh.mjs';
import { addFiguresToClipping, pdfClipContent } from '../scripts/clip-pdf.mjs';
import { writtenFigurePaths } from '../scripts/lib/pdf-figures.mjs';
import { beginOp } from '../scripts/op-begin.mjs';
import { readWritten, writtenLedgerFile } from '../scripts/lib/op-ledger.mjs';

// Every clipper takes --since <token> and records the exact path of each file it writes, at the moment it writes it: the
// clipping, and for clip-pdf the figure files and the frontmatter rewrite, for clip-gh each listing, anchor, manifest, rename
// and prune. A result that writes nothing (duplicate, clash, decline) records nothing.

const DASH = String.fromCodePoint(0x2014);
const BODY = 'A substantive paragraph of document text that is long enough to count as content. '.repeat(30);

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-clipwritten-'));
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = dir;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(dir, { recursive: true, force: true }); });
  return { dir, clippings: join(dir, 'raw', 'clippings'), token: beginOp(dir, 'discover') };
}
function capture(fn) {
  const log = console.log, err = console.error; const lines = [];
  console.log = () => {}; console.error = (...a) => lines.push(a.join(' '));
  try { return { result: fn(), errors: lines }; } finally { console.log = log; console.error = err; }
}
const onDisk = (dir) => readdirSync(dir).map((f) => `raw/clippings/${f}`).sort();

test('every clipper accepts --since in both spellings, and says so in its usage', () => {
  for (const [name, spec] of Object.entries(CLIP_SPECS)) {
    assert.deepEqual(checkClipArgs(['target', '--since', 'aaaaaaaaaaaaaaaa'], spec), { ok: true }, name);
    assert.deepEqual(checkClipArgs(['target', '--since=aaaaaaaaaaaaaaaa'], spec), { ok: true }, name);
    assert.ok(checkClipArgs(['target', '--since'], spec).error, `${name}: a bare --since needs a value`);
    assert.match(spec.usage.join('\n'), /--since/, name);
  }
});

test('the command-line guard refuses a --since that names no open operation, before any work', (t) => {
  const v = vault(t);
  const spec = CLIP_SPECS.clip;
  const exits = [];
  const errs = [];
  const guard = (argv) => guardClipArgs(argv, spec, { exit: (c) => exits.push(c), out: () => {}, err: (m) => errs.push(m), vaultPath: v.dir });
  assert.equal(guard(['https://x.test/', '--since', v.token]), null);
  assert.deepEqual(exits, []);
  assert.equal(guard(['https://x.test/', '--since', 'bbbbbbbbbbbbbbbb']), 'error');
  assert.deepEqual(exits, [2]);
  assert.match(errs.join('\n'), /no open operation/);
  assert.equal(guard(['https://x.test/', '--since', '../x']), 'error');
  assert.equal(guard(['https://x.test/']), null, 'no --since is not checked');
});

test('clip.mjs: the recorded path is the file on disk, byte for byte, for a name with an em dash', (t) => {
  const v = vault(t);
  const { result } = capture(() => clipMain(['https://example.org/note', '--since', v.token], { extract: () => ({ title: `Fish ${DASH} a note`, contentMarkdown: BODY }) }));
  assert.equal(result.status, 'clipped');
  const files = onDisk(v.clippings);
  assert.equal(files.length, 1);
  assert.ok(files[0].includes(DASH), `the name keeps its dash: ${files[0]}`);
  assert.deepEqual(readWritten(v.dir, v.token), files);
});

test('clip.mjs: a duplicate, a clash and a decline record nothing', (t) => {
  const v = vault(t);
  const extract = () => ({ title: 'One', contentMarkdown: BODY });
  capture(() => clipMain(['https://example.org/one', '--since', v.token], { extract }));
  const after = readWritten(v.dir, v.token);
  assert.equal(after.length, 1);
  assert.equal(capture(() => clipMain(['https://example.org/one', '--since', v.token], { extract })).result.status, 'duplicate');
  assert.equal(capture(() => clipMain(['https://example.org/two', '--since', v.token], { extract, writeClipping: () => false })).result.status, 'clash');
  assert.equal(capture(() => clipMain(['https://example.org/three', '--decline=not useful', '--since', v.token])).result.status, 'declined');
  assert.deepEqual(readWritten(v.dir, v.token), after);
});

test('clip.mjs: without --since nothing is recorded and the clip is unchanged', (t) => {
  const v = vault(t);
  const { result } = capture(() => clipMain(['https://example.org/note'], { extract: () => ({ title: 'Plain', contentMarkdown: BODY }) }));
  assert.equal(result.status, 'clipped');
  assert.equal(existsSync(writtenLedgerFile(v.dir, v.token)), false);
});

test('a clip whose token cannot be recorded still lands, and says which path to add', (t) => {
  const v = vault(t);
  const { result, errors } = capture(() => clipMain(['https://example.org/note', '--since', 'bbbbbbbbbbbbbbbb'], { extract: () => ({ title: 'Lands', contentMarkdown: BODY }) }));
  assert.equal(result.status, 'clipped');
  assert.equal(onDisk(v.clippings).length, 1);
  assert.match(errors.join('\n'), /not recorded in the operation ledger.*op-ledger\.mjs add --since bbbbbbbbbbbbbbbb "raw\/clippings\/Lands\.md"/s);
});

// The four document clippers share one shape: a path to a file, an extraction, a write.
const documents = [
  ['clip-docx', docxMain, 'a.docx', { toText: () => BODY }],
  ['clip-pptx', pptxMain, 'a.pptx', { toText: () => BODY }],
  ['clip-xlsx', xlsxMain, 'a.xlsx', { toText: () => BODY }],
];
for (const [name, main, file, deps] of documents) {
  test(`${name}: the recorded path is the clipping on disk, and a repeat records nothing`, (t) => {
    const v = vault(t);
    const input = join(v.dir, file);
    writeFileSync(input, 'stand-in');
    const { result } = capture(() => main([input, `--title=Fish ${DASH} a note`, '--since', v.token], deps));
    assert.equal(result.status, 'clipped');
    assert.deepEqual(readWritten(v.dir, v.token), onDisk(v.clippings));
    assert.equal(capture(() => main([input, `--title=Fish ${DASH} a note`, '--since', v.token], deps)).result.status, 'duplicate');
    assert.deepEqual(readWritten(v.dir, v.token), onDisk(v.clippings));
  });
}

test('clip-confluence: the recorded path is the clipping on disk', (t) => {
  const v = vault(t);
  const page = `# Fish ${DASH} a page\nSpace: ENG · Page ID: 42 · Version: 3 · Updated: 2026-01-01\nURL: https://example.atlassian.net/wiki/spaces/ENG/pages/42\n\n---\n${BODY}`;
  const deps = { findScripts: () => 'stand-in', runPage: () => page };
  const { result } = capture(() => confluenceMain(['42', '--since', v.token], deps));
  assert.equal(result.status, 'clipped');
  assert.deepEqual(readWritten(v.dir, v.token), onDisk(v.clippings));
});

test('clip-pdf figures: the sidecar, the image beside it and the rewritten clipping are recorded; an unchanged figure is not', (t) => {
  const v = vault(t);
  const clip = pdfClipContent({ title: 'D', source: 'in.pdf', text: BODY });
  writeFileSync(join(v.clippings, 'D.md'), clip.body);
  const render = () => ({
    status: 'ok', pageCount: 3, plan: { pages: [{ page: 2 }, { page: 3 }] },
    figures: ['raw/figures/D-p2.md', 'raw/figures/D-p3.md'], written: ['raw/figures/D-p2.md'], unchanged: ['raw/figures/D-p3.md'],
    kept: [], duplicates: [], failed: [], notes: [],
  });
  const record = (paths) => v.recorded.push(...[paths].flat());
  v.recorded = [];
  capture(() => addFiguresToClipping({ pdfPath: 'in.pdf', vaultPath: v.dir, clippingRel: 'raw/clippings/D.md', fig: {}, source: 'in.pdf', title: 'D', record, render }));
  assert.deepEqual(v.recorded.sort(), ['raw/clippings/D.md', 'raw/figures/D-p2.md', 'raw/figures/D-p2.png']);
});

test('writtenFigurePaths names each written sidecar and its image, and nothing for a skipped or empty run', () => {
  assert.deepEqual(writtenFigurePaths({ status: 'ok', written: ['raw/figures/X-p1.md', 'raw/figures/X-p4.md'] }), ['raw/figures/X-p1.md', 'raw/figures/X-p1.png', 'raw/figures/X-p4.md', 'raw/figures/X-p4.png']);
  assert.deepEqual(writtenFigurePaths({ status: 'skipped', figures: [] }), []);
  assert.deepEqual(writtenFigurePaths({ status: 'none', figures: [] }), []);
});

// clip-gh: every file written, renamed or pruned under raw/clippings/gh/<owner>/<repo>/.
const WORDS = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
const ghCommon = { owner: 'o', repo: 'r', resolvedRef: 'abc123', quality: 'medium' };
function checkout(t, files, outFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wm-ghwritten-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tmp = join(root, 'checkout'); const outDir = join(root, 'out');
  mkdirSync(outDir, { recursive: true });
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(tmp, path)), { recursive: true }); writeFileSync(join(tmp, path), text); }
  for (const [name, text] of Object.entries(outFiles)) writeFileSync(join(outDir, name), text);
  const recorded = [];
  const names = (paths) => paths.map((p) => p.slice(outDir.length + 1)).sort();
  return { tmp, outDir, recorded, record: (p) => recorded.push(...[p].flat()), names };
}

test('clip-gh per-file mode: each new clipping is recorded, an unchanged one is not', (t) => {
  const f = checkout(t, { 'README.md': WORDS, 'docs/guide.md': WORDS });
  const run = () => capture(() => writeFileClips({ ...ghCommon, included: ['README.md', 'docs/guide.md'], outDir: f.outDir, tmp: f.tmp, record: f.record }));
  run();
  assert.deepEqual(f.names(f.recorded), readdirSync(f.outDir).sort());
  const first = f.recorded.length;
  assert.equal(first, 2);
  run();
  assert.equal(f.recorded.length, first, 'a second run changes nothing and records nothing');
});

test('clip-gh per-file mode: a legacy name carried to its safe name records both, since git sees a delete and an add', (t) => {
  const legacy = `---\nsource-hash: ${'0'.repeat(64)}\n---\nold`;
  const f = checkout(t, { '.github/workflows/ci.yml': WORDS }, { '.github-workflows-ci.yml.md': legacy });
  capture(() => writeFileClips({ ...ghCommon, included: ['.github/workflows/ci.yml'], outDir: f.outDir, tmp: f.tmp, record: f.record }));
  assert.deepEqual([...new Set(f.names(f.recorded))], ['.github-workflows-ci.yml.md', 'dot-github-workflows-ci.yml.md']);
});

test('clip-gh digest mode: listings, anchors, the manifest and each pruned file are recorded', (t) => {
  const f = checkout(t, { 'README.md': WORDS, 'src/a.js': 'x', 'src/b.js': 'y' }, { 'stale-from-an-earlier-run.md': 'gone soon' });
  capture(() => writeDigest({ ...ghCommon, included: ['README.md', 'src/a.js', 'src/b.js'], excluded: [], meta: { description: null, primaryLanguage: null }, outDir: f.outDir, tmp: f.tmp, record: f.record }));
  const now = readdirSync(f.outDir).sort();
  assert.ok(!now.includes('stale-from-an-earlier-run.md'), 'it was pruned');
  const recorded = f.names(f.recorded);
  assert.deepEqual([...new Set(recorded)].sort(), [...now, 'stale-from-an-earlier-run.md'].sort());
  assert.ok(recorded.includes('_repo-overview.md'));
});
