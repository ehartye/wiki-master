import { mkdirSync, lstatSync, readdirSync, readFileSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { extractionAvailable } from './clip.mjs';
import { resolveVault } from './lib/vault.mjs';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

const GITATTRIBUTES = `# Shared files that most tasks change, so two machines often change them at once.
# merge=union keeps both sides' lines, with no conflict to resolve by hand.
# refresh-index.mjs regenerates the catalogs, which clears any duplicate lines a union merge leaves in them.
index.md    merge=union
log.md      merge=union
moc/**      merge=union
`;

const DIRS = ['raw/clippings', 'wiki/sources', 'wiki/entities', 'wiki/concepts',
              'wiki/syntheses', 'wiki/authored', 'moc', 'log', '_templates', '.wiki-master'];

export function scaffold(vaultPath, templatesDir) {
  vaultPath = resolve(vaultPath);
  templatesDir = resolve(templatesDir);
  const report = { created: [], preserved: [], differing: [], incomplete: [], errors: [] };
  const stat = path => {
    try { return lstatSync(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  // Reject links at and within the supplied root. Ancestors above it may be
  // platform aliases (for example /var on macOS), outside the scaffold boundary.
  function directory(path, root, create = false) {
    if (path !== root) directory(dirname(path), root, create);
    let entry = stat(path);
    if (!entry && create) {
      try { mkdirSync(path, { recursive: path === root }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      entry = stat(path);
    }
    if (!entry || entry.isSymbolicLink() || !entry.isDirectory()) {
      throw Object.assign(new Error('directory missing, linked or obstructed'), { code: 'OBSTRUCTION' });
    }
  }
  function attempt(path, action) {
    try { action(); }
    catch (error) { report.errors.push({ path, code: error.code || 'IO', reason: error.code === 'OBSTRUCTION' ? error.message : 'I/O failure' }); }
  }
  function writeMissing(path, content) {
    const destination = join(vaultPath, path);
    directory(dirname(destination), vaultPath);
    let fd;
    try { fd = openSync(destination, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const entry = lstatSync(destination);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw Object.assign(new Error('existing destination is not an ordinary file'), { code: 'OBSTRUCTION' });
      }
      report.preserved.push(path);
      if (!readFileSync(destination).equals(Buffer.from(content))) report.differing.push(path);
      return;
    }
    try {
      writeFileSync(fd, content);
      closeSync(fd);
      fd = undefined;
      report.created.push(path);
    } catch (error) {
      report.incomplete.push(path);
      throw error;
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  function copyMissing(path) {
    const source = join(templatesDir, path);
    directory(dirname(source), templatesDir);
    const entry = lstatSync(source);
    if (entry.isSymbolicLink()) throw Object.assign(new Error('source link is not followed'), { code: 'OBSTRUCTION' });
    if (entry.isDirectory()) {
      directory(join(vaultPath, path), vaultPath, true);
      for (const name of readdirSync(source).sort()) attempt(`${path}/${name}`, () => copyMissing(`${path}/${name}`));
    } else if (entry.isFile()) writeMissing(path, readFileSync(source));
    else throw Object.assign(new Error('source is not an ordinary file or directory'), { code: 'OBSTRUCTION' });
  }
  for (const d of DIRS) attempt(d, () => directory(join(vaultPath, d), vaultPath, true));
  attempt('index.md', () => writeMissing('index.md',
    '---\ntype: synthesis\n---\n# Index\n\n_Catalog of wiki pages. Maintained by wiki-master._\n'));
  attempt('log.md', () => writeMissing('log.md',
    '# Log\n\nEntries now live one file per operation in the log/ folder. Open **log.base** to browse them.\n'));
  attempt('.gitignore', () => writeMissing('.gitignore', '.wiki-master/\n'));
  attempt('.gitattributes', () => writeMissing('.gitattributes', GITATTRIBUTES));
  for (const path of ['vault-schema.md', 'stale.base', 'log.base', '_templates']) attempt(path, () => copyMissing(path));
  for (const key of ['created', 'preserved', 'differing', 'incomplete']) report[key].sort();
  report.errors.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (report.errors.length) throw Object.assign(new Error('Scaffold incomplete; existing content was preserved.'), { report });
  return report;
}

// What a printed command needs in front of it to act on the vault this run acted on, in the shell of this platform.
// Nothing when the vault is the default one, which needs no naming. Without this a later command reads the default
// vault, and a refresh writes catalogs there.
export function vaultPrefix(env = process.env, platform = process.platform) {
  const set = ['WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_NAME'].filter((key) => env[key]);
  if (!env.WIKI_MASTER_VAULT) return '';
  if (platform === 'win32') return set.map((key) => `$env:${key}='${env[key].replaceAll("'", "''")}'; `).join('');
  return `${set.map((key) => `${key}='${env[key].replaceAll("'", "'\\''")}'`).join(' ')} `;
}

function printReport(report) {
  for (const key of ['created', 'preserved', 'differing', 'incomplete']) {
    for (const path of report[key]) console.log(`${key}: ${path}`);
  }
  for (const error of report.errors) console.error(`blocked: ${error.path} (${error.code}: ${error.reason})`);
}

export function main() {
  const { path, name } = resolveVault();
  const templatesDir = fileURLToPath(new URL('../templates', import.meta.url));
  try { printReport(scaffold(path, templatesDir)); }
  catch (error) {
    if (!error.report) throw error;
    printReport(error.report);
    console.error('Scaffold incomplete. Created files remain; incomplete files may contain partial data. Existing files were kept.');
    process.exitCode = 1;
    return;
  }
  console.log(`Scaffolded vault at: ${path}`);
  console.log(`\nOne-time setup:`);
  const command = (file) => `${vaultPrefix()}node "${fileURLToPath(new URL(`./${file}`, import.meta.url))}"`;
  if (vaultPrefix()) console.log(`  Every command below names this vault. Name it the same way on any other command for it.`);
  console.log(`  1. The owner sets up the git repository and upstream for this folder. Init creates neither.`);
  console.log(`  2. In Obsidian: Open folder as vault → ${path}`);
  console.log(`  3. Verify: ${command('obsidian.mjs')} vaults   (should list "${name}")`);
  console.log(`  4. Obsidian Git handles all git operations. With the owner's yes: ${command('setup-obsidian-git.mjs')} --apply`);
  console.log(`  5. Import templates/webclipper-template.json into the Web Clipper.`);
  console.log(`  6. Last: ${command('refresh-index.mjs')}`);
  if (!extractionAvailable()) {
    console.log(`\n  Note: wiki-researcher discovery needs npm/npx to acquire its pinned HTML extraction runtime.`);
  }
}

const USAGE = [
  'usage: node scripts/init.mjs',
  '',
  'Scaffolds a vault (folders, schema, templates, bases, .gitattributes) at the vault path. Existing files are kept.',
  'Reports created, preserved and differing paths without file contents. Links and type conflicts are errors.',
  'On failure, exits nonzero and reports partial creation; retry adds remaining missing files.',
  'Takes no options.',
  'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else main();
}
