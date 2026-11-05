// A thin command over lib/catalogs.mjs, kept until a later change removes it.
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { catalogArgs } from './lib/catalog-options.mjs';
import { regenerateBacklogRoadmaps } from './lib/catalogs.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

export { BEGIN_MARK, END_MARK, renderBacklogCatalog, renderShippedCatalog, roadmapStub, shippedStub, planBacklogRoadmaps, regenerateBacklogRoadmaps } from './lib/catalogs.mjs';

export function main(argv = process.argv.slice(2)) {
  const { path: vaultPath } = resolveVault();
  const { apply, project, pathsFile, diff } = catalogArgs(argv);
  if (pathsFile) throw new Error('--paths-file is supported by refresh-catalogs.mjs only');
  if (diff) throw new Error('--diff is supported by refresh-catalogs.mjs only');
  const r = regenerateBacklogRoadmaps(vaultPath, { apply, project });
  console.log(JSON.stringify({ type: 'backlog-gen', applied: apply, projects: r.written, changed: r.changed, ...(r.unrecognized.length ? { unrecognized: r.unrecognized } : {}) }));
  if (r.unrecognized.length) console.error(`${r.unrecognized.length} backlog item(s) have a status outside the vocabulary and are listed under "Unrecognized status": ${r.unrecognized.join(', ')}`);
  if (!apply) console.error(r.changed.length ? `dry run — ${r.changed.length} file(s) would change; re-run with --apply` : 'dry run — nothing would change');
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (err) { console.error(`backlog-gen: ${err.message}`); process.exitCode = 2; }
}
