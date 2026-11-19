import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, statSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolveContext, requireSelectedTarget, contextEnv } from '../scripts/lib/context.mjs';
import { resolveVault, commandForms } from '../scripts/lib/vault.mjs';

const script = resolve('scripts/context.mjs');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const json = (path, value) => writeFileSync(path, JSON.stringify(value));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-context-'));
  const repo = join(root, 'repository'); mkdirSync(repo); git(repo, 'init');
  const env = { HOME: root, USERPROFILE: root, NODE_TEST_CONTEXT: 'child-v8' };
  const entries = ['general', 'docs', 'research'].map(id => {
    const path = join(root, id); mkdirSync(path);
    writeFileSync(join(path, 'VAULT.md'), `---\nschema-version: 1\nvault-id: ${id}\npurpose: Example purpose\nincludes: [Documentation, Research]\nexcludes: []\n---\nOwn content only.\n`);
    return { id, path, obsidian: `selector-${id}` };
  });
  const registry = { version: 1, defaultVault: 'general', vaults: entries };
  env.WIKI_MASTER_CONFIG = join(root, 'vaults.json'); json(env.WIKI_MASTER_CONFIG, registry);
  const projectPath = join(repo, '.wiki-master.json');
  return { root, repo, env, entries, registry, projectPath, setProject: v => json(projectPath, v), save: () => json(env.WIKI_MASTER_CONFIG, registry), context: options => resolveContext(env, { cwd: repo, ...options }) };
}
function snapshot(root) {
  return readdirSync(root, { recursive: true }).filter(p => !p.split(/[\\/]/).includes('.git')).map(p => {
    const path = join(root, p), stat = statSync(path);
    return [p, stat.mtimeMs, stat.isFile() ? readFileSync(path).toString('base64') : null];
  });
}

test('global defaults and independent project overrides are read-only', t => {
  const f = fixture(t);
  let c = f.context(); assert.equal(c.documentation.id, 'general'); assert.deepEqual(c.research.map(v => v.id), ['general']);
  f.setProject({ version: 1, project: 'sample/subproject', documentationVault: 'docs' });
  const before = snapshot(f.root);
  c = f.context(); assert.equal(c.project, 'sample/subproject'); assert.equal(c.documentation.id, 'docs');
  assert.equal(c.documentation.projectPath, join(realpathSync(f.entries[1].path), 'wiki', 'authored', 'sample', 'subproject'));
  assert.deepEqual(c.research.map(v => v.id), ['general']); assert.deepEqual(snapshot(f.root), before);
  f.setProject({ version: 1, researchVaults: ['research', 'docs'] });
  c = f.context({ purpose: 'research' }); assert.equal(c.documentation.id, 'general'); assert.deepEqual(c.research.map(v => v.id), ['research', 'docs']);
  assert.equal(c.selected, null); assert.equal(c.selectionRequired, true);
  assert.throws(() => requireSelectedTarget(c), /select.*research/i);
  assert.equal(f.context({ purpose: 'research', select: 'docs' }).selected.id, 'docs');
  assert.throws(() => f.context({ purpose: 'research', select: 'general' }), /not.*research/i);
  assert.throws(() => f.context({ select: 'docs' }), /documentation/i);
  assert.equal(f.context({ purpose: 'maintenance', select: 'docs' }).selected.id, 'docs');
});

test('configured roots and selectors validate instead of overriding, child context stays explicit', t => {
  const f = fixture(t); f.setProject({ version: 1, documentationVault: 'docs', researchVaults: ['research'] });
  const c = f.context({ purpose: 'research' }); assert.equal(c.selected.id, 'research');
  const child = contextEnv(c, f.env);
  assert.equal(child.WIKI_MASTER_PROJECT_ROOT, realpathSync(f.repo)); assert.equal(child.WIKI_MASTER_CONFIG, f.env.WIKI_MASTER_CONFIG);
  assert.equal(child.WIKI_MASTER_VAULT_ID, 'research'); assert.equal(child.WIKI_MASTER_VAULT_NAME, 'selector-research');
  assert.deepEqual(resolveVault(child, { purpose: 'research' }), { path: realpathSync(f.entries[2].path), name: 'selector-research' });
  assert.throws(() => resolveContext({ ...child, WIKI_MASTER_VAULT_NAME: 'wrong' }, { purpose: 'research' }), /selector/i);
  assert.throws(() => resolveContext({ ...child, WIKI_MASTER_VAULT: f.entries[0].path }, { purpose: 'research' }), /root|path/i);
  assert.throws(() => resolveContext(child, { purpose: 'research', select: 'docs' }), /conflict/i);
  for (const form of Object.values(commandForms('script.mjs', '', child))) {
    for (const key of ['WIKI_MASTER_PROJECT_ROOT', 'WIKI_MASTER_CONFIG', 'WIKI_MASTER_VAULT_ID']) assert.ok(form.includes(key));
  }
  f.setProject({ version: 1, researchVaults: ['docs'] });
  assert.throws(() => resolveContext(child, { purpose: 'research' }), /research/i);
});

test('registry schema, references, descriptors and canonical root collisions fail closed', t => {
  const cases = [
    r => { r.version = 2; }, r => { r.extra = true; }, r => { r.defaultVault = 'absent'; },
    r => { r.vaults.push({ ...r.vaults[0] }); }, r => { r.vaults[1].obsidian = r.vaults[0].obsidian; },
    r => { r.vaults[1].path = r.vaults[0].path; }, r => { r.vaults[1].path = join(r.vaults[0].path, 'missing'); },
    r => { r.vaults[0].id = 'INVALID'; }, r => { r.vaults[0].path = 'relative'; }, r => { r.vaults[0].extra = 1; },
  ];
  for (const change of cases) { const f = fixture(t); change(f.registry); f.save(); assert.throws(() => f.context(), e => e.exitCode === 2); }
  for (const content of ['bad', '---\nschema-version: 1\nvault-id: wrong\npurpose: Fine\nincludes: [x]\nexcludes: []\n---', '---\nschema-version: 1\nvault-id: general\npurpose: Fine\nincludes: []\nexcludes: []\n---']) {
    const f = fixture(t); writeFileSync(join(f.entries[0].path, 'VAULT.md'), content); assert.throws(() => f.context(), e => e.exitCode === 2);
  }
  const f = fixture(t); unlinkSync(join(f.entries[0].path, 'VAULT.md')); assert.throws(() => f.context(), /VAULT.md/);
});

test('project schema and explicit configuration defects never fall back', t => {
  for (const value of [{ version: 2 }, { version: 1, typo: true }, { version: 1, documentationVault: 'absent' }, { version: 1, researchVaults: [] }, { version: 1, researchVaults: ['docs', 'docs'] }, { version: 1, project: '../escape' }, { version: 1, project: 'one/two/three' }]) {
    const f = fixture(t); f.setProject(value); assert.throws(() => f.context(), e => e.exitCode === 2);
  }
  const f = fixture(t); writeFileSync(f.projectPath, '{'); assert.throws(() => f.context(), /JSON/i);
  unlinkSync(f.projectPath); writeFileSync(f.env.WIKI_MASTER_CONFIG, '{'); assert.throws(() => f.context(), /JSON/i);
  unlinkSync(f.env.WIKI_MASTER_CONFIG); assert.throws(() => f.context(), /registry|configuration/i);
  delete f.env.WIKI_MASTER_CONFIG; f.setProject({ version: 1, documentationVault: 'docs' }); assert.throws(() => f.context(), /registry/i);
});

test('descriptor parsing rejects malformed and nonstring values rather than silently coercing', t => {
  for (const includes of ['[42]', '[true]', '[[nested]]', '["unterminated]', '[good,,bad]', '[{name: bad}]']) {
    const f = fixture(t), descriptor = join(f.entries[0].path, 'VAULT.md');
    writeFileSync(descriptor, readFileSync(descriptor, 'utf8').replace('[Documentation, Research]', includes));
    assert.throws(() => f.context(), e => e.exitCode === 2, includes);
  }
});

test('offline roots report availability separately and do not block unrelated routes', t => {
  const f = fixture(t); f.registry.vaults[2].path = join(f.root, 'offline'); f.save();
  f.setProject({ version: 1, researchVaults: ['docs', 'research'] });
  assert.equal(requireSelectedTarget(f.context()).id, 'general');
  const c = f.context({ purpose: 'research', select: 'research' }); assert.equal(c.selected.available, false);
  assert.throws(() => requireSelectedTarget(c), e => e.exitCode === 1);
  assert.equal(c.research[0].available, true);
  f.setProject({ version: 1, documentationVault: 'research', researchVaults: ['docs'] });
  assert.equal(requireSelectedTarget(f.context({ purpose: 'research' })).id, 'docs');
});

test('aliases to identical roots and nested offline roots are rejected', t => {
  const f = fixture(t); const alias = join(f.root, 'alias'); symlinkSync(f.entries[0].path, alias, process.platform === 'win32' ? 'junction' : 'dir');
  f.registry.vaults[1].path = alias; f.save(); assert.throws(() => f.context(), /overlap|same|nested/i);
  f.registry.vaults[0].path = join(f.root, 'offline'); f.registry.vaults[1].path = join(f.root, 'offline', 'nested'); f.save();
  assert.throws(() => f.context(), /overlap|same|nested/i);
});

test('legacy mode retains strict and test guards and requires no descriptor', t => {
  const f = fixture(t); delete f.env.WIKI_MASTER_CONFIG;
  const c = f.context(); assert.equal(c.documentation.path, join(f.root, '.wiki-master-vault')); assert.ok(c.diagnostics.some(x => /describ/i.test(x)));
  assert.throws(() => resolveContext({ ...f.env, WIKI_MASTER_REQUIRE_VAULT: '1' }, { cwd: f.repo }), /REQUIRE_VAULT/);
  assert.equal(resolveVault({ ...f.env, WIKI_MASTER_REQUIRE_VAULT: '1', WIKI_MASTER_VAULT: f.entries[0].path }).path, f.entries[0].path);
  assert.throws(() => resolveContext({ ...f.env, WIKI_MASTER_VAULT: resolve(tmpdir(), '..', 'outside-test-vault') }, { cwd: f.repo }), /temporary or fixture/);
  f.env.WIKI_MASTER_CONFIG = join(f.root, 'vaults.json'); assert.equal(resolveContext({ ...f.env, WIKI_MASTER_REQUIRE_VAULT: '1' }, { cwd: f.repo }).selected.id, 'general');
});

test('explicit repo context, CLI status and no-repository fallback', t => {
  const f = fixture(t); f.setProject({ version: 1, documentationVault: 'docs' });
  assert.equal(resolveContext({ ...f.env, WIKI_MASTER_PROJECT_ROOT: f.repo }, { cwd: f.root }).documentation.id, 'docs');
  assert.throws(() => f.context({ repo: f.root }), /repository/i);
  assert.throws(() => f.context({ repo: join(f.root, 'missing') }), /repository|exist/i);
  assert.equal(resolveContext(f.env, { cwd: f.root }).documentation.id, 'general');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: f.root, env: { ...process.env, ...f.env }, encoding: 'utf8' });
  const ok = run('--repo', f.repo, '--json'); assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).documentation.id, 'docs');
  assert.equal(run('--unknown').status, 2); assert.equal(run('--purpose', 'invalid').status, 2); assert.equal(run('--help').status, 0);
});

test('project identity matches overviews and refuses explicit conflicts and ambiguous matches', t => {
  const f = fixture(t);
  const overview = project => { const path = join(f.entries[0].path, 'wiki', 'authored', project); mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'overview.md'), '---\nrepo: repository\n---\n'); };
  overview('known'); assert.equal(f.context().project, 'known');
  f.setProject({ version: 1, project: 'other' }); assert.throws(() => f.context(), /conflict/i);
  unlinkSync(f.projectPath); overview('second'); assert.throws(() => f.context(), /more than one|ambiguous/i);
});

test('worktrees inherit only verified ignored primary configuration and honor current files', t => {
  const f = fixture(t);
  writeFileSync(join(f.repo, '.gitignore'), '.wiki-master.json\n');
  git(f.repo, 'add', '.gitignore'); git(f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  const linked = join(f.root, 'linked'); git(f.repo, 'worktree', 'add', '-b', 'linked', linked);
  f.setProject({ version: 1, documentationVault: 'docs' });
  let c = f.context({ repo: linked }); assert.equal(c.documentation.id, 'docs'); assert.equal(c.projectConfigPath, f.projectPath); assert.equal(c.inheritedProjectConfig, true);
  json(join(linked, '.wiki-master.json'), { version: 1, documentationVault: 'research' });
  c = f.context({ repo: linked }); assert.equal(c.documentation.id, 'research'); assert.equal(c.inheritedProjectConfig, false);
  writeFileSync(join(linked, '.wiki-master.json'), '{'); assert.throws(() => f.context({ repo: linked }), /JSON/i);
  unlinkSync(join(linked, '.wiki-master.json')); git(f.repo, 'add', '-f', '.wiki-master.json');
  c = f.context({ repo: linked }); assert.equal(c.documentation.id, 'general'); assert.equal(c.projectConfigPath, null);
});

test('separate Git directory uses worktree metadata, and bare layouts use global with diagnostics', t => {
  const f = fixture(t), primary = join(f.root, 'separate'), metadata = join(f.root, 'git-metadata'); mkdirSync(primary);
  git(primary, 'init', '--separate-git-dir', metadata); writeFileSync(join(primary, '.gitignore'), '.wiki-master.json\n');
  git(primary, 'add', '.gitignore'); git(primary, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  const linked = join(f.root, 'separate-linked'); git(primary, 'worktree', 'add', '-b', 'linked', linked);
  json(join(primary, '.wiki-master.json'), { version: 1, documentationVault: 'docs' });
  const unsupported = f.context({ repo: linked }); assert.equal(unsupported.documentation.id, 'general'); assert.ok(unsupported.diagnostics.some(x => /unsupported/i.test(x)));
  git(primary, 'config', 'core.worktree', primary);
  const c = f.context({ repo: linked }); assert.equal(c.documentation.id, 'docs'); assert.equal(c.projectConfigPath, join(primary, '.wiki-master.json'));
  const bare = join(f.root, 'bare'); mkdirSync(bare); git(bare, 'init', '--bare');
  const b = f.context({ repo: bare }); assert.equal(b.documentation.id, 'general'); assert.ok(b.diagnostics.some(x => /bare|unsupported/i.test(x)));
});
