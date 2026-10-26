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
import { scopeGraph } from './lib/catalog-scope.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// Refresh generated nodes only; a second full scan would undo the benefit. The text comes from the
// planned output, not from disk, so a dry run sees what an apply would have written and the later
// phases (the index lists the roadmap and the map) plan the same in both modes.
function updateSnapshot(graph, outputs) {
  for (const { path, next } of outputs) {
    const { metadata } = parseNote(next);
    const page = { ...metadata, path, name: basename(path, '.md').toLowerCase(), title: basename(path, '.md') };
    const i = graph.pages.findIndex(p => p.path === path);
    if (i < 0) graph.pages.push(page);
    else graph.pages[i] = { ...graph.pages[i], ...page };
  }
}

// The lines a file loses and gains, each counted once per occurrence. Order is not reported: a generated
// fence is sorted, so a changed line is a removal beside an addition.
export function lineDiff(previous, next) {
  const count = (text) => {
    const m = new Map();
    for (const line of (text ?? '').split(/\r?\n/)) m.set(line, (m.get(line) ?? 0) + 1);
    return m;
  };
  const a = count(previous), b = count(next);
  const take = (from, other) => [...from].flatMap(([line, n]) => Array(Math.max(0, n - (other.get(line) ?? 0))).fill(line)).filter((line) => line !== '');
  return { removed: take(a, b), added: take(b, a) };
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
// A dry run plans the same outputs an apply would write and reports the same `changed` list; with `diff`
// it also returns the lines each changed file would lose and gain. The ledger keeps another writer's
// uncommitted pages out of the catalogs, but a line a catalog already holds for one stays (catalog-scope.mjs).
export function refreshCatalogs(vaultPath, { project, apply = false, ownedPaths, buildGraphImpl = buildGraph, now, diff = false } = {}) {
  validateProject(project);
  if (ownedPaths !== undefined) {
    try { checkLedgerPaths(ownedPaths); } catch { throw new Error('ownedPaths must be exact vault-relative paths'); }
  }
  const started = performance.now();
  let graph = buildGraphImpl(vaultPath);
  let excluded = [];
  if (ownedPaths !== undefined) ({ graph, excluded } = scopeGraph(vaultPath, graph, ownedPaths));
  const graphMs = performance.now() - started;
  const backlog = regenerateBacklogRoadmaps(vaultPath, { project, apply, graph, now, excluded });
  updateSnapshot(graph, backlog.outputs.filter(o => backlog.changed.includes(o.path)));
  const moc = regenerateAuthoredMocs(vaultPath, { project, apply, graph, excluded });
  updateSnapshot(graph, moc.outputs.filter(o => moc.changed.includes(o.path)));
  const index = regenerateIndex(vaultPath, { graph, apply, excluded });
  const stale = staleCatalogLinks(vaultPath, graph.pages, { project, ownedPaths });
  const changedOutputs = [
    ...backlog.outputs.filter(o => backlog.changed.includes(o.path)),
    ...moc.outputs.filter(o => moc.changed.includes(o.path)),
    ...(index.changed ? [{ path: 'index.md', previous: index.previous, next: index.next }] : []),
  ];
  return {
    applied: apply, project: project ?? null, pages: graph.pages.length, graphBuilds: 1,
    graphMs: Math.round(graphMs), elapsedMs: Math.round(performance.now() - started),
    changed: changedOutputs.map(o => o.path),
    projects: { backlog: backlog.written, moc: moc.written },
    ...(backlog.unrecognized.length ? { unrecognized: backlog.unrecognized } : {}),
    ...(stale.length ? { staleCatalogs: stale } : {}),
    ...(diff ? { diffs: changedOutputs.map(o => ({ path: o.path, ...lineDiff(o.previous, o.next) })) } : {}),
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = catalogArgs(argv);
  const ownedPaths = options.pathsFile ? readLedger(options.pathsFile) : undefined;
  const { diffs, ...result } = refreshCatalogs(resolveVault().path, { ...options, ownedPaths });
  console.log(JSON.stringify(result));
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
