// A thin command over lib/catalogs.mjs, kept until a later change removes it.
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { catalogArgs } from './lib/catalog-options.mjs';
import { regenerateAuthoredMocs } from './lib/catalogs.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

export { BEGIN_MARK, END_MARK, MIN_PAGES, renderProjectCatalog, projectSlug, planAuthoredMocs, regenerateAuthoredMocs } from './lib/catalogs.mjs';

export function main(argv = process.argv.slice(2)) {
  const { path: vaultPath } = resolveVault();
  const { apply, project, pathsFile, diff } = catalogArgs(argv);
  if (pathsFile) throw new Error('--paths-file is supported by refresh-catalogs.mjs only');
  if (diff) throw new Error('--diff is supported by refresh-catalogs.mjs only');
  const r = regenerateAuthoredMocs(vaultPath, { apply, project });
  console.log(JSON.stringify({ type: 'moc-authored-gen', applied: apply, projects: r.written, changed: r.changed }));
  if (!apply) console.error(r.changed.length ? `dry run — ${r.changed.length} file(s) would change; re-run with --apply` : 'dry run — nothing would change');
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (err) { console.error(`moc-authored-gen: ${err.message}`); process.exitCode = 2; }
}
