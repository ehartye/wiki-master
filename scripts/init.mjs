import { mkdirSync, existsSync, copyFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { resolveVault } from './lib/vault.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIRS = ['raw/clippings', 'wiki/sources', 'wiki/entities', 'wiki/concepts',
              'wiki/syntheses', 'wiki/authored', 'moc', 'log', '_templates', '.wiki-master'];

function writeIfAbsent(path, content) {
  if (!existsSync(path)) writeFileSync(path, content);
}

export function scaffold(vaultPath, templatesDir) {
  for (const d of DIRS) mkdirSync(join(vaultPath, d), { recursive: true });
  writeIfAbsent(join(vaultPath, 'index.md'),
    '---\ntype: synthesis\n---\n# Index\n\n_Catalog of wiki pages. Maintained by wiki-master._\n');
  writeIfAbsent(join(vaultPath, 'log.md'),
    '# Log\n\nEntries now live one file per operation in the log/ folder. Open **log.base** to browse them.\n');
  writeIfAbsent(join(vaultPath, '.gitignore'), '.wiki-master/\n');
  if (!existsSync(join(vaultPath, 'vault-schema.md')))
    copyFileSync(join(templatesDir, 'vault-schema.md'), join(vaultPath, 'vault-schema.md'));
  if (!existsSync(join(vaultPath, 'stale.base')))
    copyFileSync(join(templatesDir, 'stale.base'), join(vaultPath, 'stale.base'));
  if (!existsSync(join(vaultPath, 'log.base')))
    copyFileSync(join(templatesDir, 'log.base'), join(vaultPath, 'log.base'));
  cpSync(join(templatesDir, '_templates'), join(vaultPath, '_templates'), { recursive: true });
}

function defuddleAvailable() {
  // execSync (shell) so Windows resolves the defuddle.cmd npm shim via PATHEXT.
  for (const cmd of ['defuddle --version', 'npx --yes defuddle --version']) {
    try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { /* try next */ }
  }
  return false;
}

export function main() {
  const { path, name } = resolveVault();
  const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));
  scaffold(path, templatesDir);
  console.log(`Scaffolded vault at: ${path}`);
  console.log(`\nOne-time setup:`);
  console.log(`  1. In Obsidian: Open folder as vault → ${path}`);
  console.log(`  2. Verify: obsidian vaults   (should list "${name}")`);
  console.log(`  3. Import templates/webclipper-template.json into the Web Clipper.`);
  if (!defuddleAvailable()) {
    console.log(`\n  Note: /wiki-discover needs the Defuddle CLI. Install: npm i -g defuddle`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
