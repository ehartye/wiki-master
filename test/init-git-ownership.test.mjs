import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SETTINGS } from '../scripts/lib/obsidian-git.mjs';

const initScript = fileURLToPath(new URL('../scripts/init.mjs', import.meta.url));

function runInit(vault, home) {
  return spawnSync(process.execPath, [initScript], {
    encoding: 'utf8',
    env: { ...process.env, WIKI_MASTER_VAULT: vault, HOME: home, USERPROFILE: home,
           WIKI_MASTER_BROWSER: '/no/such/browser' },
  });
}

test('a new vault gets a schema that says who owns Git', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  const schema = readFileSync(join(vault, 'vault-schema.md'), 'utf8');
  const section = schema.slice(schema.search(/^## Git ownership$/m));
  assert.match(section, /^## Git ownership\n\nObsidian Git handles all git operations\./);
  for (const [key, value] of Object.entries(REQUIRED_SETTINGS)) assert.ok(section.includes('`' + key + ': ' + value + '`'), key);
  assert.match(section, /write.*validate.*log.*refresh-index\.mjs/s);
  assert.match(section, /setup-obsidian-git\.mjs/);
  // The old passage called every other instruction stale, and init keeps an existing schema, so it outlived the policy.
  assert.doesNotMatch(section, /op-commit|wiki-sync|auto-commit|auto-push|commit on file change|stale/i);
});

test('a new vault gets .gitattributes with the union rules, and says what clears their duplicates', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created: \.gitattributes/);
  const text = readFileSync(join(vault, '.gitattributes'), 'utf8');
  const rules = text.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.split(/\s+/));
  assert.deepEqual(rules, [['index.md', 'merge=union'], ['log.md', 'merge=union'], ['moc/**', 'merge=union']]);
  const comment = text.split('\n').filter((line) => line.startsWith('#')).join('\n');
  assert.match(comment, /refresh-index\.mjs/);
  assert.match(comment, /duplicate/);
  assert.doesNotMatch(text, /index-gen|post-merge|\.githooks/);
  assert.equal(existsSync(join(vault, '.git')), false, 'init still creates no repository');
});

test('a vault that already has .gitattributes keeps it byte for byte', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const custom = '*.pdf binary\r\n# mine\r\n';
  writeFileSync(join(vault, '.gitattributes'), custom);
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /preserved: \.gitattributes/);
  assert.match(r.stdout, /differing: \.gitattributes/);
  assert.equal(readFileSync(join(vault, '.gitattributes'), 'utf8'), custom);
});

test('the one-time steps name the owner\'s repository, the plugin and the refresh, in order', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  const order = [/git repository and upstream/i, /Open folder as vault/, /setup-obsidian-git\.mjs/, /refresh-index\.mjs/].map((pattern) => r.stdout.search(pattern));
  assert.ok(order.every((at) => at >= 0), order.join());
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
});

test('a vault that already has a schema file keeps it unchanged', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  assert.equal(runInit(vault, home).status, 0);
  const custom = '# My own schema\n\nNothing about Git here.\n';
  writeFileSync(join(vault, 'vault-schema.md'), custom);
  assert.equal(runInit(vault, home).status, 0);
  assert.equal(readFileSync(join(vault, 'vault-schema.md'), 'utf8'), custom);
});

test('CLI reports preserved differing paths without exposing content and help agrees', t => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-init-cli-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  mkdirSync(join(vault, '_templates'));
  writeFileSync(join(vault, '_templates', 'authored-backlog-item.md'), 'PRIVATE TEMPLATE CONTENT');
  const result = runInit(vault, vault);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preserved: _templates\/authored-backlog-item\.md/);
  assert.match(result.stdout, /differing: _templates\/authored-backlog-item\.md/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE TEMPLATE CONTENT/);
  assert.equal(existsSync(join(vault, '.git')), false);
  const help = spawnSync(process.execPath, [initScript, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Existing files are kept/);
  assert.match(help.stdout, /partial creation/);
});

test('CLI returns nonzero for an obstruction and discloses retained creations', t => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-init-cli-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  mkdirSync(join(vault, 'index.md'));
  const result = runInit(vault, vault);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked: index\.md/);
  assert.match(result.stderr, /Created files remain/);
  assert.match(result.stdout, /created: log\.md/);
  assert.equal(existsSync(join(vault, '.git')), false);
});
