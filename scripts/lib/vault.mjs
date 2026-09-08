import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { serializedExecFileSync, validateCliRequest } from './cli-transport.mjs';

export function resolveVault() {
  const path = process.env.WIKI_MASTER_VAULT || join(homedir(), '.wiki-master-vault');
  const name = process.env.WIKI_MASTER_VAULT_NAME || basename(path);
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
