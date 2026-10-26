import { homedir, tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename, resolve, relative, isAbsolute } from 'node:path';
import { serializedExecFileSync, validateCliRequest } from './cli-transport.mjs';

// True when `path` is `dir` or inside it, also by its real path (macOS temp is a symlink).
export function isUnder(path, dir) {
  const roots = new Set([resolve(dir)]);
  try { roots.add(realpathSync(dir)); } catch { /* a missing directory has only its given spelling */ }
  const target = resolve(path);
  return [...roots].some((root) => {
    const rel = relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
}

export const isUnderTemp = (path, temp = tmpdir()) => isUnder(path, temp);

const PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const refuseAndExit = (message) => { console.error(message); process.exit(2); };

// The vault is WIKI_MASTER_VAULT, else the owner's real vault. Two guards keep that default from being reached
// by accident: WIKI_MASTER_REQUIRE_VAULT=1 makes a script stop (exit 2, one line) when no vault is named, and
// under `node --test` (NODE_TEST_CONTEXT is set, and a child process inherits it) a vault outside the temp
// directory and the plugin's own folder (where fixture vaults live) throws, so a test that forgets to name
// one fails instead of acting on the real vault.
export function resolveVault(env = process.env, { onRefuse = refuseAndExit } = {}) {
  const named = env.WIKI_MASTER_VAULT;
  const required = env.WIKI_MASTER_REQUIRE_VAULT;
  if (!named && required && required !== '0') {
    onRefuse('wiki-master: WIKI_MASTER_REQUIRE_VAULT is set and WIKI_MASTER_VAULT is not, so no vault is chosen; set WIKI_MASTER_VAULT to the vault to act on');
    throw new Error('no vault chosen');
  }
  const path = named || join(homedir(), '.wiki-master-vault');
  if (env.NODE_TEST_CONTEXT && !isUnderTemp(path) && !isUnder(path, PLUGIN_ROOT)) {
    throw new Error(`wiki-master: the vault ${path} is outside the temporary directory and the plugin folder, and a test run may only use a temporary or fixture vault; set WIKI_MASTER_VAULT to a directory under ${tmpdir()}`);
  }
  const name = env.WIKI_MASTER_VAULT_NAME || basename(path);
  return { path, name };
}

export function buildArgs(name, args) {
  return [`vault=${name}`, ...args];
}

// Reads normally finish in milliseconds. A hung app must not block an agent
// indefinitely; callers with a known longer operation may supply a finite bound.
export function obsidian(args, { name = resolveVault().name, timeout = 10_000, waitTimeout = 10_000, execFileSyncImpl = serializedExecFileSync } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Obsidian timeout must be a positive finite number of milliseconds');
  if (!Array.isArray(args) || !args.length) throw new Error('A CLI command is required; request not sent');
  const argv = buildArgs(name, args);
  validateCliRequest(argv);
  try {
    return execFileSyncImpl('obsidian', argv, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout,
      waitTimeout,
      windowsHide: true,
    }).trim();
  } catch (err) {
    if (err.code === 'ETIMEDOUT' && !err.message.startsWith('CLI guard worker')) throw Object.assign(new Error(`obsidian ${args[0]} timed out after ${timeout}ms; command outcome may be unknown`, { cause: err }), { code: err.code });
    const msg = (err.stderr || err.message || '').toString();
    throw Object.assign(new Error(`obsidian ${args[0]} failed: ${msg}`, { cause: err }), { code: err.code });
  }
}

export function obsidianJson(args, opts) {
  const out = obsidian([...args, 'format=json'], opts);
  if (!out) return null;
  try { return JSON.parse(out); }
  catch (err) { throw new Error(`obsidian ${args[0]} returned invalid JSON`, { cause: err }); }
}

export function assertRunning({ name = resolveVault().name, ...opts } = {}) {
  let vaults;
  try {
    vaults = obsidian(['vaults'], { name, ...opts });
  } catch (err) {
    throw new Error(
      `Obsidian CLI unavailable: ${err.message}. Ensure Obsidian 1.12+ is running and the CLI is enabled (Settings → General → Command line interface).`,
      { cause: err }
    );
  }
  if (!vaults.split(/\r?\n/).some((l) => l.includes(name))) {
    throw new Error(
      `Vault "${name}" is not registered. Open the vault folder in Obsidian once (see /wiki-init).`
    );
  }
}
