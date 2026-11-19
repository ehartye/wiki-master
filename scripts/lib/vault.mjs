import { homedir, tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { serializedExecFileSync, validateCliRequest } from './cli-transport.mjs';
import { resolveContext, requireSelectedTarget, contextEnv, ContextError, assertTestVault, sameRoot } from './context.mjs';

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

const refuseAndExit = (message) => { console.error(message); process.exit(2); };

// The vault is WIKI_MASTER_VAULT, else the owner's real vault. Two guards keep that default from being reached
// by accident: WIKI_MASTER_REQUIRE_VAULT=1 makes a script stop (exit 2, one line) when no vault is named, and
// under `node --test` (NODE_TEST_CONTEXT is set, and a child process inherits it) a vault outside the temp
// directory and the plugin's own folder (where fixture vaults live) throws, so a test that forgets to name
// one fails instead of acting on the real vault.
export function resolveVault(env = process.env, { onRefuse = refuseAndExit, requireAvailable = false, ...options } = {}) {
  let context;
  // Legacy helpers historically resolve a root only; session-brief owns its legacy matching/error shape.
  try { context = resolveContext(env, { discoverLegacyProject: false, ...options }); }
  catch (error) {
    // Preserve the strict legacy guard's callback contract. Other context errors retain their exitCode.
    if (error.message.includes('WIKI_MASTER_REQUIRE_VAULT')) { onRefuse(error.message); throw new Error('no vault chosen'); }
    throw error;
  }
  const target = requireSelectedTarget(context, { available: requireAvailable });
  // `name` is the Obsidian CLI selector, not necessarily the root's folder name.
  return { path: context.legacyPath ?? target.path, name: target.selector };
}

// Public operations choose their role at the call site. Bind once and carry this
// environment to children/recovery instructions without changing process.env.
export function resolveOperationVault(purpose, { env = process.env, root, requireAvailable = true, exit = code => process.exit(code), ...options } = {}) {
  try {
    const input = root === undefined ? env : { ...env, WIKI_MASTER_VAULT: root };
    const context = resolveContext(input, { purpose, discoverLegacyProject: false, ...options });
    const target = requireSelectedTarget(context, { available: requireAvailable });
    const vault = { path: context.legacyPath ?? target.path, name: target.selector };
    Object.defineProperty(vault, 'context', { value: context });
    Object.defineProperty(vault, 'env', { value: context.configPath ? contextEnv(context, input) : { ...input } });
    return vault;
  } catch (error) {
    if (!(error instanceof ContextError)) throw error;
    console.error(error.message);
    exit(error.exitCode);
    throw error;
  }
}

// Only init calls this bootstrap path. Ordinary operations never read this option.
export function resolveSetupVault(root, env = process.env) {
  if (root === undefined) {
    const vault = resolveOperationVault('maintenance', { env, requireAvailable: false });
    // Preserve legacy first-run scaffolding. A registered offline root is never
    // recreated implicitly: initializing it requires the explicit bootstrap path.
    requireSelectedTarget(vault.context, { available: Boolean(vault.context.configPath) });
    return vault;
  }
  if (!isAbsolute(root)) throw new ContextError('--bootstrap requires an absolute vault root');
  assertTestVault(root, env);
  const name = env.WIKI_MASTER_VAULT_NAME || root.split(/[\\/]/).filter(Boolean).at(-1);
  return { path: root, name, env: { WIKI_MASTER_VAULT: root, WIKI_MASTER_VAULT_NAME: name } };
}

// A command in both shells' forms, acting on the vault in `env`, or null for the default vault, which needs no naming.
// A later command that loses the vault reads the default one, and a refresh writes catalogs there, so neither form can
// run node after a failed assignment: the PowerShell line is a syntax error in a POSIX shell, and the POSIX line an
// unknown command in PowerShell. `if` rather than `;` keeps a failing exit visible from `-Command`.
export function commandForms(script, args = '', env = process.env) {
  const keys = ['WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_NAME', 'WIKI_MASTER_PROJECT_ROOT', 'WIKI_MASTER_CONFIG', 'WIKI_MASTER_VAULT_ID'].filter((key) => env[key]);
  if (!keys.length) return null;
  // PowerShell closes a single-quoted string on a straight or typographic quote alike, so each is doubled.
  const single = (value) => `'${value.replace(/['‘’‚‛]/g, '$&$&')}'`;
  const posix =(value) => `'${value.replaceAll("'", "'\\''")}'`;
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
  const binding = Object.fromEntries(['WIKI_MASTER_PROJECT_ROOT', 'WIKI_MASTER_CONFIG', 'WIKI_MASTER_VAULT_ID', 'WIKI_MASTER_VAULT_NAME'].filter(key => env[key]).map(key => [key, env[key]]));
  if (isDefaultVault(path, env) && !Object.keys(binding).length) return {};
  return { WIKI_MASTER_VAULT: path, ...binding };
}

export function buildArgs(name, args) {
  for (const arg of args) {
    if (typeof arg === 'string' && arg.startsWith('vault=') && arg !== `vault=${name}`) {
      throw new ContextError('Conflicting raw vault= selector; use the resolved vault selection');
    }
  }
  return [`vault=${name}`, ...args.filter(arg => arg !== `vault=${name}`)];
}

export function verifyObsidianTarget(vault, options = {}) {
  const reported = obsidian(['vault', 'info=path'], { ...options, name: vault.name });
  if (!/^(?:[A-Za-z]:[\\/]|[\\/])/.test(reported) || !sameRoot(reported, vault.path)) {
    throw new ContextError(`Obsidian selected vault resolved to ${reported || '(no root)'}, not ${vault.path}; no action sent`, 1);
  }
  return reported;
}

// The CLI exits 0 when it refuses, so a refusal arrives as ordinary output. These are the refusals it is known to
// print: the whole output "Vault not found.", the gate text that begins "Command line interface is not enabled", and a
// single short line that begins "Error: ". A one-line answer may begin with the word Error (a property value "Error
// budget", a search hit "Error handling.md"), so only the colon form counts. The commands that print a note's or a
// template's text, which may begin with anything, are exempt from that rule. Output that merely mentions these words
// is an answer. Returns the CLI's words, or null.
const CONTENT_COMMANDS = new Set(['read', 'daily:read', 'template:read']);
export function cliFailure(output, args) {
  if (output === 'Vault not found.' || output.startsWith('Command line interface is not enabled')) return output;
  if (!CONTENT_COMMANDS.has(args[0]) && !/[\r\n]/.test(output) && output.length <= 300 && output.startsWith('Error: ')) return output;
  return null;
}

// Reads normally finish in milliseconds. A hung app must not block an agent
// indefinitely; callers with a known longer operation may supply a finite bound.
// `name: null` names no vault, and `cwd` sets the folder the CLI runs from; see obsidianActive.
export function obsidian(args, { name = resolveVault().name, cwd, timeout = 10_000, waitTimeout = 10_000, execFileSyncImpl = serializedExecFileSync } = {}) {
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Obsidian timeout must be a positive finite number of milliseconds');
  if (!Array.isArray(args) || !args.length) throw new Error('A CLI command is required; request not sent');
  const argv = name === null ? args : buildArgs(name, args);
  validateCliRequest(argv, cwd === undefined ? undefined : { cwd });
  let output;
  try {
    output = execFileSyncImpl('obsidian', argv, {
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
  const refusal = cliFailure(output, args);
  if (refusal !== null) throw Object.assign(new Error(`obsidian ${args[0]} failed: ${refusal}`), { code: 'OBSIDIAN_CLI_ERROR', cliOutput: refusal });
  return output;
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
