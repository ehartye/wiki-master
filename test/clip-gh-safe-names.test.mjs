import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileClipContent, writeFileClips, writeDigest } from '../scripts/clip-gh.mjs';

// A clipping written before names were made safe sits at `.github-x.md`. A re-clip
// must carry it to `dot-github-x.md` and keep it; in digest mode, which deletes every
// .md it did not just name, forgetting this would delete the clipping.

const WORDS = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
const ctx = { owner: 'o', repo: 'r', ref: 'abc123', quality: 'medium', created: '2026-01-01' };

function setup(t, checkout, outFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clipgh-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tmp = join(root, 'checkout');
  const outDir = join(root, 'out');
  mkdirSync(outDir, { recursive: true });
  for (const [path, text] of Object.entries(checkout)) {
    mkdirSync(dirname(join(tmp, path)), { recursive: true });
    writeFileSync(join(tmp, path), text);
  }
  for (const [name, text] of Object.entries(outFiles)) writeFileSync(join(outDir, name), text);
  return { tmp, outDir, names: () => readdirSync(outDir).sort() };
}
const clipOf = (relPath, content) => fileClipContent({ ...ctx, relPath, content });
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const common = { owner: 'o', repo: 'r', resolvedRef: 'abc123', quality: 'medium' };

test('a fresh clip of a dot-leading file is written under a name Obsidian can see', (t) => {
  const f = setup(t, { '.github/workflows/ci.yml': WORDS, 'README.md': WORDS });
  const r = writeFileClips({ ...common, included: ['.github/workflows/ci.yml', 'README.md'], outDir: f.outDir, tmp: f.tmp });
  assert.deepEqual(f.names(), ['README.md', 'dot-github-workflows-ci.yml.md']); // a new README is not doubled
  assert.deepEqual([r.clipped, r.unchanged, r.renamed], [2, 0, 0]);
});

test('an unchanged legacy clipping is renamed, keeping its content, not clipped twice', (t) => {
  const legacy = clipOf('.github/workflows/ci.yml', WORDS).body;
  const f = setup(t, { '.github/workflows/ci.yml': WORDS }, { '.github-workflows-ci.yml.md': legacy });
  const r = writeFileClips({ ...common, included: ['.github/workflows/ci.yml'], outDir: f.outDir, tmp: f.tmp });
  assert.deepEqual(f.names(), ['dot-github-workflows-ci.yml.md']);
  assert.equal(readFileSync(join(f.outDir, 'dot-github-workflows-ci.yml.md'), 'utf8'), legacy);
  assert.deepEqual([r.clipped, r.unchanged, r.renamed], [0, 1, 1]);
});

test('a legacy clipping whose source changed is renamed, then updated in place: one file, new content', (t) => {
  const legacy = clipOf('.github/workflows/ci.yml', `${WORDS} old`).body;
  const f = setup(t, { '.github/workflows/ci.yml': `${WORDS} new` }, { '.github-workflows-ci.yml.md': legacy });
  const r = writeFileClips({ ...common, included: ['.github/workflows/ci.yml'], outDir: f.outDir, tmp: f.tmp });
  assert.deepEqual(f.names(), ['dot-github-workflows-ci.yml.md']);
  assert.ok(readFileSync(join(f.outDir, 'dot-github-workflows-ci.yml.md'), 'utf8').includes('word39 new'));
  assert.deepEqual([r.clipped, r.unchanged, r.renamed], [1, 0, 1]);
});

test('re-clipping after adoption changes nothing', (t) => {
  const f = setup(t, { '.github/workflows/ci.yml': WORDS }, { '.github-workflows-ci.yml.md': clipOf('.github/workflows/ci.yml', WORDS).body });
  const args = { ...common, included: ['.github/workflows/ci.yml'], outDir: f.outDir, tmp: f.tmp };
  writeFileClips(args);
  const again = writeFileClips(args);
  assert.deepEqual(f.names(), ['dot-github-workflows-ci.yml.md']);
  assert.deepEqual([again.clipped, again.unchanged, again.renamed], [0, 1, 0]);
});

test('a legacy file is not renamed over an existing current file', (t) => {
  const f = setup(t, { '.github/workflows/ci.yml': WORDS }, {
    '.github-workflows-ci.yml.md': 'legacy copy',
    'dot-github-workflows-ci.yml.md': clipOf('.github/workflows/ci.yml', WORDS).body,
  });
  const r = writeFileClips({ ...common, included: ['.github/workflows/ci.yml'], outDir: f.outDir, tmp: f.tmp });
  assert.equal(r.renamed, 0);
  assert.equal(readFileSync(join(f.outDir, '.github-workflows-ci.yml.md'), 'utf8'), 'legacy copy');
});

test('digest mode keeps an unchanged legacy anchor instead of pruning it as stale', (t) => {
  const legacy = clipOf('.github/CONTRIBUTING.md', WORDS).body;
  const f = setup(t, { '.github/CONTRIBUTING.md': WORDS, 'src/a.js': 'x', 'README.md': WORDS }, { '.github-CONTRIBUTING.md.md': legacy });
  const r = quiet(() => writeDigest({
    ...common, included: ['.github/CONTRIBUTING.md', 'README.md', 'src/a.js'], excluded: [],
    meta: { description: null, primaryLanguage: null }, outDir: f.outDir, tmp: f.tmp,
  }));
  assert.ok(f.names().includes('dot-github-CONTRIBUTING.md.md'), `anchor survives under its current name: ${f.names()}`);
  assert.ok(!f.names().includes('.github-CONTRIBUTING.md.md'));
  assert.equal(readFileSync(join(f.outDir, 'dot-github-CONTRIBUTING.md.md'), 'utf8'), legacy);
  assert.equal(r.anchorsRenamed, 1);
  assert.equal(r.pruned, 0);
});
