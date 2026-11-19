import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readVaultDescriptor, resolveContext } from '../scripts/lib/context.mjs';
import { buildGraph, computeGraphMetrics, isContent } from '../scripts/lib/graph.mjs';
import { renderCatalog } from '../scripts/lib/catalogs.mjs';
import { scaffold } from '../scripts/init.mjs';

const read = path => readFileSync(path, 'utf8');
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'wm-setup-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
}

test('root VAULT.md is structural, never content, an orphan or a catalog entry', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'VAULT.md'), '---\ntype: authored\n---\n# Vault description\n');
  const graph = buildGraph(root);
  assert.equal(isContent('VAULT.md'), false);
  assert.equal(isContent('wiki/concepts/VAULT.md'), true, 'only the root descriptor is structural');
  assert.ok(!computeGraphMetrics(graph).orphans.includes('VAULT.md'));
  assert.doesNotMatch(renderCatalog(graph), /\[\[VAULT\]\]/);
});

test('direct descriptor reads reject a file alias outside the vault', t => {
  const base = fixture(t), root = join(base, 'vault'); mkdirSync(root);
  const source = join(base, 'outside.md');
  writeFileSync(source, '---\nschema-version: 1\nvault-id: general\npurpose: General research\nincludes: [Research]\nexcludes: []\n---\n');
  const target = join(root, 'VAULT.md');
  try { symlinkSync(source, target, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return t.skip('Windows file-symlink privilege unavailable');
    throw error;
  }
  assert.throws(() => readVaultDescriptor(target, 'general'), e => e.exitCode === 2 && /outside.*vault/i.test(e.message));
});

test('setup templates register customized and empty roots, preserve reruns, and reconcile legacy defaults for tracked and ignored projects', t => {
  const base = fixture(t), general = join(base, 'general'), docs = join(base, 'docs'), repo = join(base, 'repository');
  for (const dir of [general, docs, repo]) mkdirSync(dir);
  const custom = join(general, 'vault-schema.md'); writeFileSync(custom, '# Customized schema\n');
  const before = [read(custom), statSync(custom).mtimeMs];
  for (const root of [general, docs]) scaffold(root, resolve('templates'));
  const descriptor = read('templates/setup/VAULT.md');
  for (const [root, id] of [[general, 'general'], [docs, 'docs']]) {
    writeFileSync(join(root, 'VAULT.md'), descriptor.replace('vault-id: general', `vault-id: ${id}`), { flag: 'wx' });
    assert.equal(readVaultDescriptor(join(root, 'VAULT.md'), id)['vault-id'], id);
  }
  const registry = join(base, 'vaults.json');
  writeFileSync(registry, JSON.stringify({ version: 1, defaultVault: 'general', vaults: [
    { id: 'general', path: general, obsidian: 'General' }, { id: 'docs', path: docs, obsidian: 'Docs' },
  ] }));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '-q');
  const legacy = { HOME: base, USERPROFILE: base, WIKI_MASTER_CONFIG: registry, WIKI_MASTER_VAULT: general, WIKI_MASTER_VAULT_NAME: 'General' };
  assert.equal(resolveContext(legacy, { cwd: base }).selected.id, 'general');
  const projectFile = join(repo, '.wiki-master.json');
  writeFileSync(projectFile, read('templates/setup/.wiki-master.json'));
  git('add', '.wiki-master.json');
  assert.match(git('ls-files', '.wiki-master.json'), /\.wiki-master.json/);
  assert.throws(() => resolveContext(legacy, { repo }), /root|path|selector/i, 'retained legacy default cannot bypass the project route');
  const reconciled = { ...legacy }; delete reconciled.WIKI_MASTER_VAULT; delete reconciled.WIKI_MASTER_VAULT_NAME;
  assert.equal(resolveContext(reconciled, { cwd: base }).selected.id, 'general');
  const context = resolveContext(reconciled, { repo });
  assert.equal(context.documentation.id, 'docs');
  assert.deepEqual(context.research.map(v => v.id), ['general']);
  git('rm', '--cached', '-q', '.wiki-master.json');
  writeFileSync(join(repo, '.gitignore'), '/.wiki-master.json\n');
  assert.match(git('check-ignore', '.wiki-master.json'), /\.wiki-master.json/);
  assert.equal(resolveContext(reconciled, { repo }).selected.id, 'docs');
  const descriptorBefore = read(join(general, 'VAULT.md')), projectBefore = read(projectFile), registryBefore = read(registry);
  for (const root of [general, docs]) scaffold(root, resolve('templates'));
  assert.deepEqual([read(custom), statSync(custom).mtimeMs], before);
  assert.equal(read(join(general, 'VAULT.md')), descriptorBefore);
  assert.equal(read(projectFile), projectBefore); assert.equal(read(registry), registryBefore);
  assert.equal(legacy.WIKI_MASTER_VAULT, general, 'task environment reconciliation never edits the parent environment');
});

test('role guidance exposes routing before research and authoring', () => {
  const research = read('skills/wiki-researcher/SKILL.md'), search = read('skills/wiki-search/SKILL.md');
  assert.match(research, /request start|start of (?:every|each|a) research request/i);
  assert.match(research, /ask (?:exactly )?once/i);
  assert.match(research, /next request/i);
  assert.match(search, /--research/);
  assert.match(read('skills/wiki-project/SKILL.md'), /--purpose documentation/);
  assert.match(read('skills/wiki-setup/references/routing.md'), /WIKI_MASTER_VAULT_NAME/);
});
