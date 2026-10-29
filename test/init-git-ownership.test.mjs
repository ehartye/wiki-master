import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
