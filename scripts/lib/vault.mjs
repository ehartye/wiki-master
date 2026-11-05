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

// A command in both shells' forms, acting on the vault in `env`, or null for the default vault, which needs no naming.
// A later command that loses the vault reads the default one, and a refresh writes catalogs there, so neither form can
// run node after a failed assignment: the PowerShell line is a syntax error in a POSIX shell, and the POSIX line an
// unknown command in PowerShell. `if` rather than `;` keeps a failing exit visible from `-Command`.
export function commandForms(script, args = '', env = process.env) {
  if (!env.WIKI_MASTER_VAULT) return null;
  const keys = ['WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_NAME'].filter((key) => env[key]);
  const single = (value) => `'${value.replaceAll("'", "''")}'`;
  const posix = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const assignments = keys.map((key) => `$env:${key}=${single(env[key])}`);
  const condition = assignments.length > 1 ? assignments.map((a) => `(${a})`).join(' -and ') : assignments[0];
  return {
    powershell: `if (${condition}) { node ${single(script)}${args} }`,
    posix: `${keys.map((key) => `${key}=${posix(env[key])}`).join(' ')} node ${posix(script)}${args}`,
  };
}

// The lines to show someone for one command: bare for the default vault, otherwise each form labeled.
export function commandLines(script, args = '', env = process.env) {
  const forms = commandForms(script, args, env);
  return forms ? [`PowerShell: ${forms.powershell}`, `POSIX shell: ${forms.posix}`] : [`node "${script}"${args}`];
}

const samePath = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

// Whether a vault is only the default one, reached because nothing named another.
export const isDefaultVault = (path, env = process.env) => !env.WIKI_MASTER_VAULT && samePath(path, join(homedir(), '.wiki-master-vault'));

// The variables a command needs to act on this vault: none for the default one.
export function vaultEnvFor(path, env = process.env) {
  if (isDefaultVault(path, env)) return {};
  return { WIKI_MASTER_VAULT: path, ...(env.WIKI_MASTER_VAULT_NAME ? { WIKI_MASTER_VAULT_NAME: env.WIKI_MASTER_VAULT_NAME } : {}) };
}

export function buildArgs(name, args) {
  return [`vault=${name}`, ...args];
}

// Reads normally finish in milliseconds. A hung app must not block an agent
// indefinitely; callers with a known longer operation may supply a finite bound.
// `name: null` names no vault, and `cwd` sets the folder the CLI runs from; see obsidianActive.
export function obsidian(args, { name = resolveVault().name, cwd, timeout = 10_000, waitTimeout = 10_000, execFileSyncImpl = serializedExecFileSync } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Obsidian timeout must be a positive finite number of milliseconds');
  if (!Array.isArray(args) || !args.length) throw new Error('A CLI command is required; request not sent');
  const argv = name === null ? args : buildArgs(name, args);
  validateCliRequest(argv, cwd === undefined ? undefined : { cwd });
  try {
    return execFileSyncImpl('obsidian', argv, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout,
      waitTimeout,
      windowsHide: true,
      ...(cwd === undefined ? {} : { cwd }),
    }).trim();
  } catch (err) {
    if (err.code === 'ETIMEDOUT' && !err.message.startsWith('CLI guard worker')) throw Object.assign(new Error(`obsidian ${args[0]} timed out after ${timeout}ms; command outcome may be unknown`, { cause: err }), { code: err.code });
    const msg = (err.stderr || err.message || '').toString();
    throw Object.assign(new Error(`obsidian ${args[0]} failed: ${msg}`, { cause: err }), { code: err.code });
  }
}

// Asks the running app about the vault it already has active. With no `vault=` the CLI uses the vault of its working
// directory, else the active one, so this runs from the temp folder and names nothing: the question cannot be about,
// or cause the app to open, any other vault. Whether `vault=<name>` opens a vault that is not open is undocumented.
export function obsidianActive(args, opts = {}) {
  return obsidian(args, { ...opts, name: null, cwd: tmpdir() });
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
      `Vault "${name}" is not registered. Open the vault folder in Obsidian once (see /wiki-setup).`
    );
  }
}
