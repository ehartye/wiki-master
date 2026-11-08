import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { walkVault } from '../scripts/lib/embedding.mjs';
import { scanIntegrity, integrityReport } from '../scripts/lib/integrity.mjs';

// The vault walks (buildGraph for the graph scripts, walkVault for the retrieval index) follow links, so a vault
// reached through a junction keeps working. One link cycle, a dangling or self-referential link, or a file removed
// by a pull in the middle of a walk is skipped and named in skippedPaths instead of aborting the whole run.
// Directory links are made as junctions: on Windows they need no privilege, elsewhere the type is ignored and an
// ordinary symbolic link is made.

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-graph-walk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text = '# Page\n\nBody.\n') => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put('wiki/concepts/alpha.md');
  put('wiki/sources/beta.md');
  put('moc/project.md');
  put('raw/clippings/clip.md');
  const link = (path, target) => { mkdirSync(dirname(join(root, path)), { recursive: true }); symlinkSync(target, join(root, path), 'junction'); };
  return { root, put, link };
}

const graphPaths = (root, options) => buildGraph(root, options).pages.map(p => p.path).sort();
const walkPaths = (root, skippedPaths) => walkVault(root, skippedPaths).map(f => f.path).sort();
const statCode = (abs) => { try { statSync(abs); return null; } catch (error) { return error.code; } };

test('a junction back to an ancestor is skipped as link-cycle and every other page is still read', t => {
  const { root, link } = fixture(t);
  link('wiki/concepts/loop', root);
  link('moc/up', join(root, 'moc'));
  const graph = buildGraph(root);
  assert.deepEqual(graph.skippedPaths.sort((a, b) => a.path < b.path ? -1 : 1), [
    { path: 'moc/up', reason: 'link-cycle' },
    { path: 'wiki/concepts/loop', reason: 'link-cycle' },
  ]);
  assert.deepEqual(graph.pages.map(p => p.path).sort(), ['moc/project.md', 'raw/clippings/clip.md', 'wiki/concepts/alpha.md', 'wiki/sources/beta.md']);
  const skippedPaths = [];
  assert.deepEqual(walkPaths(root, skippedPaths), ['moc/project.md', 'wiki/concepts/alpha.md', 'wiki/sources/beta.md']);
  assert.deepEqual(skippedPaths.map(s => s.reason), ['link-cycle', 'link-cycle']);
});

test('a junction to a directory that is not an ancestor is an alias, walked again under its own path', t => {
  const { root, link } = fixture(t);
  link('a/link', join(root, 'wiki'));
  link('wiki/authored/mirror', join(root, 'moc'));
  const graph = buildGraph(root);
  assert.deepEqual(graph.skippedPaths, []);
  assert.deepEqual(graph.pages.map(p => p.path).sort(), [
    'a/link/authored/mirror/project.md', 'a/link/concepts/alpha.md', 'a/link/sources/beta.md',
    'moc/project.md', 'raw/clippings/clip.md',
    'wiki/authored/mirror/project.md', 'wiki/concepts/alpha.md', 'wiki/sources/beta.md',
  ]);
  const skippedPaths = [];
  assert.deepEqual(walkPaths(root, skippedPaths), ['moc/project.md', 'wiki/authored/mirror/project.md', 'wiki/concepts/alpha.md', 'wiki/sources/beta.md']);
  assert.deepEqual(skippedPaths, []);
});

test('a self-referential link is ELOOP and a dangling link ENOENT; neither throws', t => {
  const { root, link } = fixture(t);
  link('wiki/concepts/self', join(root, 'wiki', 'concepts', 'self'));
  link('wiki/sources/gone', join(root, 'nowhere'));
  const byPath = (list) => Object.fromEntries(list.map(s => [s.path, s.reason]));
  const graph = buildGraph(root);
  assert.deepEqual(byPath(graph.skippedPaths), { 'wiki/concepts/self': 'ELOOP', 'wiki/sources/gone': 'ENOENT' });
  assert.equal(graph.pages.length, 4);
  const skippedPaths = [];
  assert.equal(walkVault(root, skippedPaths).length, 3);
  assert.deepEqual(byPath(skippedPaths), { 'wiki/concepts/self': 'ELOOP', 'wiki/sources/gone': 'ENOENT' });
  assert.doesNotThrow(() => walkVault(root), 'the array argument is optional');
});

test('a link whose target name is too long is skipped with ENAMETOOLONG where the platform reports that', t => {
  const { root, link } = fixture(t);
  link('wiki/concepts/long', join(root, 'x'.repeat(300)));
  const code = statCode(join(root, 'wiki', 'concepts', 'long'));
  if (code !== 'ENAMETOOLONG') { t.skip(`this platform reports ${code} for an over-long name, not ENAMETOOLONG`); return; }
  assert.deepEqual(buildGraph(root).skippedPaths, [{ path: 'wiki/concepts/long', reason: 'ENAMETOOLONG' }]);
  const skippedPaths = [];
  walkVault(root, skippedPaths);
  assert.deepEqual(skippedPaths, [{ path: 'wiki/concepts/long', reason: 'ENAMETOOLONG' }]);
});

test('a file removed between the directory listing and the read is skipped with ENOENT', t => {
  const { root } = fixture(t);
  const readFile = (abs, encoding) => {
    if (abs.endsWith('alpha.md')) unlinkSync(abs); // a pull removed it after readdirSync listed it
    return readFileSync(abs, encoding);
  };
  const graph = buildGraph(root, { readFile });
  assert.deepEqual(graph.skippedPaths, [{ path: 'wiki/concepts/alpha.md', reason: 'ENOENT' }]);
  assert.deepEqual(graph.pages.map(p => p.path).sort(), ['moc/project.md', 'raw/clippings/clip.md', 'wiki/sources/beta.md']);
});

test('an error the walk does not expect is rethrown, not skipped', t => {
  const { root } = fixture(t);
  const failure = Object.assign(new Error('disk on fire'), { code: 'EIO' });
  assert.throws(() => buildGraph(root, { readFile: () => { throw failure; } }), failure);
});

test('a symbolic link to a file is read as a page where the platform allows making one', t => {
  const { root } = fixture(t);
  try { symlinkSync(join(root, 'wiki', 'concepts', 'alpha.md'), join(root, 'wiki', 'concepts', 'alias.md'), 'file'); } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip(`this platform refuses a file symbolic link (${error.code})`); return; }
    throw error;
  }
  assert.ok(graphPaths(root).includes('wiki/concepts/alias.md'));
  assert.ok(walkPaths(root).includes('wiki/concepts/alias.md'));
});

test('a walk with nothing to skip returns an empty skippedPaths and the pages it always did', t => {
  const { root } = fixture(t);
  const graph = buildGraph(root);
  assert.deepEqual(graph.skippedPaths, []);
  assert.deepEqual(Object.keys(graph).sort(), ['pages', 'skippedPaths']);
  assert.deepEqual(graph.pages.map(p => p.path).sort(), ['moc/project.md', 'raw/clippings/clip.md', 'wiki/concepts/alpha.md', 'wiki/sources/beta.md']);
});

test('scanIntegrity passes skippedPaths through only when there are some, and the health report counts them', t => {
  const { root, link } = fixture(t);
  const clean = scanIntegrity(root);
  assert.equal('skippedPaths' in clean, false);
  assert.doesNotMatch(integrityReport(clean), /Skipped paths/);
  link('wiki/concepts/loop', root);
  const r = scanIntegrity(root);
  assert.deepEqual(r.skippedPaths, [{ path: 'wiki/concepts/loop', reason: 'link-cycle' }]);
  assert.match(integrityReport(r), /^Skipped paths: 1 \(unscored\)/m);
  assert.equal(r.defectCount, clean.defectCount, 'a skipped path is a notice, not a defect');
});
