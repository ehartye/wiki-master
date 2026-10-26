// Generated roadmap-as-index over wiki/authored/ backlog items. See
// docs/superpowers/specs/2026-08-11-authored-project-structure-v2-design.md §3.
//
// This is the actual completion of the monolith-detection signal (health.mjs's
// monolithCandidates, reported-not-scored): a roadmap.md that regenerates from small,
// individually-edited backlog/*.md items can never again become the place status changes
// accumulate as appended "Update (date): ..." paragraphs.
//
// Mirrors moc-authored-gen.mjs's fence contract exactly: hand-written framing prose around the
// fence is never touched; only the fenced region is a pure function of the pages. Unlike the
// MOC (which lives in a separate, flat moc/ folder keyed by a flattened project slug), a
// project's roadmap.md lives INSIDE that project's own nested wiki/authored/ folder, alongside
// its overview.md/architecture.md/etc — so the project value maps directly to a nested path
// here, never flattened.
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { catalogArgs, validateProject } from './lib/catalog-options.mjs';
import { buildGraph, findAmbiguousNames, wikilinkTarget } from './lib/graph.mjs';
import { groupByProject, groupByBacklogStatus } from './lib/authored-group.mjs';
import { analyzeBacklog, CLOSED_STATUSES } from './lib/backlog-deps.mjs';

export const BEGIN_MARK = '%% BEGIN GENERATED CATALOG — edits inside this fence are overwritten; run scripts/backlog-gen.mjs %%';
export const END_MARK = '%% END GENERATED CATALOG %%';

const STATUS_HEADING = {
  'in-progress': '## In progress',
  planned: '## Planned',
  blocked: '## Blocked',
  shipped: '## Shipped',
  dropped: '## Dropped',
};

function link(p, ambiguousNames) {
  return `- [[${wikilinkTarget(p, ambiguousNames)}]]`;
}

// A prerequisite never moves an item: each stays under the status its author set. An item that
// is not closed notes what it still waits on, and a planned item whose declared prerequisites
// are all closed is listed once more under "Ready to start". Items that declare nothing render
// exactly as before. A prerequisite that does not resolve is plain text, never a dead link.
export function renderBacklogCatalog({ pages, ambiguousNames = new Set() }) {
  const { byPath } = analyzeBacklog(pages);
  const pageAt = new Map(pages.map((p) => [p.path, p]));
  const code = (text) => `\`${text}\``;
  const waitingOn = (p) => {
    const { unmet, malformed } = byPath.get(p.path);
    const names = [
      ...unmet.map((d) => (d.path ? `[[${wikilinkTarget(pageAt.get(d.path), ambiguousNames)}]]` : code(d.target))),
      ...malformed.map(code),
    ];
    return names.length && !CLOSED_STATUSES.includes(p.backlogStatus) ? ` — waiting on ${names.join(', ')}` : '';
  };
  const byName = (a, b) => a.path.localeCompare(b.path);
  const lines = [];
  for (const { status, pages: group } of groupByBacklogStatus(pages)) {
    lines.push(STATUS_HEADING[status] ?? `## ${status}`);
    lines.push(...[...group].sort(byName).map((p) => link(p, ambiguousNames) + waitingOn(p)), '');
  }
  const ready = pages.filter((p) => {
    const a = byPath.get(p.path);
    return p.backlogStatus === 'planned' && a.deps.length > 0 && a.unmet.length === 0 && a.malformed.length === 0;
  });
  if (ready.length) lines.push('## Ready to start', ...ready.sort(byName).map((p) => link(p, ambiguousNames)), '');
  return lines.join('\n').trimEnd();
}

// The page a roadmap starts as. It carries every key validate-authored.mjs requires of a page in
// a project folder (authored-contract.mjs: REQUIRED_KEYS and PROJECT_KEYS), because the project
// map groups pages by `project:` and a page without one is never listed there. `reviewed` is left
// out: nobody has reviewed a page a script just wrote. Both dates are the UTC day of the run.
// The project is written as a plain YAML scalar, so a name that is not one is not handled.
function roadmapStub(projectTitle, now) {
  const day = now.toISOString().slice(0, 10);
  return `---\ntype: authored\ncreated: ${day}\nupdated: ${day}\nstatus: draft\nsources: []\nai-generated: true\nproject: ${projectTitle}\nkind: roadmap\n---\n# ${projectTitle} — roadmap\n\n## Summary\n\n`;
}

function writeFenced(path, catalog, projectTitle, now) {
  const fenced = `${BEGIN_MARK}\n${catalog}\n${END_MARK}`;
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : roadmapStub(projectTitle, now);
  let next;
  const begin = existing.indexOf(BEGIN_MARK);
  const end = existing.indexOf(END_MARK);
  if (begin !== -1 && end !== -1 && end > begin) {
    next = existing.slice(0, begin) + fenced + existing.slice(end + END_MARK.length);
  } else {
    // No fence yet: append one, leaving all existing content untouched — mirrors
    // index-gen.mjs/moc-authored-gen.mjs exactly (see module comment).
    next = `${existing.trimEnd()}\n\n${fenced}\n`;
  }
  if (next === existing) return false;
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, next);
  renameSync(tmp, path);
  return true;
}

// Dry run by default (apply: false) — matches every other repair/generation script in this
// repo. Returns { written: [project, ...] } either way, so a caller can inspect what WOULD
// happen without writing anything. A project with zero backlog items is skipped entirely —
// there is nothing to index, and creating an empty roadmap.md would be pure ceremony.
export function regenerateBacklogRoadmaps(vaultPath, { apply = false, project: selectedProject, graph, now = new Date() } = {}) {
  validateProject(selectedProject);
  // Read only when a stub may be written, so a dry run never depends on it.
  if (apply && !(now instanceof Date && !Number.isNaN(now.getTime()))) throw new TypeError('now must be a valid Date');
  const { pages } = graph ?? buildGraph(vaultPath);
  // Computed from the WHOLE vault, before filtering to backlog items — a backlog
  // item slug can collide with another project's just as easily as
  // overview.md/architecture.md/roadmap.md can (see graph.mjs's findAmbiguousNames).
  const ambiguousNames = findAmbiguousNames(pages);
  const items = pages.filter((p) => p.path.startsWith('wiki/authored/') && p.kind === 'backlog-item');
  const projects = groupByProject(items);
  const written = [];
  const changed = [];
  for (const { project, pages: projectItems } of projects) {
    if (selectedProject !== undefined && project.toLowerCase() !== selectedProject.toLowerCase()) continue;
    written.push(project);
    if (!apply) continue;
    const roadmapPath = join(vaultPath, 'wiki', 'authored', ...project.split('/'), 'roadmap.md');
    if (writeFenced(roadmapPath, renderBacklogCatalog({ pages: projectItems, ambiguousNames }), project, now)) changed.push(relative(vaultPath, roadmapPath).replaceAll('\\', '/'));
  }
  return { written, changed };
}

export function main(argv = process.argv.slice(2)) {
  const { path: vaultPath } = resolveVault();
  const { apply, project, pathsFile } = catalogArgs(argv);
  if (pathsFile) throw new Error('--paths-file is supported by refresh-catalogs.mjs only');
  const r = regenerateBacklogRoadmaps(vaultPath, { apply, project });
  console.log(JSON.stringify({ type: 'backlog-gen', applied: apply, projects: r.written, changed: r.changed }));
  if (!apply) console.error('dry run — re-run with --apply to write');
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
