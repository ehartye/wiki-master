import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildGraph } from './lib/graph.mjs';
import { parseNote } from './lib/note.mjs';
import { catalogArgs, validateProject } from './lib/catalog-options.mjs';
import { resolveVault } from './lib/vault.mjs';
import { regenerateBacklogRoadmaps } from './backlog-gen.mjs';
import { regenerateAuthoredMocs } from './moc-authored-gen.mjs';
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

export function refreshCatalogs(vaultPath, { project, apply = false, ownedPaths, buildGraphImpl = buildGraph } = {}) {
  validateProject(project);
  if (ownedPaths !== undefined && (!Array.isArray(ownedPaths) || ownedPaths.some(p =>
    typeof p !== 'string' || !p || p.includes('\\') || p.includes(':') || p.includes('\0') ||
    p.split('/').some(x => !x || x === '.' || x === '..')))) {
    throw new Error('ownedPaths must be exact vault-relative paths');
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
  const backlog = regenerateBacklogRoadmaps(vaultPath, { project, apply, graph });
  if (apply) updateSnapshot(vaultPath, graph, backlog.changed);
  const moc = regenerateAuthoredMocs(vaultPath, { project, apply, graph });
  if (apply) updateSnapshot(vaultPath, graph, moc.changed);
  const index = regenerateIndex(vaultPath, { graph, apply });
  return {
    applied: apply, project: project ?? null, pages: graph.pages.length, graphBuilds: 1,
    graphMs: Math.round(graphMs), elapsedMs: Math.round(performance.now() - started),
    changed: [...backlog.changed, ...moc.changed, ...(index.changed ? ['index.md'] : [])],
    projects: { backlog: backlog.written, moc: moc.written },
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = catalogArgs(argv);
  const ownedPaths = options.pathsFile ? JSON.parse(readFileSync(options.pathsFile, 'utf8')) : undefined;
  const result = refreshCatalogs(resolveVault().path, { ...options, ownedPaths });
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (err) { console.error(`refresh-catalogs: ${err.message}`); process.exitCode = 1; }
}
