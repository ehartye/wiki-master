// Agent-facing proxy: use this instead of invoking the native CLI directly.
import { obsidian, buildArgs, resolveOperationVault, verifyObsidianTarget } from './lib/vault.mjs';
import { validateCliRequest } from './lib/cli-transport.mjs';
import { pathToFileURL } from 'node:url';

export function main(args = process.argv.slice(2), hooks = {}) {
  validateCliRequest(args);
  const vault = hooks.vault ?? resolveOperationVault('maintenance');
  const argv = buildArgs(vault.name, args).slice(1);
  const options = { name: vault.name, execFileSyncImpl: hooks.execFileSyncImpl };
  // Global discovery commands need no target. Every vault command verifies its
  // selected root first, including commands the wrapper does not yet recognize.
  if (!['help', 'version', 'vaults'].includes(argv[0])) verifyObsidianTarget(vault, options);
  const result = obsidian(argv, options);
  console.log(result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1; }
}
