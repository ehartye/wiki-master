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
import { groupByProject, groupByBacklogStatus, unrecognizedBacklogItems, BACKLOG_STATUS_ORDER } from './lib/authored-group.mjs';
import { analyzeBacklog, CLOSED_STATUSES } from './lib/backlog-deps.mjs';
import { parseNote } from './lib/note.mjs';
import { keptByMention } from './lib/catalog-scope.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

export const BEGIN_MARK = '%% BEGIN GENERATED CATALOG — edits inside this fence are overwritten; run scripts/backlog-gen.mjs %%';
export const END_MARK = '%% END GENERATED CATALOG %%';

const STATUS_HEADING = {
  'in-progress': '## In progress',
  planned: '## Planned',
  blocked: '## Blocked',
  shipped: '## Shipped',
  dropped: '## Dropped',
};

// A heading becomes the link's text when the project opts in (titles). It is cleaned first: a pipe or
// a bracket in it would end the link early. An ambiguous name keeps its full-path target.
const cleanTitle = (text) => text.replace(/[|[\]]/g, ' ').replace(/\s+/g, ' ').trim();
function link(p, ambiguousNames, titles) {
  const title = titles?.get(p.path);
  const shown = title ? cleanTitle(title) : '';
  if (!shown) return `- [[${wikilinkTarget(p, ambiguousNames)}]]`;
  return `- [[${wikilinkTarget(p, ambiguousNames).split('|')[0]}|${shown}]]`;
}

// A prerequisite never moves an item: each stays under the status its author set. An item that
// is not closed notes what it still waits on, and a planned item whose declared prerequisites
// are all closed is listed once more under "Ready to start". Items that declare nothing render
// exactly as before. A prerequisite that does not resolve is plain text, never a dead link.
export function renderBacklogCatalog({ pages, ambiguousNames = new Set(), titles, shipped }) {
  const ln = (p) => link(p, ambiguousNames, titles);
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
    if (status === 'shipped' && shipped?.link) {
      lines.push(`${group.length} shipped item${group.length === 1 ? '' : 's'}: [[${shipped.link}|all shipped items]]`, '');
      continue;
    }
    lines.push(...[...group].sort(byName).map((p) => ln(p) + waitingOn(p)), '');
  }
  const ready = pages.filter((p) => {
    const a = byPath.get(p.path);
    return p.backlogStatus === 'planned' && a.deps.length > 0 && a.unmet.length === 0 && a.malformed.length === 0;
  });
  if (ready.length) lines.push('## Ready to start', ...ready.sort(byName).map(ln), '');
  // An item outside the vocabulary is listed, never dropped: a roadmap that skips it hides open work.
  const unrecognized = unrecognizedBacklogItems(pages);
  if (unrecognized.length) {
    lines.push('## Unrecognized status', `Set backlog-status to one of ${BACKLOG_STATUS_ORDER.join(', ')}.`,
      ...unrecognized.sort(byName).map((p) => ln(p) + (p.backlogStatus ? ` — ${code(p.backlogStatus)}` : ' — no backlog-status')), '');
  }
  return lines.join('\n').trimEnd();
}

// Every shipped item, for the page a project that collapses Shipped keeps beside its roadmap.
export function renderShippedCatalog({ pages, ambiguousNames = new Set(), titles }) {
  const shipped = pages.filter((p) => p.backlogStatus === 'shipped').sort((a, b) => a.path.localeCompare(b.path));
  return shipped.length ? ['## Shipped', ...shipped.map((p) => link(p, ambiguousNames, titles))].join('\n') : '';
}

// The page a roadmap starts as. It carries every key validate-authored.mjs requires of a page in
// a project folder (authored-contract.mjs: REQUIRED_KEYS and PROJECT_KEYS), because the project
// map groups pages by `project:` and a page without one is never listed there. `reviewed` is left
// out: nobody has reviewed a page a script just wrote. Both dates are the UTC day of the run.
// The project is written bare when it is a plain scalar (letters, digits and `_ . / -` with inner
// spaces, so `acme/tool` and `demo-valley 2` read as before) and double-quoted otherwise, because a
// ` #` would start a comment and a `: ` would split a key.
const isPlainScalar = (s) => /^[\p{L}\p{N}_.][\p{L}\p{N}_. /-]*$/u.test(s) && !s.endsWith(' ');
export function roadmapStub(projectTitle, now) {
  const day = now.toISOString().slice(0, 10);
  const project = isPlainScalar(projectTitle) ? projectTitle : JSON.stringify(projectTitle);
  return `---\ntype: authored\ncreated: ${day}\nupdated: ${day}\nstatus: draft\nsources: []\nai-generated: true\nproject: ${project}\nkind: roadmap\n---\n# ${projectTitle} — roadmap\n\n## Summary\n\n`;
}

// The page a collapsed Shipped list lives on. Same keys as a roadmap (it sits in the project folder),
// kind reference: it is a generated list, not a plan.
export function shippedStub(projectTitle, now) {
  const day = now.toISOString().slice(0, 10);
  const project = isPlainScalar(projectTitle) ? projectTitle : JSON.stringify(projectTitle);
  return `---\ntype: authored\ncreated: ${day}\nupdated: ${day}\nstatus: draft\nsources: []\nai-generated: true\nproject: ${project}\nkind: reference\n---\n# ${projectTitle} — shipped backlog items\n\nGenerated from the project's backlog by backlog-gen.mjs; edit the items, not this list.\n\n`;
}

// Reads only: `previous` is the file's text, or null when it does not exist yet; `next` is what the file
// would hold. Nothing is created, not even a directory, so a dry run can call it.
function planFenced(path, catalog, projectTitle, now, stub = roadmapStub) {
  const fenced = `${BEGIN_MARK}\n${catalog}\n${END_MARK}`;
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const existing = previous ?? stub(projectTitle, now);
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
  return { previous, next };
}

// Atomic replace: readers (and Obsidian) see old-or-new, never a torn file.
function commitFenced(path, next) {
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, next);
  renameSync(tmp, path);
}

// The first heading of each item's page, by path. Read only for a project that asked for titles.
function headingsOf(vaultPath, items) {
  const titles = new Map();
  for (const p of items) {
    try { const h = parseNote(readFileSync(join(vaultPath, ...p.path.split('/')), 'utf8')).body.match(/^#[ \t]+(.+?)[ \t]*$/m)?.[1]; if (h) titles.set(p.path, h); }
    catch { /* an unreadable item keeps its bare link */ }
  }
  return titles;
}

const validDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

// Plans every selected project's roadmap without writing. A project with zero backlog items is skipped
// entirely — there is nothing to index, and creating an empty roadmap.md would be pure ceremony.
// `outputs` lists each file with its text now (`previous`, null when missing) and after (`next`).
// `excluded` is the pages a scoped refresh left out of `graph`; an item the current roadmap already
// lists stays listed (see lib/catalog-scope.mjs).
export function planBacklogRoadmaps(vaultPath, { project: selectedProject, graph, now = new Date(), excluded = [] } = {}) {
  validateProject(selectedProject);
  // The stub date never changes whether a file changes (a missing file always does), so a plan with an
  // unusable `now` borrows the current time; only an apply, which writes the stub, insists on a valid one.
  if (!validDate(now)) now = new Date();
  const { pages } = graph ?? buildGraph(vaultPath);
  // Computed from the WHOLE vault, before filtering to backlog items — a backlog
  // item slug can collide with another project's just as easily as
  // overview.md/architecture.md/roadmap.md can (see graph.mjs's findAmbiguousNames).
  const ambiguousNames = findAmbiguousNames(pages);
  const items = pages.filter((p) => p.path.startsWith('wiki/authored/') && p.kind === 'backlog-item');
  const projects = groupByProject(items);
  const leftOut = new Map(groupByProject(excluded.filter((p) => p.path.startsWith('wiki/authored/') && p.kind === 'backlog-item')).map((g) => [g.key, g.pages]));
  const written = [];
  const outputs = [];
  const unrecognized = [];
  for (const { project, key, pages: groupItems } of projects) {
    if (selectedProject !== undefined && project.toLowerCase() !== selectedProject.toLowerCase()) continue;
    written.push(project);
    const roadmapPath = join(vaultPath, 'wiki', 'authored', ...project.split('/'), 'roadmap.md');
    let projectItems = groupItems;
    if (leftOut.has(key) && existsSync(roadmapPath)) {
      const kept = keptByMention(leftOut.get(key), [...pages, ...excluded], readFileSync(roadmapPath, 'utf8'));
      if (kept.length) projectItems = [...groupItems, ...kept];
    }
    unrecognized.push(...unrecognizedBacklogItems(projectItems).map((p) => p.path));
    const settings = existsSync(roadmapPath) ? parseNote(readFileSync(roadmapPath, 'utf8')).metadata : {};
    const titles = settings['backlog-titles'] === 'true' ? headingsOf(vaultPath, projectItems) : undefined;
    const collapse = settings['backlog-shipped'] === 'collapse' && projectItems.some((p) => p.backlogStatus === 'shipped');
    const shippedPath = join(vaultPath, 'wiki', 'authored', ...project.split('/'), 'roadmap-shipped.md');
    const shipped = collapse ? { link: `wiki/authored/${project}/roadmap-shipped` } : undefined;
    const rel = (p) => relative(vaultPath, p).replaceAll('\\', '/');
    outputs.push({ path: rel(roadmapPath), abs: roadmapPath, ...planFenced(roadmapPath, renderBacklogCatalog({ pages: projectItems, ambiguousNames, titles, shipped }), project, now) });
    if (collapse) outputs.push({ path: rel(shippedPath), abs: shippedPath, ...planFenced(shippedPath, renderShippedCatalog({ pages: projectItems, ambiguousNames, titles }), project, now, shippedStub) });
  }
  return { written, outputs, unrecognized };
}

// Dry run by default (apply: false) — matches every other repair/generation script in this repo.
// `changed` lists the files a run would change, or changed when apply is true; a dry run writes nothing.
export function regenerateBacklogRoadmaps(vaultPath, { apply = false, project, graph, now = new Date(), excluded } = {}) {
  if (apply && !validDate(now)) throw new TypeError('now must be a valid Date');
  const { written, outputs, unrecognized } = planBacklogRoadmaps(vaultPath, { project, graph, now, excluded });
  const changed = outputs.filter((o) => o.next !== o.previous);
  if (apply) for (const o of changed) commitFenced(o.abs, o.next);
  return { written, changed: changed.map((o) => o.path), outputs: outputs.map(({ path, previous, next }) => ({ path, previous, next })), unrecognized };
}

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

