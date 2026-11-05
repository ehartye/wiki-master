// A thin command over lib/catalogs.mjs, kept until a later change removes it.
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveVault } from './lib/vault.mjs';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { buildGraph } from './lib/graph.mjs';
import { scopeGraph } from './lib/catalog-scope.mjs';
import { checkLedgerPaths, readLedger } from './lib/ledger.mjs';
import { writtenRecorder } from './lib/op-ledger.mjs';
import { regenerateIndex } from './lib/catalogs.mjs';

export { BEGIN_MARK, END_MARK, renderCatalog, regenerateIndex } from './lib/catalogs.mjs';

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { 'paths-file': { type: 'string' }, since: { type: 'string' } } });
  const { path: vaultPath } = resolveVault();
  let scoped = {};
  if (values['paths-file'] !== undefined) scoped = scopeGraph(vaultPath, buildGraph(vaultPath), checkLedgerPaths(readLedger(values['paths-file'])));
  const r = regenerateIndex(vaultPath, scoped);
  console.log(`index.md regenerated: ${r.pages} pages cataloged`);
  if (scoped.snapshot) console.error(`catalog snapshot: ${scoped.snapshot.policy}${scoped.snapshot.head ? ` (${scoped.snapshot.head})` : ''}`);
  // Recorded only when the file changed: an unchanged index is not a path this operation wrote.
  if (values.since !== undefined && r.changed) writtenRecorder(vaultPath, argv)('index.md');
  return r;
}

const USAGE = [
  'usage: node scripts/index-gen.mjs [--paths-file <JSON array>] [--since <token>]',
  '',
  'Regenerates the catalog between the fence markers of index.md. Manual framing outside the fence is kept.',
  'Without an option it lists every page on disk, another writer\'s uncommitted pages included.',
  '--paths-file <JSON array of vault-relative paths> is the operation\'s ownership ledger: the catalog then lists a page only when it is in',
  'the last commit or the ledger names it, and keeps a line it already holds for another writer\'s page that still exists.',
  'Foreign committed pages use pinned HEAD content; owned pages use working files. With no HEAD, tracked working files remain visible.',
  '--since <token> records index.md in the operation\'s written-paths ledger when the file changed (op-ledger.mjs show prints the ledger).',
  'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else {
    try { main(); }
    catch (err) { console.error(`index-gen: ${err.message}`); process.exitCode = 2; }
  }
}
