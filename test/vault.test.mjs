import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { resolveVault, buildArgs } from '../scripts/lib/vault.mjs';

test('resolveVault defaults to ~/.wiki-master-vault', () => {
  const prev = process.env.WIKI_MASTER_VAULT;
  const prevName = process.env.WIKI_MASTER_VAULT_NAME;
  delete process.env.WIKI_MASTER_VAULT;
  delete process.env.WIKI_MASTER_VAULT_NAME;
  const v = resolveVault();
  assert.equal(v.path, join(homedir(), '.wiki-master-vault'));
  assert.equal(v.name, '.wiki-master-vault');
  if (prev !== undefined) process.env.WIKI_MASTER_VAULT = prev;
  if (prevName !== undefined) process.env.WIKI_MASTER_VAULT_NAME = prevName;
});

test('resolveVault honors WIKI_MASTER_VAULT override', () => {
  process.env.WIKI_MASTER_VAULT = '/tmp/my vault';
  delete process.env.WIKI_MASTER_VAULT_NAME;
  const v = resolveVault();
  assert.equal(v.path, '/tmp/my vault');
  assert.equal(v.name, basename('/tmp/my vault'));
  delete process.env.WIKI_MASTER_VAULT;
});

test('resolveVault honors WIKI_MASTER_VAULT_NAME override', () => {
  process.env.WIKI_MASTER_VAULT = '/tmp/whatever';
  process.env.WIKI_MASTER_VAULT_NAME = 'MyWiki';
  const v = resolveVault();
  assert.equal(v.name, 'MyWiki');
  delete process.env.WIKI_MASTER_VAULT;
  delete process.env.WIKI_MASTER_VAULT_NAME;
});

test('buildArgs prepends vault= and passes through args', () => {
  const args = buildArgs('MyWiki', ['orphans', 'format=json']);
  assert.deepEqual(args, ['vault=MyWiki', 'orphans', 'format=json']);
});

import { obsidian, obsidianJson } from '../scripts/lib/vault.mjs';

test('Obsidian calls are bounded, hidden and retain argument boundaries', () => {
  let calls = 0;
  assert.equal(obsidian(['read', 'path=wiki/a b.md'], {
    name: 'My Wiki', execFileSyncImpl(command, args, options) {
      calls++;
      assert.equal(command, 'obsidian');
      assert.deepEqual(args, ['vault=My Wiki', 'read', 'path=wiki/a b.md']);
      assert.equal(options.timeout, 10_000);
      assert.equal(options.windowsHide, true);
      return '  contents\n';
    },
  }), 'contents');
  assert.equal(calls, 1);
});

test('timeout errors name the bound and never retry uncertain mutations', () => {
  let calls = 0;
  assert.throws(() => obsidian(['append', 'path=wiki/a.md', 'content=one'], {
    timeout: 25_000, execFileSyncImpl(command, args, options) {
      calls++;
      assert.equal(options.timeout, 25_000);
      throw Object.assign(new Error('spawnSync obsidian ETIMEDOUT'), { code: 'ETIMEDOUT' });
    },
  }), /timed out after 25000ms/);
  assert.equal(calls, 1);
});

test('invalid timeout overrides cannot disable the bound', () => {
  for (const timeout of [0, -1, Infinity, NaN]) {
    assert.throws(() => obsidian(['read'], { timeout, execFileSyncImpl() { assert.fail('must not run'); } }), /positive finite/);
  }
});

test('invalid CLI JSON identifies the command without swallowing the failure', () => {
  assert.throws(() => obsidianJson(['base:query', 'file=stale.base'], {
    execFileSyncImpl: () => 'Error: view unavailable',
  }), /base:query.*invalid JSON/);
});

test('assertRunning preserves the timeout reason for app-only operations', async () => {
  const { assertRunning } = await import('../scripts/lib/vault.mjs');
  assert.throws(() => assertRunning({ name: 'MyWiki', execFileSyncImpl() {
    throw Object.assign(new Error('hung'), { code: 'ETIMEDOUT' });
  } }), /Obsidian CLI unavailable.*timed out after 10000ms/);
});
