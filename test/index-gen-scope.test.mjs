import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { refreshCatalogs } from '../scripts/refresh-catalogs.mjs';
import { regenerateIndex } from '../scripts/index-gen.mjs';
import { scopeGraph } from '../scripts/lib/catalog-scope.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

// The command the ingest skill names is plain `index-gen.mjs`, which lists every page on disk, another
// writer's uncommitted ones included. With `--paths-file` it scopes the way `refresh-catalogs.mjs` does.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
function page(root, rel, kind = 'note') {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), `---\ntype: authored\nproject: alpha\nkind: ${kind}\nsources: []\n---\n# ${rel}\n`);
}
function world(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-idx-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'a@b.c'); git(root, 'config', 'user.name', 'a'); git(root, 'config', 'core.autocrlf', 'false');
  page(root, 'wiki/authored/alpha/overview.md', 'overview');
  page(root, 'wiki/authored/alpha/base.md');
  refreshCatalogs(root, { project: 'alpha', apply: true });
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  return root;
}
const OURS = 'wiki/authored/alpha/ours.md';
const has = (text, name) => new RegExp(`\\[\\[(?:[^\\]|]*/)?${name}(?:\\.md)?(?:\\|[^\\]]*)?\\]\\]`).test(text);
const run = (root, args) => spawnSync(process.execPath, [join(SCRIPTS, 'index-gen.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });
const ledger = (root, paths) => { const f = join(root, '..', `ledger-${Date.now()}.json`); writeFileSync(f, JSON.stringify(paths)); return f; };

test('scopeGraph splits the graph into committed-or-owned pages and the rest', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/foreign.md');
  page(root, OURS);
  const { graph, excluded } = scopeGraph(root, buildGraph(root), [OURS]);
  assert.ok(graph.pages.some((p) => p.path === OURS));
  assert.ok(graph.pages.some((p) => p.path === 'wiki/authored/alpha/base.md'));
  assert.deepEqual(excluded.map((p) => p.path), ['wiki/authored/alpha/foreign.md']);
});

test('index-gen --paths-file leaves out the other writer\'s uncommitted page and adds ours', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/foreign.md');
  page(root, OURS);
  const r = run(root, ['--paths-file', ledger(root, [OURS])]);
  assert.equal(r.status, 0, r.stderr);
  const index = readFileSync(join(root, 'index.md'), 'utf8');
  assert.ok(has(index, 'ours'));
  assert.ok(!has(index, 'foreign'), 'the other writer\'s page was listed');
});

test('index-gen --paths-file keeps a line the other writer\'s own run put there', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/foreign.md');
  regenerateIndex(root); // the other writer's run lists their page
  assert.ok(has(readFileSync(join(root, 'index.md'), 'utf8'), 'foreign'));
  page(root, OURS);
  assert.equal(run(root, ['--paths-file', ledger(root, [OURS])]).status, 0);
  const index = readFileSync(join(root, 'index.md'), 'utf8');
  assert.ok(has(index, 'foreign'), 'the other writer\'s line was removed');
  assert.ok(has(index, 'ours'));
});

test('plain index-gen still lists every page on disk', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/foreign.md');
  assert.equal(run(root, []).status, 0);
  assert.ok(has(readFileSync(join(root, 'index.md'), 'utf8'), 'foreign'));
});

test('index-gen refuses a bad ledger and an unknown option in one line, exit 2, and writes nothing', (t) => {
  const root = world(t);
  const before = readFileSync(join(root, 'index.md'), 'utf8');
  for (const args of [['--paths-file', join(root, 'missing.json')], ['--bogus'], ['--paths-file'], ['--paths-file', ledger(root, ['../escape.md'])]]) {
    const r = run(root, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr.trim().split('\n').length, 1, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /^index-gen: /);
  }
  assert.equal(readFileSync(join(root, 'index.md'), 'utf8'), before);
});

test('index-gen --help names the option', () => {
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'index-gen.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--paths-file/);
});
