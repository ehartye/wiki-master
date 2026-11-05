// A thin command over lib/catalogs.mjs, kept until a later change removes it.
import { pathToFileURL } from 'node:url';
import { catalogArgs } from './lib/catalog-options.mjs';
import { resolveVault } from './lib/vault.mjs';
import { readLedger } from './lib/ledger.mjs';
import { refreshCatalogs } from './lib/catalogs.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

export { refreshCatalogs, lineDiff, staleCatalogLinks } from './lib/catalogs.mjs';

export function main(argv = process.argv.slice(2)) {
  const options = catalogArgs(argv, { since: true, projectOnly: true });
  const ownedPaths = options.pathsFile ? readLedger(options.pathsFile) : undefined;
  const { path: vaultPath } = resolveVault();
  const { diffs, ...result } = refreshCatalogs(vaultPath, { ...options, ownedPaths });
  console.log(JSON.stringify(result));
  if (result.projectOnly) console.error('project-only: global index was not refreshed');
  // One block per changed file, after the one-line JSON, on stderr so the JSON on stdout keeps its shape.
  for (const d of diffs ?? []) {
    const body = [...d.removed.map(l => `- ${l}`), ...d.added.map(l => `+ ${l}`)];
    console.error([`diff ${d.path}`, ...(body.length ? body : ['(same lines, different order or whitespace)'])].join('\n'));
  }
  if (!result.applied) console.error(result.changed.length ? `dry run — ${result.changed.length} file(s) would change; re-run with --apply` : 'dry run — nothing would change');
  if (result.staleCatalogs) console.error(`${result.staleCatalogs.length} generated catalog(s) of other projects now hold a bare link to a name this project made ambiguous; refresh each with refresh-catalogs.mjs --project <its project> --apply: ${result.staleCatalogs.map(x => `${x.path} (${x.names.join(', ')})`).join('; ')}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (err) { console.error(`refresh-catalogs: ${err.message}`); process.exitCode = 1; }
}
