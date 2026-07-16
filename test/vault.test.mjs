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
