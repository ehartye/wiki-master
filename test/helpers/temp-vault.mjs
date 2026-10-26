import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isUnderTemp } from '../../scripts/lib/vault.mjs';

export { isUnderTemp };

// A vault for one test: a fresh directory under the temp directory, with WIKI_MASTER_VAULT pointed at it
// and the previous environment put back by `restore()`. A test that acts on a vault should use this (or
// pass its own temp path in `env` to a child process) so one forgotten line can never reach the real vault.

export function tempVault({ name = 'wm-test-vault', env = process.env, init = true } = {}) {
  const path = mkdtempSync(join(tmpdir(), `${name}-`));
  if (!isUnderTemp(path)) throw new Error(`temp vault ${path} is not under the temp directory`);
  if (init) for (const dir of ['raw/clippings', 'wiki/sources', 'wiki/concepts', 'wiki/entities', 'wiki/syntheses', 'wiki/authored', 'moc', 'log']) mkdirSync(join(path, dir), { recursive: true });
  const saved = { path: env.WIKI_MASTER_VAULT, name: env.WIKI_MASTER_VAULT_NAME };
  env.WIKI_MASTER_VAULT = path;
  delete env.WIKI_MASTER_VAULT_NAME;
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    if (saved.path === undefined) delete env.WIKI_MASTER_VAULT; else env.WIKI_MASTER_VAULT = saved.path;
    if (saved.name === undefined) delete env.WIKI_MASTER_VAULT_NAME; else env.WIKI_MASTER_VAULT_NAME = saved.name;
    rmSync(path, { recursive: true, force: true });
  };
  return { path, restore };
}
