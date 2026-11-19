import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  return { root, research, docs, run };
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
