import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeLogEntry } from '../scripts/log-entry.mjs';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const now = new Date(2026, 0, 2, 3, 4, 5);
const logName = '2026-01-02-030405-test-boundary.md';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-write-boundaries-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const research = join(root, 'research'), docs = join(root, 'docs');
  for (const [id, path] of [['research', research], ['docs', docs]]) {
    mkdirSync(path);
    writeFileSync(join(path, 'VAULT.md'), `---\nschema-version: 1\nvault-id: ${id}\npurpose: Fixture\nincludes: [Fixture]\nexcludes: []\n---\n`);
  }
  const config = join(root, 'registry.json');
  writeFileSync(config, JSON.stringify({ version: 1, defaultVault: 'research', vaults: [{ id: 'research', path: research, obsidian: 'research' }, { id: 'docs', path: docs, obsidian: 'docs' }] }));
  const env = { ...process.env, HOME: root, USERPROFILE: root, WIKI_MASTER_CONFIG: config };
  for (const key of ['WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_ID', 'WIKI_MASTER_VAULT_NAME', 'WIKI_MASTER_PROJECT_ROOT']) delete env[key];
  const run = (script, args) => spawnSync(process.execPath, [join(scripts, script), ...args], { cwd: root, env, encoding: 'utf8', input: 'Fixture body' });
  return { root, research, docs, run, env };
}
function fileLink(t, target, link) {
  try { symlinkSync(target, link, 'file'); return true; }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip(`file symlinks unavailable: ${error.code}`); return false; } throw error; }
}

test('capture refuses a foreign registered vault ledger before creating a ledger or capture state', t => {
  const f = fixture(t);
  const ledger = join(f.docs, 'capture.jsonl');
  const result = f.run('clip.mjs', ['https://example.invalid/fixture', '--decline=fixture', '--ledger', ledger]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /outside the selected vault/);
  assert.deepEqual(readdirSync(f.docs), ['VAULT.md']);
  assert.deepEqual(readdirSync(f.research), ['VAULT.md']);
});

test('capture refuses a ledger through an escaping directory alias and accepts a local noncontent ledger', t => {
  const f = fixture(t);
  symlinkSync(f.docs, join(f.research, 'foreign'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = f.run('clip.mjs', ['https://example.invalid/fixture', '--decline=fixture', '--ledger', join(f.research, 'foreign', 'capture.jsonl')]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /outside the selected vault/);
  assert.deepEqual(readdirSync(f.docs), ['VAULT.md']);
  assert.equal(existsSync(join(f.research, '.wiki-master')), false);
  const local = join(f.research, 'capture.jsonl');
  const good = f.run('clip.mjs', ['https://example.invalid/fixture', '--decline=fixture', '--ledger', local]);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(readFileSync(local, 'utf8')).status, 'declined');
});

test('capture refuses a dangling ledger file alias to a foreign vault', t => {
  const f = fixture(t), target = join(f.docs, 'later.jsonl'), link = join(f.research, 'ledger.jsonl');
  if (!fileLink(t, target, link)) return;
  const result = f.run('clip.mjs', ['https://example.invalid/fixture', '--decline=fixture', '--ledger', link]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /outside the selected vault/);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(join(f.research, '.wiki-master')), false);
});

test('log operation traversal is an input refusal before any directory or file is created', t => {
  const f = fixture(t);
  for (const op of ['x/../../../docs/escaped', 'x\\..\\..\\..\\docs\\escaped', '..', 'test\nother: value']) {
    const result = f.run('log-entry.mjs', ['--op', op, '--title', 'Boundary']);
    assert.equal(result.status, 2, `${op}: ${result.stderr}`);
    assert.match(result.stderr, /--op/);
    assert.equal(result.stdout, '');
    assert.deepEqual(readdirSync(f.research), ['VAULT.md']);
    assert.deepEqual(readdirSync(f.docs), ['VAULT.md']);
  }
});

test('log refuses a dangling foreign filename alias before writing any entry', t => {
  const f = fixture(t), target = join(f.docs, 'later.md');
  mkdirSync(join(f.research, 'log'));
  if (!fileLink(t, target, join(f.research, 'log', logName))) return;
  assert.throws(() => writeLogEntry({ vaultPath: f.research, op: 'test', title: 'Boundary', now }), /outside the selected vault/);
  assert.equal(existsSync(target), false);
  assert.deepEqual(readdirSync(join(f.research, 'log')), [logName]);
});

test('log preserves a dangling internal file alias and uses an exclusive collision suffix', t => {
  const f = fixture(t), target = join(f.research, 'later.md');
  mkdirSync(join(f.research, 'log'));
  if (!fileLink(t, target, join(f.research, 'log', logName))) return;
  const options = { vaultPath: f.research, op: 'test', title: 'Boundary', now };
  const first = writeLogEntry({ ...options, body: 'First' });
  const second = writeLogEntry({ ...options, body: 'Second' });
  assert.equal(first, `log/${logName.replace('.md', '-2.md')}`);
  assert.equal(second, `log/${logName.replace('.md', '-3.md')}`);
  assert.match(readFileSync(join(f.research, first), 'utf8'), /First/);
  assert.match(readFileSync(join(f.research, second), 'utf8'), /Second/);
  assert.equal(existsSync(target), false);
});

const directoryAlias = (target, link) => symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
function triageInvocation(f, server = false, session = join(f.research, '.wiki-master', 'triage-ui')) {
  const moduleUrl = pathToFileURL(join(scripts, server ? 'triage-ui/server.cjs' : 'triage.mjs')).href;
  const code = server ? `await import(${JSON.stringify(moduleUrl)});` : `
    const { main } = await import(${JSON.stringify(moduleUrl)});
    Date.now = () => 123;
    globalThis.fetch = async () => ({ ok: true });
    try { await main(); } catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1; }`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: f.root, env: { ...f.env, WM_TRIAGE_DIR: session, WM_TRIAGE_VAULT: f.research }, encoding: 'utf8',
  });
}

for (const server of [false, true]) for (const zone of ['content', 'state']) {
  test(`triage ${server ? 'child' : 'CLI'} refuses an escaping ${zone} descendant before session writes`, t => {
    const f = fixture(t), session = join(f.research, '.wiki-master', 'triage-ui');
    mkdirSync(session, { recursive: true });
    directoryAlias(f.docs, join(session, zone));
    const state = zone === 'state' ? f.docs : join(session, 'state');
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, 'server-info'), JSON.stringify({ url: 'http://fixture.invalid', link: 'fixture' }));
    const before = readdirSync(f.docs);
    const result = triageInvocation(f, server);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /outside the selected vault/);
    assert.deepEqual(readdirSync(f.docs), before);
    assert.equal(existsSync(join(session, 'state', 'token')), false);
    assert.equal(existsSync(join(session, 'content', 'triage-123.html')), false);
  });
}

test('triage child rejects an external session directory before token creation', t => {
  const f = fixture(t);
  const result = triageInvocation(f, true, f.docs);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /outside the selected vault/);
  assert.deepEqual(readdirSync(f.docs), ['VAULT.md']);
});

test('triage CLI refuses dangling output and server-info leaves outside the vault', t => {
  for (const leaf of ['content/triage-123.html', 'state/server-info']) {
    const f = fixture(t), session = join(f.research, '.wiki-master', 'triage-ui');
    mkdirSync(join(session, 'content'), { recursive: true });
    mkdirSync(join(session, 'state'));
    if (!fileLink(t, join(f.docs, 'later'), join(session, leaf))) return;
    if (leaf.startsWith('content')) writeFileSync(join(session, 'state', 'server-info'), JSON.stringify({ url: 'http://fixture.invalid' }));
    const result = triageInvocation(f);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /outside the selected vault/);
    assert.equal(existsSync(join(f.docs, 'later')), false);
    assert.equal(existsSync(join(session, 'content', 'triage-123.html')), false);
  }
});

test('triage child preflights each state leaf and triage ledger before writing a token', t => {
  for (const leaf of ['token', 'port', 'server-info', 'server-stopped', 'ledger']) {
    const f = fixture(t), session = join(f.research, '.wiki-master', 'triage-ui');
    mkdirSync(join(session, 'state'), { recursive: true });
    const destination = leaf === 'ledger' ? join(f.research, '.wiki-master', 'triage.jsonl') : join(session, 'state', leaf);
    if (!fileLink(t, join(f.docs, 'later'), destination)) return;
    const result = triageInvocation(f, true);
    assert.equal(result.status, 2, `${leaf}: ${result.stderr}`);
    assert.match(result.stderr, /outside the selected vault/);
    assert.deepEqual(readdirSync(f.docs), ['VAULT.md']);
    if (leaf !== 'token') assert.equal(existsSync(join(session, 'state', 'token')), false);
  }
});

test('triage server supports internal session aliases and rechecks the ledger after startup', async t => {
  const f = fixture(t), session = join(f.research, 'session');
  const temp = f.root;
  mkdirSync(session);
  for (const zone of ['content', 'state']) {
    const target = join(f.research, `${zone}-target`);
    mkdirSync(target);
    directoryAlias(target, join(session, zone));
  }
  writeFileSync(join(session, 'content', 'local.html'), '<p>Local screen</p>');
  const child = spawn(process.execPath, [join(scripts, 'triage-ui', 'server.cjs')], {
    cwd: f.root, env: { ...f.env, TMPDIR: temp, TMP: temp, TEMP: temp, WM_TRIAGE_DIR: session, WM_TRIAGE_VAULT: f.research, WM_TRIAGE_HOST: '127.0.0.1', WM_TRIAGE_PORT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.on('exit', resolve));
  try {
    const until = Date.now() + 5000;
    let info;
    while (!info && child.exitCode === null && Date.now() < until) {
      info = stdout.split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line)).find(row => row.type === 'server-started');
      if (!info) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(info, stderr || stdout);
    const base = `http://127.0.0.1:${info.port}`;
    const cookie = `wm_triage=${readFileSync(join(session, 'state', 'token'), 'utf8').trim()}`;
    const page = await fetch(base, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Local screen/);
    const post = () => fetch(`${base}/disposition`, { method: 'POST', headers: { cookie }, body: JSON.stringify({ url: 'https://example.invalid/fixture', kind: 'failed', disposition: 'skip' }) });
    const first = await post();
    assert.equal(first.status, 200);
    await first.text();
    assert.equal(JSON.parse(readFileSync(join(f.research, '.wiki-master', 'triage.jsonl'), 'utf8')).t, 'disposition');
    renameSync(join(f.research, '.wiki-master'), join(f.research, 'old-state'));
    directoryAlias(f.docs, join(f.research, '.wiki-master'));
    const refused = await post();
    assert.equal(refused.status, 500);
    assert.match(await refused.text(), /outside the selected vault/);
    assert.deepEqual(readdirSync(f.docs), ['VAULT.md']);
    const upload = await fetch(`${base}/upload`, { method: 'POST', headers: { cookie, 'x-wm-url': 'https://example.invalid/fixture', 'x-wm-kind': 'failed', 'x-wm-filename': 'fixture.txt' }, body: 'Owned test bytes' });
    assert.equal(upload.status, 500);
    assert.match(await upload.text(), /outside the selected vault/);
    assert.equal(existsSync(join(temp, 'wiki-master-uploads')), false, 'refuse before staging bytes for an escaped ledger');
    writeFileSync(join(f.docs, 'foreign.html'), 'Foreign screen');
    renameSync(join(session, 'content'), join(session, 'old-content'));
    directoryAlias(f.docs, join(session, 'content'));
    const escapedPage = await fetch(base, { headers: { cookie } });
    assert.equal(escapedPage.status, 500);
    const error = await escapedPage.text();
    assert.match(error, /outside the selected vault/);
    assert.doesNotMatch(error, /Foreign screen/);
  } finally { child.kill(); await closed; }
});
