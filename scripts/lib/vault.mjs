import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

export function resolveVault() {
  const path = process.env.WIKI_MASTER_VAULT || join(homedir(), '.wiki-master-vault');
  const name = process.env.WIKI_MASTER_VAULT_NAME || basename(path);
  return { path, name };
}

export function buildArgs(name, args) {
  return [`vault=${name}`, ...args];
}

export function obsidian(args, { name = resolveVault().name } = {}) {
  try {
    return execFileSync('obsidian', buildArgs(name, args), {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    throw new Error(`obsidian ${args.join(' ')} failed: ${msg}`);
  }
}

export function obsidianJson(args, opts) {
  const out = obsidian([...args, 'format=json'], opts);
  return out ? JSON.parse(out) : null;
}

export function assertRunning() {
  const { name } = resolveVault();
  let vaults;
  try {
    vaults = obsidian(['vaults'], { name });
  } catch {
    throw new Error(
      'Obsidian CLI unavailable. Ensure Obsidian 1.12+ is running and the CLI is enabled (Settings → General → Command line interface).'
    );
  }
  if (!vaults.split(/\r?\n/).some((l) => l.includes(name))) {
    throw new Error(
      `Vault "${name}" is not registered. Open the vault folder in Obsidian once (see /wiki-init).`
    );
  }
}
