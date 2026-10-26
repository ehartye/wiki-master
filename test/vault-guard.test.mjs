import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, parse } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../scripts/lib/vault.mjs';
import { tempVault, isUnderTemp } from './helpers/temp-vault.mjs';

// The default vault is the real one. Two guards keep a script or a test from reaching it by accident:
//  - WIKI_MASTER_REQUIRE_VAULT=1: with WIKI_MASTER_VAULT unset a script stops (exit 2, one line) before it
//    reads or writes anything;
//  - under `node --test` (NODE_TEST_CONTEXT is set, and a child process inherits it) the vault must be
//    under the temp directory, so a test that forgets to set one fails instead of writing to the real vault.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL = join(homedir(), '.wiki-master-vault');

test('with WIKI_MASTER_REQUIRE_VAULT set and no vault named, resolveVault refuses the default path', () => {
  const seen = [];
  assert.throws(
    () => resolveVault({ WIKI_MASTER_REQUIRE_VAULT: '1' }, { onRefuse: (m) => { seen.push(m); throw new Error(m); } }),
    /WIKI_MASTER_VAULT/,
  );
  assert.equal(seen.length, 1);
  assert.doesNotMatch(seen[0], /\n/, 'the refusal is one line');
});

test('strict mode is satisfied by naming a vault, and is off for 0, empty and unset', () => {
  assert.equal(resolveVault({ WIKI_MASTER_REQUIRE_VAULT: '1', WIKI_MASTER_VAULT: '/some/vault' }).path, '/some/vault');
  for (const off of ['', '0', undefined]) {
    assert.equal(resolveVault({ WIKI_MASTER_REQUIRE_VAULT: off }).path, REAL);
  }
});

test('strict mode makes a real script exit 2 with one line and touch nothing', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'wm-guard-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, WIKI_MASTER_REQUIRE_VAULT: '1' };
  delete env.WIKI_MASTER_VAULT;
  delete env.NODE_TEST_CONTEXT;
  for (const [script, ...args] of [['health.mjs'], ['lint.mjs'], ['index-gen.mjs'], ['log-entry.mjs', '--op', 'x', '--title', 'y']]) {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { env, encoding: 'utf8', timeout: 30000, input: '' });
    assert.equal(r.status, 2, `${script} exited ${r.status}: ${r.stderr}`);
    assert.equal(r.stderr.trim().split('\n').length, 1, `${script} printed more than one line: ${r.stderr}`);
    assert.match(r.stderr, /WIKI_MASTER_VAULT/);
    assert.equal(r.stdout.trim(), '', `${script} printed output before refusing`);
  }
  assert.deepEqual(readdirSync(home), [], 'a refused script created something under the home directory');
});

test('under node --test the vault must be in the temp directory or the plugin folder', () => {
  const under = { NODE_TEST_CONTEXT: 'child-v8', WIKI_MASTER_VAULT: join(tmpdir(), 'some-test-vault') };
  assert.equal(resolveVault(under).path, under.WIKI_MASTER_VAULT);
  const fixture = { NODE_TEST_CONTEXT: 'child-v8', WIKI_MASTER_VAULT: join(ROOT, 'test', 'fixtures', 'lint-vault') };
  assert.equal(resolveVault(fixture).path, fixture.WIKI_MASTER_VAULT, 'a fixture vault inside the plugin folder is allowed');
  for (const env of [
    { NODE_TEST_CONTEXT: 'child-v8' },                                          // the default, which is the real vault
    { NODE_TEST_CONTEXT: 'child-v8', WIKI_MASTER_VAULT: REAL },                 // the real vault named outright
    { NODE_TEST_CONTEXT: 'child-v8', WIKI_MASTER_VAULT: join(homedir(), 'elsewhere') }, // any other place that is neither
  ]) {
    assert.throws(() => resolveVault(env), /outside the temp(orary)? directory/, JSON.stringify(env));
  }
});

test('the test guard is off outside a test run, so production behaviour is unchanged', () => {
  assert.equal(resolveVault({}).path, REAL);
  assert.equal(resolveVault({ WIKI_MASTER_VAULT: '/elsewhere/vault' }).path, '/elsewhere/vault');
});

test('a script run by a test with the default vault fails instead of acting on it', () => {
  // A home directory that does not exist, at the root of the drive: outside the temp directory and the plugin
  // folder, so the default vault under it is refused; if the guard failed the script would find nothing there.
  const home = join(parse(ROOT).root, 'wm-no-such-home');
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_TEST_CONTEXT: 'child-v8' };
  delete env.WIKI_MASTER_VAULT;
  delete env.WIKI_MASTER_REQUIRE_VAULT;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'health.mjs')], { env, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(r.status, 0, 'the script ran against the default vault');
  assert.match(`${r.stdout}${r.stderr}`, /outside the temp(orary)? directory/);
  assert.equal(existsSync(home), false);
});

test('tempVault points the environment at a temp directory and puts it back', () => {
  const env = { WIKI_MASTER_VAULT: '/before', WIKI_MASTER_VAULT_NAME: 'Before' };
  const v = tempVault({ env });
  assert.ok(isUnderTemp(v.path));
  assert.equal(env.WIKI_MASTER_VAULT, v.path);
  assert.equal(env.WIKI_MASTER_VAULT_NAME, undefined);
  v.restore();
  assert.equal(env.WIKI_MASTER_VAULT, '/before');
  assert.equal(env.WIKI_MASTER_VAULT_NAME, 'Before');
  assert.equal(isUnderTemp(REAL), false);
  assert.equal(isUnderTemp(join(tmpdir(), '..', 'elsewhere')), false, 'a path that climbs out of the temp directory is not under it');
});

test('a path on another drive is not under the temp directory', { skip: process.platform !== 'win32' }, () => {
  // path.relative() answers with an absolute path when the two are on different drives; that is not "inside".
  assert.equal(isUnderTemp(String.raw`Z:\elsewhere`, String.raw`C:\Temp`), false);
  assert.equal(isUnderTemp(String.raw`C:\Temp\vault`, String.raw`C:\Temp`), true);
});
