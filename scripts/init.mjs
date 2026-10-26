import { mkdirSync, existsSync, copyFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { extractionAvailable } from './clip.mjs';
import { resolveVault } from './lib/vault.mjs';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
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

export function main() {
  const { path, name } = resolveVault();
  const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));
  scaffold(path, templatesDir);
  console.log(`Scaffolded vault at: ${path}`);
  console.log(`\nOne-time setup:`);
  console.log(`  1. In Obsidian: Open folder as vault → ${path}`);
  console.log(`  2. Verify: node "${fileURLToPath(new URL('./obsidian.mjs', import.meta.url))}" vaults   (should list "${name}")`);
  console.log(`  3. Import templates/webclipper-template.json into the Web Clipper.`);
  if (!extractionAvailable()) {
    console.log(`\n  Note: /wiki-discover needs npm/npx to acquire its pinned HTML extraction runtime.`);
  }
}

const USAGE = [
  'usage: node scripts/init.mjs',
  '',
  'Scaffolds a vault (folders, schema, templates, bases) at the vault path. Existing files are kept.',
  'Takes no options.',
  'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else main();
}
