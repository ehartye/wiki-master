import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
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

import { obsidian, obsidianActive, obsidianJson } from '../scripts/lib/vault.mjs';

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
    name: 'MyWiki', execFileSyncImpl: () => 'not json at all',
  }), /base:query.*invalid JSON/);
});

// The CLI exits 0 when it refuses, so the helper reads the text it printed.
const answering = (text) => ({ name: 'MyWiki', execFileSyncImpl: () => text });
const refused = (command, words) => (error) => error.code === 'OBSIDIAN_CLI_ERROR' && error.message === `obsidian ${command} failed: ${words}`;

test('a refusal the CLI prints with exit 0 throws OBSIDIAN_CLI_ERROR carrying the words the CLI printed', () => {
  assert.throws(() => obsidian(['vault', 'info=path'], answering('Vault not found.\n')), refused('vault', 'Vault not found.'));
  assert.throws(() => obsidian(['plugin:reload', 'id=x'], answering('Error: Failed to reload: x')), refused('plugin:reload', 'Error: Failed to reload: x'));
  const gate = 'Command line interface is not enabled. Turn it on in Settings.\nSee the docs.';
  assert.throws(() => obsidian(['vaults'], answering(gate)), refused('vaults', gate));
  assert.throws(() => obsidianActive(['vault', 'info=path'], answering('Vault not found.')), refused('vault', 'Vault not found.'));
});

test('output that merely mentions those words still succeeds', () => {
  for (const text of ['Notes: Vault not found. is printed when\nthe name is wrong', 'The vault was not found earlier', 'Command line interface is not enabled by default',
    'Error handling\nretries and backoff', `Error ${'x'.repeat(300)}`, 'Vault not found. Try again', '']) {
    assert.equal(obsidian(['search', 'query=x'], answering(text)), text.trim(), text.slice(0, 30));
  }
});

test('the read command returns a note, even one that starts with Error', () => {
  assert.equal(obsidian(['read', 'path=a.md'], answering('Error: a note about errors')), 'Error: a note about errors');
  assert.equal(obsidian(['read', 'path=a.md'], answering('# Notes\nVault not found.')), '# Notes\nVault not found.');
});

test('obsidianJson reports the real cause of a refusal, not invalid JSON', () => {
  assert.throws(() => obsidianJson(['base:query', 'file=stale.base'], answering('Vault not found.')), (error) => {
    assert.equal(error.code, 'OBSIDIAN_CLI_ERROR');
    assert.match(error.message, /base:query failed: Vault not found\./);
    assert.doesNotMatch(error.message, /invalid JSON/);
    return true;
  });
  assert.deepEqual(obsidianJson(['base:query', 'file=stale.base'], answering('[{"path":"a.md"}]')), [{ path: 'a.md' }]);
});

test('assertRunning reports a refused CLI as unavailable', async () => {
  const { assertRunning } = await import('../scripts/lib/vault.mjs');
  assert.throws(() => assertRunning({ name: 'MyWiki', ...answering('Command line interface is not enabled.') }), /Obsidian CLI unavailable.*not enabled/);
});

test('assertRunning preserves the timeout reason for app-only operations', async () => {
  const { assertRunning } = await import('../scripts/lib/vault.mjs');
  assert.throws(() => assertRunning({ name: 'MyWiki', execFileSyncImpl() {
    throw Object.assign(new Error('hung'), { code: 'ETIMEDOUT' });
  } }), /Obsidian CLI unavailable.*timed out after 10000ms/);
});

test('obsidianActive names no vault, runs from the temp folder, and keeps a failure\'s code', () => {
  const calls = [];
  const execFileSyncImpl = (command, argv, options) => { calls.push({ command, argv, cwd: options.cwd }); return ' C:\some\vault \n'; };
  assert.equal(obsidianActive(['vault', 'info=path'], { name: 'ignored', execFileSyncImpl }), 'C:\some\vault');
  assert.deepEqual(calls, [{ command: 'obsidian', argv: ['vault', 'info=path'], cwd: tmpdir() }]);
  for (const code of ['CLI_BUSY', 'CLI_LOCK']) {
    assert.throws(() => obsidianActive(['vault', 'info=path'], { execFileSyncImpl() { throw Object.assign(new Error('gate'), { code }); } }), (error) => error.code === code);
  }
});

test('obsidian still names the vault, and passes no working directory, when asked the ordinary way', () => {
  const calls = [];
  obsidian(['vault', 'info=path'], { name: 'MyWiki', execFileSyncImpl: (command, argv, options) => { calls.push({ argv, hasCwd: 'cwd' in options }); return ''; } });
  assert.deepEqual(calls, [{ argv: ['vault=MyWiki', 'vault', 'info=path'], hasCwd: false }]);
});
