import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { resolveVault, buildArgs } from '../scripts/lib/vault.mjs';

// These pass an environment object: under node --test the process environment may only name a temporary vault.
test('resolveVault defaults to ~/.wiki-master-vault', () => {
  const v = resolveVault({});
  assert.equal(v.path, join(homedir(), '.wiki-master-vault'));
  assert.equal(v.name, '.wiki-master-vault');
});

test('resolveVault honors WIKI_MASTER_VAULT override', () => {
  const v = resolveVault({ WIKI_MASTER_VAULT: '/tmp/my vault' });
  assert.equal(v.path, '/tmp/my vault');
  assert.equal(v.name, basename('/tmp/my vault'));
});

test('resolveVault honors WIKI_MASTER_VAULT_NAME override', () => {
  const v = resolveVault({ WIKI_MASTER_VAULT: '/tmp/whatever', WIKI_MASTER_VAULT_NAME: 'MyWiki' });
  assert.equal(v.name, 'MyWiki');
});

test('buildArgs prepends vault= and passes through args', () => {
  const args = buildArgs('MyWiki', ['orphans', 'format=json']);
  assert.deepEqual(args, ['vault=MyWiki', 'orphans', 'format=json']);
});

import { obsidian, obsidianJson } from '../scripts/lib/vault.mjs';

test('shared wrapper rejects unsafe note payloads before invoking its executor', () => {
  for (const content of ['private'.repeat(500), 'first\nsecond']) {
    assert.throws(() => obsidian(['create', 'path=wiki/architecture.md', `content=${content}`, 'overwrite'], {
      name: 'MyWiki', execFileSyncImpl() { assert.fail('unsafe request must never launch'); },
    }), /not sent/i);
  }
});

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
    name: 'MyWiki', timeout: 25_000, execFileSyncImpl(command, args, options) {
      calls++;
      assert.equal(options.timeout, 25_000);
      throw Object.assign(new Error('spawnSync obsidian ETIMEDOUT'), { code: 'ETIMEDOUT' });
    },
  }), /timed out after 25000ms/);
  assert.equal(calls, 1);
});

test('invalid timeout overrides cannot disable the bound', () => {
  for (const timeout of [0, -1, Infinity, NaN]) {
    assert.throws(() => obsidian(['read'], { name: 'MyWiki', timeout, execFileSyncImpl() { assert.fail('must not run'); } }), /positive finite/);
  }
});

test('invalid CLI JSON identifies the command without swallowing the failure', () => {
  assert.throws(() => obsidianJson(['base:query', 'file=stale.base'], {
    name: 'MyWiki', execFileSyncImpl: () => 'Error: view unavailable',
  }), /base:query.*invalid JSON/);
});

test('assertRunning preserves the timeout reason for app-only operations', async () => {
  const { assertRunning } = await import('../scripts/lib/vault.mjs');
  assert.throws(() => assertRunning({ name: 'MyWiki', execFileSyncImpl() {
    throw Object.assign(new Error('hung'), { code: 'ETIMEDOUT' });
  } }), /Obsidian CLI unavailable.*timed out after 10000ms/);
});
