import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildGraph, findAmbiguousNames, isContent } from './lib/graph.mjs';
import { parseNote } from './lib/note.mjs';
import { catalogArgs, validateProject } from './lib/catalog-options.mjs';
import { resolveVault } from './lib/vault.mjs';
import { checkLedgerPaths, readLedger } from './lib/ledger.mjs';
import { regenerateBacklogRoadmaps } from './backlog-gen.mjs';
import { regenerateAuthoredMocs, projectSlug } from './moc-authored-gen.mjs';
import { regenerateIndex } from './index-gen.mjs';

// Refresh generated nodes only; a second full scan would undo the benefit.
function updateSnapshot(vaultPath, graph, paths) {
  for (const path of paths) {
    const { metadata } = parseNote(readFileSync(join(vaultPath, path), 'utf8'));
    const page = { ...metadata, path, name: basename(path, '.md').toLowerCase(), title: basename(path, '.md') };
    const i = graph.pages.findIndex(p => p.path === path);
    if (i < 0) graph.pages.push(page);
    else graph.pages[i] = { ...graph.pages[i], ...page };
  }
}

// A page whose file name another project already uses turns that project's generated bare link into an
// ambiguous one, and a refresh scoped to the new page's project does not touch the other project's
// catalog. This names those catalogs (generated MOCs and the fenced region of a roadmap) so the author
// can refresh them; it reads the files and edits nothing. It looks only at names that a page of the
// selected project, or a page in the ownership ledger, shares with another page, and skips the selected
// project's own catalogs, which this run regenerates. An unscoped refresh regenerates every catalog, so
// nothing can be stale.
const CATALOG_FENCE = /%% BEGIN GENERATED CATALOG[^\n]*%%([\s\S]*?)%% END GENERATED CATALOG %%/;
export function staleCatalogLinks(vaultPath, pages, { project, ownedPaths } = {}) {
  if (project === undefined) return [];
  const prefix = `wiki/authored/${project}/`.toLowerCase();
  const owned = new Set(ownedPaths ?? []);
  const ambiguous = findAmbiguousNames(pages);
  const causes = new Set();
  for (const p of pages) {
    if (!isContent(p.path)) continue;
    const name = basename(p.path, '.md').toLowerCase();
    if (ambiguous.has(name) && (p.path.toLowerCase().startsWith(prefix) || owned.has(p.path))) causes.add(name);
  }
  if (!causes.size) return [];
  const ownMoc = `moc/${projectSlug(project)}.md`;
  const found = [];
  for (const p of pages) {
    const isCatalog = (p.path.startsWith('moc/') && p.path !== ownMoc)
      || (/^wiki\/authored\/.+\/roadmap\.md$/.test(p.path) && !p.path.toLowerCase().startsWith(prefix));
    if (!isCatalog) continue;
    let fence;
    try { fence = readFileSync(join(vaultPath, ...p.path.split('/')), 'utf8').match(CATALOG_FENCE)?.[1]; } catch { continue; }
    if (fence === undefined) continue;
    const names = new Set();
    for (const m of fence.matchAll(/\[\[([^\]|#]+)/g)) {
      const target = m[1].trim();
      const name = target.replace(/\.md$/i, '').toLowerCase();
      if (!target.includes('/') && causes.has(name)) names.add(name);
    }
    if (names.size) found.push({ path: p.path, names: [...names].sort() });
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// `now` is the date a newly created roadmap is stamped with; omitted or undefined means the current time.
export function refreshCatalogs(vaultPath, { project, apply = false, ownedPaths, buildGraphImpl = buildGraph, now } = {}) {
  validateProject(project);
  if (ownedPaths !== undefined) {
    try { checkLedgerPaths(ownedPaths); } catch { throw new Error('ownedPaths must be exact vault-relative paths'); }
  }
  const started = performance.now();
  const graph = buildGraphImpl(vaultPath);
  if (ownedPaths !== undefined) {
    // NUL delimiters preserve spaces, Unicode and literal pathspec characters.
    const tracked = new Set(execFileSync('git', ['ls-files', '-z'], {
      cwd: vaultPath, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    }).split('\0').filter(Boolean));
    const owned = new Set(ownedPaths);
    graph.pages = graph.pages.filter(p => tracked.has(p.path) || owned.has(p.path));
  }
  const graphMs = performance.now() - started;
  const backlog = regenerateBacklogRoadmaps(vaultPath, { project, apply, graph, now });
  if (apply) updateSnapshot(vaultPath, graph, backlog.changed);
  const moc = regenerateAuthoredMocs(vaultPath, { project, apply, graph });
  if (apply) updateSnapshot(vaultPath, graph, moc.changed);
  const index = regenerateIndex(vaultPath, { graph, apply });
  const stale = staleCatalogLinks(vaultPath, graph.pages, { project, ownedPaths });
  return {
    applied: apply, project: project ?? null, pages: graph.pages.length, graphBuilds: 1,
    graphMs: Math.round(graphMs), elapsedMs: Math.round(performance.now() - started),
    changed: [...backlog.changed, ...moc.changed, ...(index.changed ? ['index.md'] : [])],
    projects: { backlog: backlog.written, moc: moc.written },
    ...(backlog.unrecognized.length ? { unrecognized: backlog.unrecognized } : {}),
    ...(stale.length ? { staleCatalogs: stale } : {}),
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = catalogArgs(argv);
  const ownedPaths = options.pathsFile ? readLedger(options.pathsFile) : undefined;
  const result = refreshCatalogs(resolveVault().path, { ...options, ownedPaths });
  console.log(JSON.stringify(result));
  if (result.staleCatalogs) console.error(`${result.staleCatalogs.length} generated catalog(s) of other projects now hold a bare link to a name this project made ambiguous; refresh each with refresh-catalogs.mjs --project <its project> --apply: ${result.staleCatalogs.map(x => `${x.path} (${x.names.join(', ')})`).join('; ')}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (err) { console.error(`refresh-catalogs: ${err.message}`); process.exitCode = 1; }
}
