import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as search from '../scripts/search.mjs';

const script = resolve('scripts/search.mjs');
const json = (path, value) => writeFileSync(path, JSON.stringify(value));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wm-research-search-'));
  const repo = join(root, 'repository'); mkdirSync(repo);
  execFileSync('git', ['init', repo], { stdio: 'ignore', windowsHide: true });
  const vaults = ['docs', 'second', 'first'].map(id => {
    const path = join(root, id); mkdirSync(join(path, 'wiki'), { recursive: true });
    writeFileSync(join(path, 'VAULT.md'), `---\nschema-version: 1\nvault-id: ${id}\npurpose: Example knowledge\nincludes: [Research]\nexcludes: []\n---\n`);
    writeFileSync(join(path, 'wiki/shared.md'), `# Quartz\nquartz evidence from ${id}.\n`);
    writeFileSync(join(path, 'wiki/other.md'), '---\nproject: example\n---\n# Other\nquartz findings.\n');
    return { id, path, obsidian: `example-${id}` };
  });
  const registry = { version: 1, defaultVault: 'docs', vaults };
  const configPath = join(root, 'vaults.json'); json(configPath, registry);
  const projectPath = join(repo, '.wiki-master.json');
  json(projectPath, { version: 1, project: 'example', researchVaults: ['first', 'second'] });
  const env = { ...process.env, HOME: root, USERPROFILE: root, WIKI_MASTER_CONFIG: configPath,
    WIKI_MASTER_PROJECT_ROOT: repo, OLLAMA_HOST: 'http://127.0.0.1:1', NODE_TEST_CONTEXT: 'child-v8' };
  for (const key of ['WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_NAME', 'WIKI_MASTER_VAULT_ID']) delete env[key];
  return { root, repo, env, registry, vaults, projectPath, save: () => json(configPath, registry),
    run: (args, overrides = {}) => spawnSync(process.execPath, [script, ...args], { env: { ...env, ...overrides }, cwd: root, encoding: 'utf8', windowsHide: true }) };
}
function snapshot(root) {
  return readdirSync(root, { recursive: true }).filter(p => !p.split(/[\\/]/).includes('.git')).sort().map(p => {
    const path = join(root, p), stat = statSync(path);
    return [p, stat.mtimeMs, stat.isFile() ? readFileSync(path).toString('base64') : null];
  });
}
const ids = value => value.groups.map(group => group.vault.id);

test('research CLI searches every root in route order, preserves collisions and bounds each group without inferred filtering', () => {
  const f = fixture(), before = snapshot(f.root);
  const run = f.run(['quartz', '--research', '--json', '--limit=1']);
  assert.equal(run.status, 0, run.stderr);
  const value = JSON.parse(run.stdout);
  assert.deepEqual(ids(value), ['first', 'second']);
  for (const group of value.groups) {
    assert.equal(group.status, 'ok'); assert.equal(group.results.length, 1);
    assert.equal(group.results[0].path, 'wiki/shared.md');
    assert.match(group.results[0].passage, new RegExp(group.vault.id));
    assert.equal(group.channels.keyword.wiki, 'ok'); assert.equal(group.channels.semantic, 'index-unavailable');
    assert.ok(group.diagnostics.some(d => d.code === 'metadata-incomplete'));
  }
  assert.deepEqual(snapshot(f.root), before);
});

test('selected research write target does not narrow retrieval, while explicit filters still apply per vault', () => {
  const f = fixture(), target = f.vaults.find(v => v.id === 'second');
  const run = f.run(['quartz', '--research', '--json', '--project=example'], {
    WIKI_MASTER_VAULT_ID: target.id, WIKI_MASTER_VAULT: target.path, WIKI_MASTER_VAULT_NAME: target.obsidian,
  });
  assert.equal(run.status, 0, run.stderr);
  const value = JSON.parse(run.stdout); assert.deepEqual(ids(value), ['first', 'second']);
  assert.deepEqual(value.groups.map(g => g.results.map(r => r.path)), [['wiki/other.md'], ['wiki/other.md']]);
});

test('research text groups identify results and coverage independently and leave all files unchanged', () => {
  const f = fixture(), before = snapshot(f.root);
  const run = f.run(['quartz', '--research', '--limit=1']);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.indexOf('first') < run.stdout.indexOf('second'));
  assert.equal((run.stdout.match(/wiki\/shared.md/g) ?? []).length, 2);
  assert.match(run.stderr, /first/); assert.match(run.stderr, /second/); assert.match(run.stderr, /index-unavailable/);
  assert.deepEqual(snapshot(f.root), before);
});

test('unavailable research root retains successful results and independent unsearched coverage with exit 1', () => {
  const f = fixture(); f.vaults.find(v => v.id === 'second').path = join(f.root, 'offline'); f.save();
  const before = snapshot(f.root), run = f.run(['quartz', '--research', '--json']);
  assert.equal(run.status, 1, run.stderr);
  const value = JSON.parse(run.stdout); assert.deepEqual(ids(value), ['first', 'second']);
  assert.ok(value.groups[0].results.length); assert.equal(value.groups[1].status, 'unavailable');
  assert.deepEqual(value.groups[1].results, []); assert.equal(value.groups[1].channels.keyword.wiki, 'not-searched');
  assert.ok(value.groups[1].diagnostics.some(d => d.code === 'vault-unavailable'));
  assert.deepEqual(snapshot(f.root), before);
});

test('an offline documentation destination does not block research, and a successful empty query is not failure', () => {
  const f = fixture(); f.vaults[0].path = join(f.root, 'offline-docs'); f.save();
  const run = f.run(['unmentionedword', '--research', '--json']); assert.equal(run.status, 0, run.stderr);
  const value = JSON.parse(run.stdout); assert.deepEqual(ids(value), ['first', 'second']);
  assert.ok(value.groups.every(g => g.status === 'ok' && g.results.length === 0));
});

test('a broken per-vault index fails only its group and retains later successful retrieval', () => {
  const f = fixture(), first = f.vaults.find(v => v.id === 'first');
  mkdirSync(join(first.path, '.wiki-master')); writeFileSync(join(first.path, '.wiki-master/chunks.json'), '{');
  const before = snapshot(f.root), run = f.run(['quartz', '--research', '--json']);
  assert.equal(run.status, 1, run.stderr);
  const value = JSON.parse(run.stdout); assert.equal(value.groups[0].status, 'failed');
  assert.ok(value.groups[0].diagnostics.some(d => d.code === 'retrieval-failed'));
  assert.ok(value.groups[1].results.length); assert.deepEqual(snapshot(f.root), before);
});

test('malformed routing fails before any retrieval, with exit 2 and no writes', () => {
  const f = fixture(); json(f.projectPath, { version: 1, researchVaults: ['absent'] });
  const before = snapshot(f.root), run = f.run(['quartz', '--research', '--json']);
  assert.equal(run.status, 2, run.stderr); assert.equal(run.stdout, ''); assert.match(run.stderr, /absent/);
  assert.deepEqual(snapshot(f.root), before);
});

test('ordinary selected-root search keeps its JSON and path-only text shapes and is read-only', () => {
  const f = fixture(), before = snapshot(f.root);
  const run = f.run(['quartz', '--json', '--limit=1'], { WIKI_MASTER_VAULT_ID: 'second' });
  assert.equal(run.status, 0, run.stderr);
  const value = JSON.parse(run.stdout); assert.equal(value.groups, undefined); assert.equal(value.results.length, 1);
  assert.match(value.results[0].passage, /second/);
  const plain = f.run(['quartz', '--limit=1']); assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /^wiki\/shared.md:\d+\s*$/);
  assert.deepEqual(snapshot(f.root), before);
});

test('research detects total channel failure without treating normal lexical degradation as failed', async () => {
  const f = fixture(); assert.equal(typeof search.searchResearch, 'function');
  const result = await search.searchResearch('quartz', {}, { env: f.env, createContext: options => search.createSearchContext({ ...options,
    checkAvailable: async () => false, keywordSearchFn: async () => { throw new Error('fixture scan failure'); },
  }) });
  assert.equal(result.exitCode, 1); assert.ok(result.groups.every(g => g.status === 'failed'));
  assert.ok(result.groups.every(g => g.channels.keyword.wiki === 'failed' && g.channels.semantic === 'index-unavailable'));
});

test('research CLI help and mode conflicts disclose the supported interface', () => {
  const f = fixture(); assert.match(f.run(['--help']).stdout, /--research/);
  assert.equal(f.run(['--research', '--health']).status, 2);
  assert.equal(f.run(['quartz', '--research', '--unknown']).status, 2);
});
