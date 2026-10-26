import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileClipContent, writeFileClips, writeDigest, repoClipFileName } from '../scripts/clip-gh.mjs';

// `clip-gh` named a clipping `<path slug>.md`, so a repository's README.md became `README.md.md`. A new
// clipping no longer doubles the extension. A doubled file that already exists for a path stays where it
// is and keeps being written to: renaming it here would break the citations to it, and the rename
// migration (scripts/rename-doubled-extension-clippings.mjs) moves it together with its citations.

const WORDS = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
const ctx = { owner: 'o', repo: 'r', ref: 'abc123', quality: 'medium', created: '2026-01-01' };
const common = { owner: 'o', repo: 'r', resolvedRef: 'abc123', quality: 'medium' };

function setup(t, checkout, outFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clipgh-names-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tmp = join(root, 'checkout');
  const outDir = join(root, 'out');
  mkdirSync(outDir, { recursive: true });
  for (const [path, text] of Object.entries(checkout)) {
    mkdirSync(dirname(join(tmp, path)), { recursive: true });
    writeFileSync(join(tmp, path), text);
  }
  for (const [name, text] of Object.entries(outFiles)) writeFileSync(join(outDir, name), text);
  return { tmp, outDir, names: () => readdirSync(outDir).sort(), read: (n) => readFileSync(join(outDir, n), 'utf8') };
}
const clipOf = (relPath, content) => fileClipContent({ ...ctx, relPath, content });
const quiet = (fn) => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const run = (f, included) => writeFileClips({ ...common, included, outDir: f.outDir, tmp: f.tmp });

test('repoClipFileName never doubles the extension for a new file', () => {
  assert.equal(repoClipFileName('README.md'), 'README.md');
  assert.equal(repoClipFileName('skills/unreal-mcp/SKILL.md'), 'skills-unreal-mcp-SKILL.md');
  assert.equal(repoClipFileName('src/a.js'), 'src-a.js.md');
  assert.equal(repoClipFileName('.github/workflows/ci.yml'), 'dot-github-workflows-ci.yml.md');
});

test('a fresh clip writes README.md as README.md and a source file with its own extension kept', (t) => {
  const f = setup(t, { 'README.md': WORDS, 'src/a.js': WORDS });
  const r = run(f, ['README.md', 'src/a.js']);
  assert.deepEqual(f.names(), ['README.md', 'src-a.js.md']);
  assert.deepEqual([r.clipped, r.unchanged], [2, 0]);
});

test('a doubled file that already exists is kept: an unchanged re-clip writes nothing and makes no second copy', (t) => {
  const old = clipOf('README.md', WORDS).body;
  const f = setup(t, { 'README.md': WORDS }, { 'README.md.md': old });
  const r = run(f, ['README.md']);
  assert.deepEqual(f.names(), ['README.md.md']);
  assert.deepEqual([r.clipped, r.unchanged], [0, 1]);
  assert.equal(f.read('README.md.md'), old);
});

test('a doubled file whose source changed is updated in place, still one file', (t) => {
  const f = setup(t, { 'README.md': `${WORDS} new` }, { 'README.md.md': clipOf('README.md', `${WORDS} old`).body });
  const r = run(f, ['README.md']);
  assert.deepEqual(f.names(), ['README.md.md']);
  assert.equal(r.clipped, 1);
  assert.match(f.read('README.md.md'), /word39 new/);
});

test('after the rename migration the new name is used and nothing is duplicated', (t) => {
  const f = setup(t, { 'README.md': WORDS }, { 'README.md': clipOf('README.md', WORDS).body });
  const r = run(f, ['README.md']);
  assert.deepEqual(f.names(), ['README.md']);
  assert.deepEqual([r.clipped, r.unchanged], [0, 1]);
});

test('two paths that would share one new name both keep a file: the second falls back to the doubled form', (t) => {
  const f = setup(t, { LICENSE: `${WORDS} plain`, 'LICENSE.md': `${WORDS} markdown` });
  const r = run(f, ['LICENSE', 'LICENSE.md']);
  assert.deepEqual(f.names(), ['LICENSE.md', 'LICENSE.md.md']);
  assert.equal(r.clipped, 2);
  assert.match(f.read('LICENSE.md'), /plain/);
  assert.match(f.read('LICENSE.md.md'), /markdown/);
});

test('digest mode keeps a doubled anchor instead of pruning it, and names a new anchor without the double', (t) => {
  const old = clipOf('README.md', WORDS).body;
  const f = setup(t, { 'README.md': WORDS, 'CONTRIBUTING.md': `${WORDS} contributing`, 'src/a.js': 'x' }, { 'README.md.md': old });
  quiet(() => writeDigest({ ...common, included: ['README.md', 'CONTRIBUTING.md', 'src/a.js'], excluded: [], meta: {}, outDir: f.outDir, tmp: f.tmp }));
  assert.ok(f.names().includes('README.md.md'), `the doubled anchor survives: ${f.names()}`);
  assert.ok(!f.names().includes('README.md'), 'no second copy');
  assert.ok(f.names().includes('CONTRIBUTING.md'), `a new anchor has no doubled name: ${f.names()}`);
  assert.equal(f.read('README.md.md'), old);
});
