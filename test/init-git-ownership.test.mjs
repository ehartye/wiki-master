import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  assert.match(schema, /^## Git ownership$/m);
  assert.match(schema, /op-commit/);
  assert.match(schema, /wiki-sync\.mjs/);
  assert.match(schema, /Obsidian Git/);
  assert.match(schema, /auto-commit/i);
  assert.match(schema, /commit on file change/i);
  assert.match(schema, /auto-push/i);
  assert.match(schema, /stale/i);
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
