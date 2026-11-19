import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildGraph, markdownPage, graphCacheKey, GRAPH_CACHE_FILE } from '../scripts/lib/graph.mjs';
import { readGraphCache } from '../scripts/lib/graph-cache-read.mjs';
import { writeGraphCache } from '../scripts/lib/graph-cache-write.mjs';
import { walkVault, refreshIndex } from '../scripts/lib/embedding.mjs';
import { writeDriftState } from '../scripts/lib/drift-state.mjs';
import { readClippings } from '../scripts/lib/known-urls.mjs';
import { resolveContext } from '../scripts/lib/context.mjs';
import { validateAuthored } from '../scripts/validate-authored.mjs';
import { writeLogEntry } from '../scripts/log-entry.mjs';
import { regenerateAuthoredMocs } from '../scripts/lib/catalogs.mjs';
import { createSearchContext, main as search } from '../scripts/search.mjs';

function fixture(t) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'wm-boundary-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'local'), registered = join(base, 'registered'), outside = join(base, 'outside');
  for (const dir of [root, registered, outside]) mkdirSync(dir);
  const put = (dir, path, text = '# Boundary needle\n\nEvidence text.\n') => {
    const file = join(dir, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return file;
  };
  const link = (rel, target) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); symlinkSync(target, join(root, rel), 'junction'); };
  put(root, 'wiki/concepts/local.md');
  put(registered, 'Foreign.md'); put(outside, 'External.md');
  for (const [dir, id] of [[root, 'local'], [registered, 'registered']]) {
    put(dir, 'VAULT.md', `---\nschema-version: 1\nvault-id: ${id}\npurpose: Fixture documentation and research\nincludes: [Documentation, Research]\nexcludes: []\n---\n`);
  }
  // The boundary is filesystem-based and applies equally to roots known and unknown to routing.
  put(base, 'vaults.json', JSON.stringify({ version: 1, defaultVault: 'local', vaults: [
    { id: 'local', path: root, obsidian: 'Local' }, { id: 'registered', path: registered, obsidian: 'Registered' },
  ] }));
  return { base, root, registered, outside, put, link };
}

test('graph and embedding walk exclude registered/unregistered outside aliases, preserve internal aliases and local citations', t => {
  const { base, root, registered, outside, put, link } = fixture(t);
  const context = resolveContext({ HOME: base, WIKI_MASTER_CONFIG: join(base, 'vaults.json') }, { cwd: base });
  assert.equal(context.selected.path, root);
  link('wiki/sources/registered', registered); link('wiki/sources/outside', outside);
  link('wiki/concepts/internal', join(root, 'wiki/concepts/local-folder'));
  put(root, 'wiki/concepts/local-folder/inside.md');
  put(root, 'wiki/authored/example/overview.md', '---\ntype: authored\nsources: ["[[Foreign]]"]\n---\n# Overview\n');
  const graph = buildGraph(root), skipped = [];
  assert.ok(graph.pages.some(p => p.path === 'wiki/concepts/internal/inside.md'));
  assert.ok(!graph.pages.some(p => /Foreign|External/.test(p.path)));
  assert.deepEqual(graph.skippedPaths.filter(p => p.reason === 'outside-vault').map(p => p.path).sort(), ['wiki/sources/outside', 'wiki/sources/registered']);
  assert.ok(!walkVault(root, skipped).some(p => /Foreign|External/.test(p.path)));
  assert.equal(skipped.filter(p => p.reason === 'outside-vault').length, 2);
  const validation = validateAuthored(root, ['wiki/authored/example/overview.md']);
  assert.ok(validation.defects.some(d => d.rule === 'unresolved-citation' && d.message.includes('Foreign')));
  assert.equal(validation.skippedPaths.filter(p => p.reason === 'outside-vault').length, 2);
});

test('an escaping explicit ledger target is refused even when the leaf does not exist or is normally skipped', t => {
  const { root, outside, link } = fixture(t);
  link('wiki/authored/foreign', outside); link('raw/foreign', outside);
  for (const path of ['wiki/authored/foreign/External.md', 'wiki/authored/foreign/new.md', 'raw/foreign/new.md']) {
    assert.throws(() => validateAuthored(root, [path]), /outside.*vault/i);
  }
});

test('old graph cache records cannot replay a foreign alias', t => {
  const { root, outside, link, put } = fixture(t);
  link('wiki/sources/foreign', outside);
  const path = 'wiki/sources/foreign/External.md', stat = statSync(join(root, path));
  const cache = { ...graphCacheKey(root, 'test'), entries: { [path]: { size: stat.size, mtimeMs: stat.mtimeMs, page: markdownPage(path, readFileSync(join(root, path), 'utf8')) } } };
  put(root, GRAPH_CACHE_FILE, JSON.stringify(cache));
  const loaded = readGraphCache(root, { derive: 'test' });
  assert.ok(loaded);
  const graph = buildGraph(root, { cache: loaded });
  assert.ok(!graph.pages.some(p => p.path === path));
  assert.deepEqual(graph.skippedPaths, [{ path: 'wiki/sources/foreign', reason: 'outside-vault' }]);
});

test('keyword search and stale index candidates exclude foreign aliases with coverage, including an aliased scope', async t => {
  const { root, outside, link, put } = fixture(t);
  link('wiki/sources/foreign', outside); link('raw', outside);
  const path = 'wiki/sources/foreign/External.md';
  put(root, '.wiki-master/chunks.json', JSON.stringify({ [path]: { title: 'Boundary needle', chunks: [], metadataVersion: 2, metadata: {}, aliases: [] } }));
  const context = await createSearchContext({ vaultPath: root, checkAvailable: async () => false });
  const result = await search('Boundary needle', { context, includeRaw: true });
  assert.ok(result.results.some(p => p.path === 'wiki/concepts/local.md'));
  assert.ok(!result.results.some(p => /External/.test(p.path)));
  assert.ok(result.diagnostics.some(d => d.code === 'outside-vault' && d.path === 'wiki/sources/foreign'));
  assert.ok(result.diagnostics.some(d => d.code === 'outside-vault' && d.path === 'raw'));
  // An injected keyword/semantic candidate still passes the live root guard.
  context.keywordSearchFn = async () => [path];
  const replay = await search('Boundary needle', { context });
  assert.ok(!replay.results.some(p => p.path === path));
});

test('log, graph cache and catalog destinations refuse external aliases without writing outside', t => {
  const { root, outside, link } = fixture(t);
  link('log', outside); link('.wiki-master', outside); link('moc', outside);
  const before = readFileSync(join(outside, 'External.md'), 'utf8');
  assert.throws(() => writeLogEntry({ vaultPath: root, op: 'test', title: 'Boundary' }), /outside.*vault/i);
  assert.throws(() => writeGraphCache(root, new Map(), { builtAtMs: Date.now() }), /outside.*vault/i);
  assert.equal(readFileSync(join(outside, 'External.md'), 'utf8'), before);
  const pages = ['overview', 'architecture'].map(name => markdownPage(`wiki/authored/example/${name}.md`, '---\ntype: authored\nproject: example\nkind: overview\n---\n# Example\n'));
  assert.throws(() => regenerateAuthoredMocs(root, { graph: { pages }, apply: true }), /outside.*vault/i);
});

test('internal aliases remain readable by keyword search and writable by logs', async t => {
  const { root, put, link } = fixture(t);
  put(root, 'notes/note.md');
  link('wiki/internal', join(root, 'notes')); link('log', join(root, 'notes'));
  const result = await search('Boundary needle', { context: await createSearchContext({ vaultPath: root, checkAvailable: async () => false }) });
  assert.ok(result.results.some(p => p.path === 'wiki/internal/note.md'));
  assert.ok(!result.diagnostics.some(d => d.code === 'outside-vault'));
  const path = writeLogEntry({ vaultPath: root, op: 'test', title: 'Internal' });
  assert.match(readFileSync(join(root, path), 'utf8'), /Internal/);
});

test('foreign cache directory is disclosed without losing local search, and index/state writes refuse it', async t => {
  const { root, outside, link } = fixture(t);
  link('.wiki-master', outside);
  const context = await createSearchContext({ vaultPath: root, checkAvailable: async () => false });
  const result = await search('Boundary needle', { context });
  assert.ok(result.results.some(p => p.path === 'wiki/concepts/local.md'));
  assert.ok(result.diagnostics.some(d => d.code === 'outside-vault' && d.path === '.wiki-master'));
  await assert.rejects(refreshIndex({ vaultPath: root, dir: join(root, '.wiki-master'), checkAvailable: async () => false }), /outside.*vault/i);
  assert.throws(() => writeDriftState(join(root, '.wiki-master'), root, {}), /outside.*vault/i);
  link('raw/clippings', outside);
  assert.throws(() => readClippings(root), /outside.*vault/i);
});

test('file aliases and dangling write aliases cannot escape the selected root', async t => {
  const { root, outside, put } = fixture(t);
  try { symlinkSync(join(outside, 'External.md'), join(root, 'wiki/concepts/foreign.md'), 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('file symlinks unavailable'); return; } throw error; }
  symlinkSync(join(outside, 'not-created.md'), join(root, 'wiki/concepts/new.md'), 'file');
  assert.ok(!buildGraph(root).pages.some(p => p.path === 'wiki/concepts/foreign.md'));
  assert.throws(() => validateAuthored(root, ['wiki/concepts/new.md']), /outside.*vault/i);
  put(root, '.wiki-master/local.json', '{}');
  symlinkSync(join(outside, 'External.md'), join(root, '.wiki-master/chunks.json'), 'file');
  const result = await search('Boundary needle', { context: await createSearchContext({ vaultPath: root, checkAvailable: async () => false }) });
  assert.ok(result.diagnostics.some(d => d.code === 'outside-vault' && d.path === '.wiki-master'));
});
