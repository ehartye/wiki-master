import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIP_SPECS, checkClipArgs, guardClipArgs } from '../scripts/lib/clip-args.mjs';
import { main as clipMain } from '../scripts/clip.mjs';
import { main as docxMain } from '../scripts/clip-docx.mjs';
import { main as pptxMain } from '../scripts/clip-pptx.mjs';
import { main as xlsxMain } from '../scripts/clip-xlsx.mjs';
import { main as confluenceMain } from '../scripts/clip-confluence.mjs';
import { writeFileClips, writeDigest } from '../scripts/clip-gh.mjs';
import { addFiguresToClipping, pdfClipContent } from '../scripts/clip-pdf.mjs';

// What each clipper leaves on disk and prints: the clipping, and for clip-pdf the frontmatter rewrite, for clip-gh each
// listing, anchor, manifest, rename and prune. A result that writes nothing (duplicate, clash, decline) changes nothing.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const DASH = String.fromCodePoint(0x2014);
const BODY = 'A substantive paragraph of document text that is long enough to count as content. '.repeat(30);

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-clipwritten-'));
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = dir;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(dir, { recursive: true, force: true }); });
  return { dir, clippings: join(dir, 'raw', 'clippings') };
}
function capture(fn) {
  const log = console.log, err = console.error; const out = [];
  console.log = (...a) => out.push(a.join(' ')); console.error = () => {};
  try { return { result: fn(), out: out.join('\n') }; } finally { console.log = log; console.error = err; }
}
const onDisk = (dir) => readdirSync(dir).map((f) => `raw/clippings/${f}`).sort();

test('every clipper rejects --since as an unknown option in both spellings, and its usage does not offer it', () => {
  for (const [name, spec] of Object.entries(CLIP_SPECS)) {
    assert.deepEqual(checkClipArgs(['target', '--since', 'aaaaaaaaaaaaaaaa'], spec), { error: 'unknown option --since' }, name);
    assert.deepEqual(checkClipArgs(['target', '--since=aaaaaaaaaaaaaaaa'], spec), { error: 'unknown option --since' }, name);
    assert.doesNotMatch(spec.usage.join('\n'), /--since/, name);
  }
});

test('the guard handles --since as it does any unknown option: the problem and the usage on stderr, exit 2', () => {
  const spec = CLIP_SPECS.clip;
  const exits = [];
  const errs = [];
  const guard = (argv) => guardClipArgs(argv, spec, { exit: (c) => exits.push(c), out: () => {}, err: (m) => errs.push(m) });
  assert.equal(guard(['https://x.test/', '--since', 'aaaaaaaaaaaaaaaa']), 'error');
  assert.deepEqual(exits, [2]);
  assert.equal(errs[0], 'clip.mjs: unknown option --since');
  assert.equal(guard(['https://x.test/']), null);
});

for (const [name, spec] of Object.entries(CLIP_SPECS)) {
  test(`${name} on the command line exits 2 on --since and writes nothing`, (t) => {
    const v = vault(t);
    const r = spawnSync(process.execPath, [join(SCRIPTS, spec.name), 'target', '--since', 'aaaaaaaaaaaaaaaa'], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: v.dir } });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /unknown option --since/);
    assert.deepEqual(readdirSync(v.dir), ['raw']);
    assert.deepEqual(onDisk(v.clippings), []);
  });
}

test('clip.mjs: the clipping lands under its exact name, em dash included, and the path is printed', (t) => {
  const v = vault(t);
  const { result, out } = capture(() => clipMain(['https://example.org/note'], { extract: () => ({ title: `Fish ${DASH} a note`, contentMarkdown: BODY }) }));
  assert.equal(result.status, 'clipped');
  const files = onDisk(v.clippings);
  assert.equal(files.length, 1);
  assert.ok(files[0].includes(DASH), `the name keeps its dash: ${files[0]}`);
  assert.ok(out.includes(`clipped: ${files[0]} `), out);
});

test('clip.mjs: a duplicate, a clash and a decline write nothing', (t) => {
  const v = vault(t);
  const extract = () => ({ title: 'One', contentMarkdown: BODY });
  capture(() => clipMain(['https://example.org/one'], { extract }));
  const after = onDisk(v.clippings);
  assert.equal(after.length, 1);
  assert.equal(capture(() => clipMain(['https://example.org/one'], { extract })).result.status, 'duplicate');
  assert.equal(capture(() => clipMain(['https://example.org/two'], { extract, writeClipping: () => false })).result.status, 'clash');
  assert.equal(capture(() => clipMain(['https://example.org/three', '--decline=not useful'])).result.status, 'declined');
  assert.deepEqual(onDisk(v.clippings), after);
});

// The document clippers share one shape: a path to a file, an extraction, a write.
const documents = [
  ['clip-docx', docxMain, 'a.docx', { toText: () => BODY }],
  ['clip-pptx', pptxMain, 'a.pptx', { toText: () => BODY }],
  ['clip-xlsx', xlsxMain, 'a.xlsx', { toText: () => BODY }],
];
for (const [name, main, file, deps] of documents) {
  test(`${name}: the clipping lands, its path is printed, and a repeat writes nothing`, (t) => {
    const v = vault(t);
    const input = join(v.dir, file);
    writeFileSync(input, 'stand-in');
    const { result, out } = capture(() => main([input, `--title=Fish ${DASH} a note`], deps));
    assert.equal(result.status, 'clipped');
    const files = onDisk(v.clippings);
    assert.equal(files.length, 1);
    assert.ok(out.includes(`clipped: ${files[0]} `), out);
    assert.equal(capture(() => main([input, `--title=Fish ${DASH} a note`], deps)).result.status, 'duplicate');
    assert.deepEqual(onDisk(v.clippings), files);
  });
}

test('clip-confluence: the clipping lands and its path is printed', (t) => {
  const v = vault(t);
  const page = `# Fish ${DASH} a page\nSpace: ENG · Page ID: 42 · Version: 3 · Updated: 2026-01-01\nURL: https://example.atlassian.net/wiki/spaces/ENG/pages/42\n\n---\n${BODY}`;
  const deps = { findScripts: () => 'stand-in', runPage: () => page };
  const { result, out } = capture(() => confluenceMain(['42'], deps));
  assert.equal(result.status, 'clipped');
  const files = onDisk(v.clippings);
  assert.equal(files.length, 1);
  assert.ok(out.includes(`clipped: ${files[0]} `), out);
});

test('clip-pdf figures: the clipping\'s frontmatter lists every figure the render returned, and a repeat leaves it as it is', (t) => {
  const v = vault(t);
  const clip = pdfClipContent({ title: 'D', source: 'in.pdf', text: BODY });
  writeFileSync(join(v.clippings, 'D.md'), clip.body);
  const render = () => ({
    status: 'ok', pageCount: 3, plan: { pages: [{ page: 2 }, { page: 3 }] },
    figures: ['raw/figures/D-p2.md', 'raw/figures/D-p3.md'], written: ['raw/figures/D-p2.md'], unchanged: ['raw/figures/D-p3.md'],
    kept: [], duplicates: [], failed: [], notes: [],
  });
  const add = () => capture(() => addFiguresToClipping({ pdfPath: 'in.pdf', vaultPath: v.dir, clippingRel: 'raw/clippings/D.md', fig: {}, source: 'in.pdf', title: 'D', render }));
  assert.match(add().out, /updated frontmatter figures: raw\/clippings\/D\.md \(2\)/);
  const after = readFileSync(join(v.clippings, 'D.md'), 'utf8');
  assert.match(after, /\nfigures: \["raw\/figures\/D-p2\.md", "raw\/figures\/D-p3\.md"\]\n---/);
  assert.doesNotMatch(add().out, /updated frontmatter/);
  assert.equal(readFileSync(join(v.clippings, 'D.md'), 'utf8'), after);
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
  return { tmp, outDir };
}

test('clip-gh per-file mode: each new clipping lands, and a second run counts them unchanged and writes nothing', (t) => {
  const f = checkout(t, { 'README.md': WORDS, 'docs/guide.md': WORDS });
  const run = () => capture(() => writeFileClips({ ...ghCommon, included: ['README.md', 'docs/guide.md'], outDir: f.outDir, tmp: f.tmp })).result;
  assert.equal(run().clipped, 2);
  const files = readdirSync(f.outDir).sort();
  assert.equal(files.length, 2);
  const again = run();
  assert.deepEqual([again.clipped, again.unchanged], [0, 2]);
  assert.deepEqual(readdirSync(f.outDir).sort(), files);
});

test('clip-gh per-file mode: a legacy name is carried to its safe name, leaving no copy behind', (t) => {
  const legacy = `---\nsource-hash: ${'0'.repeat(64)}\n---\nold`;
  const f = checkout(t, { '.github/workflows/ci.yml': WORDS }, { '.github-workflows-ci.yml.md': legacy });
  const { result } = capture(() => writeFileClips({ ...ghCommon, included: ['.github/workflows/ci.yml'], outDir: f.outDir, tmp: f.tmp }));
  assert.equal(result.renamed, 1);
  assert.deepEqual(readdirSync(f.outDir), ['dot-github-workflows-ci.yml.md']);
});

test('clip-gh digest mode: listings, anchors and the manifest land, and a stale file from an earlier run is pruned', (t) => {
  const f = checkout(t, { 'README.md': WORDS, 'src/a.js': 'x', 'src/b.js': 'y' }, { 'stale-from-an-earlier-run.md': 'gone soon' });
  const { result } = capture(() => writeDigest({ ...ghCommon, included: ['README.md', 'src/a.js', 'src/b.js'], excluded: [], meta: { description: null, primaryLanguage: null }, outDir: f.outDir, tmp: f.tmp }));
  const now = readdirSync(f.outDir).sort();
  assert.ok(!now.includes('stale-from-an-earlier-run.md'), 'it was pruned');
  assert.equal(result.pruned, 1);
  assert.ok(now.includes('_repo-overview.md'));
  assert.ok(now.includes('README.md'));
  assert.ok(now.some((name) => name.startsWith('_listing-')));
});
