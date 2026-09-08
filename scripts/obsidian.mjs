// Agent-facing proxy: use this instead of invoking the native CLI directly.
import { obsidian } from './lib/vault.mjs';
import { pathToFileURL } from 'node:url';

export function main(args = process.argv.slice(2)) {
  const result = obsidian(args);
  console.log(result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
