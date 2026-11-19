import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, unlinkSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { obsidian, verifyObsidianTarget } from '../scripts/lib/vault.mjs';
import { checkPrerequisites } from '../scripts/lib/prerequisites.mjs';
import { main as nativeMain } from '../scripts/obsidian.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'wm-write-routing-'));
  const repo = join(root, 'project'); mkdirSync(repo);
  execFileSync('git', ['init', repo], { stdio: 'ignore' });
  const entries = ['docs', 'research-one', 'research-two'].map(id => {
    const path = join(root, id); mkdirSync(join(path, 'raw', 'clippings'), { recursive: true });
    writeFileSync(join(path, 'VAULT.md'), `---\nschema-version: 1\nvault-id: ${id}\npurpose: Fixture\nincludes: [Fixture]\nexcludes: []\n---\n`);
    return { id, path, obsidian: `selector-${id}` };
  });
  const config = join(root, 'registry.json');
  writeFileSync(config, JSON.stringify({ version: 1, defaultVault: 'docs', vaults: entries }));
  writeFileSync(join(repo, '.wiki-master.json'), JSON.stringify({ version: 1, documentationVault: 'docs', researchVaults: ['research-one', 'research-two'] }));
  const env = { ...process.env, HOME: root, USERPROFILE: root, WIKI_MASTER_CONFIG: config, WIKI_MASTER_PROJECT_ROOT: repo };
  for (const key of ['WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_ID', 'WIKI_MASTER_VAULT_NAME']) delete env[key];
  return { root, repo, entries, env };
}
const snapshot = root => readdirSync(root, { recursive: true }).filter(p => !p.split(/[\\/]/).includes('.git')).map(p => {
  const path = join(root, p), stat = statSync(path);
  return [p, stat.mtimeMs, stat.isFile() ? readFileSync(path).toString('base64') : null];
});
const run = (f, name, args = [], extra = {}) => spawnSync(process.execPath, [resolve(`scripts/${name}.mjs`), ...args], { cwd: f.repo, env: { ...f.env, ...extra }, encoding: 'utf8', timeout: 15000, input: '' });

const roleHelpers = [
  ['clip-docx', ['missing.docx', '--decline=fixture']],
  ['session-brief', []],
  ['log-entry', ['--op', 'fixture', '--title', 'Fixture']],
];

test('descriptor aliases outside a registered root fail with configuration exit 2 in direct helpers', () => {
  const f = fixture(), descriptor = join(f.entries[1].path, 'VAULT.md');
  // Registry resolution canonicalizes the parent root, including Windows 8.3 names.
  const diagnosticPath = join(realpathSync.native(f.entries[1].path), 'VAULT.md');
  unlinkSync(descriptor);
  symlinkSync(f.entries[0].path, descriptor, process.platform === 'win32' ? 'junction' : 'dir');
  const before = snapshot(f.root);
  for (const [name, args] of [...roleHelpers, ['context', ['--json']]]) {
    const r = run(f, name, args, { WIKI_MASTER_VAULT_ID: name === 'clip-docx' ? 'research-one' : 'docs' });
    assert.equal(r.status, 2, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /outside the selected vault/i);
    assert.ok(r.stderr.includes(diagnosticPath), `${name} identifies the invalid descriptor: ${r.stderr}`);
    assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, `${name} reports a diagnostic without a stack`);
    assert.deepEqual(snapshot(f.root), before);
  }
});

for (const missing of [false, true]) {
  test(`direct role helpers reject an explicit ${missing ? 'missing' : 'nonrepository'} project root with exit 2`, () => {
    const f = fixture(), project = join(f.root, 'invalid-project');
    if (!missing) mkdirSync(project);
    const before = snapshot(f.root);
    for (const [name, args] of roleHelpers) {
      const r = run(f, name, args, { WIKI_MASTER_PROJECT_ROOT: project, WIKI_MASTER_VAULT_ID: name === 'clip-docx' ? 'research-one' : 'docs' });
      assert.equal(r.status, 2, `${name}: ${r.stderr}`);
      assert.match(r.stderr, missing ? /Repository directory does not exist or cannot be read/ : /Not a Git repository/);
      assert.ok(r.stderr.includes(project), `${name} identifies the invalid configured root`);
      assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, `${name} reports a diagnostic without a stack`);
      assert.deepEqual(snapshot(f.root), before);
    }
  });
}

test('direct mutating role helpers retain exit 1 for unavailable registered vault roots', () => {
  const f = fixture();
  for (const entry of f.entries) entry.path = join(f.root, `offline-${entry.id}`);
  writeFileSync(f.env.WIKI_MASTER_CONFIG, JSON.stringify({ version: 1, defaultVault: 'docs', vaults: f.entries }));
  const before = snapshot(f.root);
  for (const [name, args] of roleHelpers.filter(([name]) => name !== 'session-brief')) {
    const r = run(f, name, args, { WIKI_MASTER_VAULT_ID: name === 'clip-docx' ? 'research-one' : 'docs' });
    assert.equal(r.status, 1, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /Selected vault .* is unavailable/);
    assert.equal(r.stderr.trim().split(/\r?\n/).length, 1);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('every capture refuses absent and forbidden research selection before side effects', () => {
  const f = fixture();
  const cases = [
    ['clip', ['https://example.com/article', '--decline=fixture']],
    ['clip-pdf', ['missing.pdf', '--source=https://example.com/article', '--decline=fixture']],
    ['clip-docx', ['missing.docx', '--decline=fixture']],
    ['clip-pptx', ['missing.pptx', '--decline=fixture']],
    ['clip-xlsx', ['missing.xlsx', '--decline=fixture']],
    ['clip-gh', ['https://github.com/example/sample', '--decline=fixture']],
    ['clip-confluence', ['https://example.atlassian.net/wiki/spaces/EX/pages/123/Example', '--decline=fixture']],
  ];
  const before = snapshot(f.root);
  for (const [name, args] of cases) for (const extra of [{}, { WIKI_MASTER_VAULT_ID: 'docs' }, { WIKI_MASTER_VAULT_ID: 'research-one', WIKI_MASTER_VAULT: f.entries[0].path }]) {
    const r = run(f, name, args, extra);
    assert.equal(r.status, 2, `${name}: ${r.stderr}`);
    assert.match(r.stderr, /research|conflict/i, `${name} must refuse routing, not a later converter error`);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('PDF capture resolves research routing before probing a missing toolchain', () => {
  const f = fixture(), before = snapshot(f.root);
  const code = `import { main } from ${JSON.stringify(new URL('../scripts/clip-pdf.mjs', import.meta.url).href)};
    main(['missing.pdf'], {toolchain: () => {console.error('TOOLCHAIN_PROBED'); return {ok:false,fatal:true,lines:['fixture converter missing']};}});`;
  const invoke = extra => spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: f.repo, env: { ...f.env, ...extra }, encoding: 'utf8' });
  for (const extra of [{}, { WIKI_MASTER_VAULT_ID: 'docs' }]) {
    const r = invoke(extra);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /research/i);
    assert.doesNotMatch(r.stderr, /TOOLCHAIN_PROBED/);
    assert.deepEqual(snapshot(f.root), before);
  }
  const selected = invoke({ WIKI_MASTER_VAULT_ID: 'research-one' });
  assert.equal(selected.status, 1, selected.stderr);
  assert.match(selected.stderr, /TOOLCHAIN_PROBED/);
  assert.deepEqual(snapshot(f.root), before);
});

test('PDF input errors and doctor retain precedence over research selection', () => {
  const f = fixture(), before = snapshot(f.root);
  for (const [args, message] of [
    [['ftp://example.com/source.pdf'], /only http and https/],
    [['missing.pdf', '--mode=layout'], /unknown reading mode/],
    [['https://example.com/source.pdf', '--figures-only'], /figures-only needs/],
  ]) {
    const code = `import { main } from ${JSON.stringify(new URL('../scripts/clip-pdf.mjs', import.meta.url).href)};
      main(${JSON.stringify(args)}, {toolchain: () => {throw new Error('TOOLCHAIN_PROBED');}});`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: f.repo, env: f.env, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, /TOOLCHAIN_PROBED|Select a research vault/);
  }
  const doctor = run(f, 'clip-pdf', ['--doctor'], { PATH: '', Path: '', LOCALAPPDATA: '' });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /ocrRaster: missing/);
  assert.doesNotMatch(doctor.stderr, /Select a research vault/);
  assert.deepEqual(snapshot(f.root), before);
});

test('selected research captures and completion stay in that vault', () => {
  const f = fixture(), [docs, research, other] = f.entries;
  const before = [snapshot(docs.path), snapshot(other.path)];
  const source = join(f.root, 'sample.docx'); writeFileSync(source, 'fixture');
  const code = `import { main } from ${JSON.stringify(new URL('../scripts/clip-docx.mjs', import.meta.url).href)}; main([${JSON.stringify(source)}, '--allow-short'], {toText: () => 'An original source fixture.'});`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: f.repo, env: { ...f.env, WIKI_MASTER_VAULT_ID: research.id }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readdirSync(join(research.path, 'raw', 'clippings')).length, 1);
  const log = run(f, 'log-entry', ['--op', 'clip', '--title', 'Fixture capture'], { WIKI_MASTER_VAULT_ID: research.id });
  assert.equal(log.status, 0, log.stderr);
  assert.equal(readdirSync(join(research.path, 'log')).length, 1);
  assert.deepEqual([snapshot(docs.path), snapshot(other.path)], before);
});

test('both prerequisite probes explicitly target the selected selector and reject wrong roots', async () => {
  const f = fixture(), target = f.entries[1], calls = [];
  const probes = { ollamaUp: async () => true, modelPulled: async () => true, session: () => 'this-session', git: () => ({ repo: true, upstream: true }),
    execFileSyncImpl: (command, args) => { calls.push(args); return args[1] === 'vault' ? target.path : 'on'; } };
  const result = await checkPrerequisites({ vault: { path: target.path, name: target.obsidian }, probes });
  assert.deepEqual(calls, [[`vault=${target.obsidian}`, 'vault', 'info=path'], [`vault=${target.obsidian}`, 'plugins:restrict']]);
  assert.ok(result.failures.some(f => f.id === 'obsidian-restricted'));
  calls.length = 0;
  probes.execFileSyncImpl = (command, args) => { calls.push(args); return f.entries[0].path; };
  const wrong = await checkPrerequisites({ vault: { path: target.path, name: target.obsidian }, probes });
  assert.ok(wrong.failures.some(f => f.id === 'obsidian-vault'));
  assert.equal(calls.length, 1);
});

test('raw conflicting selectors are rejected before transport', () => {
  let called = false;
  assert.throws(() => obsidian(['vault', 'vault=other'], { name: 'chosen', execFileSyncImpl: () => { called = true; return ''; } }), /conflict/i);
  assert.equal(called, false);
});

test('a native wrapper verifies the selected root before sending the requested action', () => {
  const f = fixture(), target = f.entries[1], calls = [];
  assert.throws(() => verifyObsidianTarget({ path: target.path, name: target.obsidian }, { execFileSyncImpl: (command, args) => {
    calls.push(args); return f.entries[0].path;
  } }), /selected.*vault|resolved|root/i);
  assert.deepEqual(calls, [[`vault=${target.obsidian}`, 'vault', 'info=path']]);
  calls.length = 0;
  assert.throws(() => nativeMain(['create', 'path=note.md'], { vault: { path: target.path, name: target.obsidian }, execFileSyncImpl: (command, args) => {
    calls.push(args); return f.entries[0].path;
  } }), /selected.*vault|resolved|root/i);
  assert.deepEqual(calls, [[`vault=${target.obsidian}`, 'vault', 'info=path']]);
});

test('a triage child rejects a root conflicting with its request binding before session writes', () => {
  const f = fixture(), before = snapshot(f.root);
  const r = spawnSync(process.execPath, [resolve('scripts/triage-ui/server.cjs')], { cwd: f.repo, encoding: 'utf8', timeout: 2000,
    env: { ...f.env, WIKI_MASTER_VAULT_ID: 'research-one', WM_TRIAGE_VAULT: f.entries[0].path, WM_TRIAGE_DIR: join(f.root, 'session') } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /conflict/i);
  assert.deepEqual(snapshot(f.root), before);
});

test('configured completion binds refresh, catalogs and index to the selected research vault', () => {
  const f = fixture(), [docs, research, other] = f.entries;
  const before = [snapshot(docs.path), snapshot(other.path)];
  const files = {
    'wiki/concepts/Local.md': '---\ntype: concept\nsources: []\n---\n# Local\n\nLocal fixture knowledge.',
    '.obsidian/community-plugins.json': '["obsidian-git"]',
    '.obsidian/plugins/obsidian-git/manifest.json': '{"id":"obsidian-git"}',
    '.obsidian/plugins/obsidian-git/data.json': '{"autoSaveInterval":10}',
  };
  for (const [path, content] of Object.entries(files)) { const full = join(research.path, path); mkdirSync(join(full, '..'), { recursive: true }); writeFileSync(full, content); }
  const code = `import { main } from ${JSON.stringify(new URL('../scripts/refresh-index.mjs', import.meta.url).href)};
    const root=${JSON.stringify(research.path)};
    process.exitCode=await main([], {embedFn:async()=>[1,2,3,4], probes:{model:'fixture',ollamaUp:async()=>true,modelPulled:async()=>true,session:()=> 'this-session',cli:args=>args[0]==='vault'?root:'off',git:()=>({repo:true,upstream:true})}});`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: f.repo, env: { ...f.env, WIKI_MASTER_VAULT_ID: research.id }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(research.path, 'index.md')));
  assert.ok(readdirSync(join(research.path, '.wiki-master')).length > 0);
  assert.deepEqual([snapshot(docs.path), snapshot(other.path)], before);
});

test('setup bootstrap is explicit and ordinary captures cannot use it', () => {
  const f = fixture(), root = join(f.root, 'new-vault');
  const r = run(f, 'init', ['--bootstrap', root]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(root, 'vault-schema.md')));
  const before = snapshot(f.root);
  const capture = run(f, 'clip-docx', ['missing.docx', '--bootstrap', root]);
  assert.equal(capture.status, 2);
  assert.deepEqual(snapshot(f.root), before);
});

test('an unavailable registered setup target requires explicit bootstrap', () => {
  const f = fixture(), offline = join(f.root, 'offline');
  f.entries[1].path = offline;
  writeFileSync(f.env.WIKI_MASTER_CONFIG, JSON.stringify({ version: 1, defaultVault: 'docs', vaults: f.entries }));
  const before = snapshot(f.root);
  const r = run(f, 'init', [], { WIKI_MASTER_VAULT_ID: 'research-one' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /unavailable/i);
  assert.deepEqual(snapshot(f.root), before);
});

test('refresh recovery commands retain registry, repository and selected vault', () => {
  const f = fixture();
  const code = `import { main } from ${JSON.stringify(new URL('../scripts/refresh-index.mjs', import.meta.url).href)};
    process.exitCode=await main([], { probes:{ollamaUp:async()=>false,session:()=> 'none',git:()=>({repo:false})}});`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: f.repo, env: { ...f.env, WIKI_MASTER_VAULT_ID: 'research-one' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  for (const key of ['WIKI_MASTER_CONFIG', 'WIKI_MASTER_PROJECT_ROOT', 'WIKI_MASTER_VAULT_ID']) assert.ok(r.stderr.includes(key), key);
  assert.ok(r.stderr.includes('research-one'));
});
