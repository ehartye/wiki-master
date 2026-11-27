import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveContext, canonicalPath } from '../scripts/lib/context.mjs';

// `npm test` (test/run-suite.mjs) keeps the machine's vault registry from the tests by moving HOME alone; it leaves
// USERPROFILE as inherited, because some Windows PDF tools crash without the real profile. That isolation holds only
// while the default registry is looked up under HOME before USERPROFILE, so this pins that order.

function homeWithRegistry(t, label) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), `wm-registry-${label}-`));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const config = join(home, '.config', 'wiki-master');
  mkdirSync(config, { recursive: true });
  // An offline root is enough: the registry is read and its default chosen without opening the vault.
  const registry = { version: 1, defaultVault: `${label}-vault`, vaults: [{ id: `${label}-vault`, path: join(home, 'vault'), obsidian: `${label}-vault` }] };
  writeFileSync(join(config, 'vaults.json'), JSON.stringify(registry));
  return { home, registry: join(config, 'vaults.json') };
}

test('the default registry is the one under HOME, not under USERPROFILE, when both are set', (t) => {
  const home = homeWithRegistry(t, 'home');
  const profile = homeWithRegistry(t, 'profile');
  const context = resolveContext({ HOME: home.home, USERPROFILE: profile.home }, { cwd: home.home });
  assert.equal(context.configPath, canonicalPath(home.registry));
  assert.equal(context.documentation.id, 'home-vault');
});

test('with HOME unset, the default registry is the one under USERPROFILE', (t) => {
  const profile = homeWithRegistry(t, 'profile');
  const context = resolveContext({ USERPROFILE: profile.home }, { cwd: profile.home });
  assert.equal(context.configPath, canonicalPath(profile.registry));
  assert.equal(context.documentation.id, 'profile-vault');
});
