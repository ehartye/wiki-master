// The generated catalogs: index.md, each project's roadmap and each project's map, built from one vault graph.
//
// A catalog is a DERIVED artifact. Prior art is unanimous (llm_wiki forbids the LLM from writing its index;
// TheKnowledge's recovery rests on "indexes are derived"; Waypoint/packed-refs regenerate rather than merge): a
// catalog that is a pure function of the pages must never be read-modify-written. The fenced region is regenerated
// in full and replaced by atomic rename, so concurrent regenerations race harmlessly: both derive from the same
// ground truth and the next run converges. Prose outside the fence is never touched. Where a target file has no
// fence yet, one is appended, rather than flagging the file for manual migration.
//
// Each fence is deliberately bare, one `- [[title]]` bullet per page with no invented description text:
// approximating a hand-written one-line description from frontmatter alone would be a fragile heuristic for a job
// hand-written prose outside the fence already does better.
//
// A roadmap regenerates from small, individually edited backlog items, so it can never again become the place status
// changes accumulate as appended "Update (date): ..." paragraphs. It lives inside the project's own nested
// wiki/authored/ folder, so a project value maps directly to a nested path. A project map instead lives in the flat
// moc/ folder, keyed by a flattened project slug.
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { buildGraph, isContent, findAmbiguousNames, wikilinkTarget } from './graph.mjs';
import { validateProject } from './catalog-options.mjs';
import { groupByProject, groupByBacklogStatus, groupByKind, unrecognizedBacklogItems, BACKLOG_STATUS_ORDER, OTHER } from './authored-group.mjs';
import { analyzeBacklog, CLOSED_STATUSES } from './backlog-deps.mjs';
import { parseNote } from './note.mjs';
import { checkLedgerPaths } from './ledger.mjs';
import { keptByMention, scopeGraph } from './catalog-scope.mjs';
import { BEGIN_MARK, END_MARK, writeFence } from './index-fence.mjs';

export { BEGIN_MARK, END_MARK };

// Reads only: `previous` is the file's text, or null when it does not exist yet; `next` is what the file
// would hold. Nothing is created, not even a directory, so a dry run can call it.
function planFenced(path, catalog, initial) {
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
  return { previous, next: writeFence(previous ?? initial(), `${BEGIN_MARK}\n${catalog}\n${END_MARK}`) };
}

// Atomic replace: readers (and Obsidian) see old-or-new, never a torn file.
function commitFenced(path, next) {
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, next);
  renameSync(tmp, path);
}

// ---- index.md ----

const SECTIONS = [
  ['synthesis', '## Syntheses'],
  ['authored', '## Authored'],
  ['moc', '## Maps of Content'],
  ['concept', '## Concepts'],
  ['source', '## Sources'],
  ['entity', '## Entities'],
];

function indexLink(p, ambiguousNames) {
  return `- [[${wikilinkTarget(p, ambiguousNames)}]]${p.status === 'stub' ? ' (stub)' : ''}`;
}

export function renderCatalog({ pages }) {
  // kind: backlog-item pages are already indexed by their own project's generated roadmap, so they are left out
  // here for the same reason the project map leaves them out.
  const content = pages.filter((p) => isContent(p.path) && p.kind !== 'backlog-item');
  // Computed from the FULL, unfiltered vault pages (this function's own `pages`
  // param already is that, unlike the per-project catalogs) -- two pages sharing
  // a basename are just as ambiguous to a bare link here as anywhere else.
  const ambiguousNames = findAmbiguousNames(pages);
  const byType = new Map(SECTIONS.map(([t]) => [t, []]));
  const other = [];
  for (const p of content) {
    if (byType.has(p.type)) byType.get(p.type).push(p);
    else other.push(p);
  }
  const lines = [];
  for (const [type, heading] of SECTIONS) {
    const group = byType.get(type);
    if (!group.length) continue;
    lines.push(heading);
    group.sort((a, b) => a.path.localeCompare(b.path));
    lines.push(...group.map((p) => indexLink(p, ambiguousNames)), '');
  }
  if (other.length) {
    lines.push('## Other');
    other.sort((a, b) => a.path.localeCompare(b.path));
    lines.push(...other.map((p) => indexLink(p, ambiguousNames)), '');
  }
  return lines.join('\n').trimEnd();
}

// `excluded` is the pages a scoped refresh left out of `graph` (an ownership ledger omits other writers'
// uncommitted pages). One the current index already lists stays listed: the index is regenerated in full, and
// without this the other writer's line would be deleted from the working copy.
export function regenerateIndex(vaultPath, { graph, apply = true, excluded = [] } = {}) {
  const indexPath = join(vaultPath, 'index.md');
  const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '---\ntype: synthesis\n---\n# Index\n';
  const seen = graph ?? buildGraph(vaultPath);
  const kept = keptByMention(excluded, [...seen.pages, ...excluded], existing);
  const catalog = renderCatalog(kept.length ? { ...seen, pages: [...seen.pages, ...kept] } : seen);
  // With no fence yet one is appended, leaving all existing content untouched. The
  // legacy hand-maintained catalog is pruned by a human/skill, not by us.
  const next = writeFence(existing, `${BEGIN_MARK}\n${catalog}\n${END_MARK}`);

  // `changed` says what an apply would change, so a dry run predicts it; only `apply` writes.
  const changed = next !== existing;
  const result = { pages: catalog.match(/^- /gm)?.length ?? 0, path: indexPath, changed, previous: existsSync(indexPath) ? existing : null, next };
  if (apply && changed) commitFenced(indexPath, next);
  return result;
}

// ---- roadmaps ----

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
function backlogLink(p, ambiguousNames, titles) {
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
  const ln = (p) => backlogLink(p, ambiguousNames, titles);
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
  return shipped.length ? ['## Shipped', ...shipped.map((p) => backlogLink(p, ambiguousNames, titles))].join('\n') : '';
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
  return `---\ntype: authored\ncreated: ${day}\nupdated: ${day}\nstatus: draft\nsources: []\nai-generated: true\nproject: ${project}\nkind: reference\n---\n# ${projectTitle} — shipped backlog items\n\nGenerated from the project's backlog by refresh-index.mjs; edit the items, not this list.\n\n`;
}

// The first heading of each item's page, by path. Read only for a project that asked for titles.
function headingsOf(vaultPath, items) {
  const titles = new Map();
  for (const p of items) {
    try { const h = parseNote(p.catalogMarkdown ?? readFileSync(join(vaultPath, ...p.path.split('/')), 'utf8')).body.match(/^#[ \t]+(.+?)[ \t]*$/m)?.[1]; if (h) titles.set(p.path, h); }
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
    const roadmapPage = pages.find(p => p.path === `wiki/authored/${project}/roadmap.md`);
    const settings = existsSync(roadmapPath) ? parseNote(roadmapPage?.catalogMarkdown ?? readFileSync(roadmapPath, 'utf8')).metadata : {};
    const titles = settings['backlog-titles'] === 'true' ? headingsOf(vaultPath, projectItems) : undefined;
    const collapse = settings['backlog-shipped'] === 'collapse' && projectItems.some((p) => p.backlogStatus === 'shipped');
    const shippedPath = join(vaultPath, 'wiki', 'authored', ...project.split('/'), 'roadmap-shipped.md');
    const shipped = collapse ? { link: `wiki/authored/${project}/roadmap-shipped` } : undefined;
    const rel = (p) => relative(vaultPath, p).replaceAll('\\', '/');
    outputs.push({ path: rel(roadmapPath), abs: roadmapPath, ...planFenced(roadmapPath, renderBacklogCatalog({ pages: projectItems, ambiguousNames, titles, shipped }), () => roadmapStub(project, now)) });
    if (collapse) outputs.push({ path: rel(shippedPath), abs: shippedPath, ...planFenced(shippedPath, renderShippedCatalog({ pages: projectItems, ambiguousNames, titles }), () => shippedStub(project, now)) });
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

// ---- project maps ----

// A project with only one page has nothing to navigate BETWEEN -- a map would
// be pure ceremony. Documented, adjustable constant rather than an unexplained
// magic number; bump it if a one-page "hub" ever turns out to be wanted.
export const MIN_PAGES = 2;

const KIND_HEADING = {
  overview: '## Overview',
  architecture: '## Architecture',
  reference: '## Reference',
  guide: '## Guides',
  diagram: '## Diagrams',
  decision: '## Decisions',
  roadmap: '## Roadmap',
  note: '## Notes',
  [OTHER]: '## Other',
};

// `acme-suite/migrator` -> `acme-suite-migrator` (a plain filesystem-safe
// stem, one level flat -- moc/ stays a flat folder like the two MOCs that
// already live there, per spec §4's decision against physical nesting).
export function projectSlug(project) {
  return project.replace(/\//g, '-');
}

export function renderProjectCatalog({ pages, ambiguousNames = new Set() }) {
  // backlog-item pages are already indexed by the project's own generated roadmap
  // (grouped by backlog-status). Listing each one again here would recreate the
  // exact per-item sprawl the folder/backlog split exists to remove -- the map
  // only ever needs to point at the roadmap page itself (kind: roadmap, above).
  const filtered = pages.filter((p) => p?.kind !== 'backlog-item');
  const lines = [];
  for (const { kind, pages: group } of groupByKind(filtered)) {
    lines.push(KIND_HEADING[kind] ?? `## ${kind}`);
    const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
    lines.push(...sorted.map((p) => `- [[${wikilinkTarget(p, ambiguousNames)}]]`), '');
  }
  return lines.join('\n').trimEnd();
}

// Plans every selected project's map without writing. `outputs` lists each file with its text now
// (`previous`, null when missing) and after (`next`). `excluded` is the pages a scoped refresh left out of
// `graph`; one the current map already lists stays listed (see lib/catalog-scope.mjs).
export function planAuthoredMocs(vaultPath, { project: selectedProject, graph, excluded = [] } = {}) {
  validateProject(selectedProject);
  const { pages } = graph ?? buildGraph(vaultPath);
  // Computed from the WHOLE vault, before filtering to wiki/authored/ — a bare
  // name written into project A's map is exactly as ambiguous as one written
  // anywhere else if project B (or any other page) shares that basename.
  const ambiguousNames = findAmbiguousNames(pages);
  const authored = pages.filter((p) => p.path.startsWith('wiki/authored/'));
  const projects = groupByProject(authored).filter((g) => g.pages.length >= MIN_PAGES);
  const leftOut = new Map(groupByProject(excluded.filter((p) => p.path.startsWith('wiki/authored/'))).map((g) => [g.key, g.pages]));
  const written = [];
  const outputs = [];
  for (const { project, key, pages: projectPages } of projects) {
    if (selectedProject !== undefined && project.toLowerCase() !== selectedProject.toLowerCase()) continue;
    written.push(project);
    const mocPath = join(vaultPath, 'moc', `${projectSlug(project)}.md`);
    const rel = relative(vaultPath, mocPath).replaceAll('\\', '/');
    let shown = projectPages;
    if (leftOut.has(key) && existsSync(mocPath)) {
      const kept = keptByMention(leftOut.get(key), [...pages, ...excluded], readFileSync(mocPath, 'utf8'));
      if (kept.length) shown = [...projectPages, ...kept];
    }
    outputs.push({ path: rel, abs: mocPath, ...planFenced(mocPath, renderProjectCatalog({ pages: shown, ambiguousNames }), () => '---\ntype: moc\nsources: []\nai-generated: true\n---\n') });
  }
  return { written, outputs };
}

// Dry run by default (apply: false) — matches every other repair/generation
// script in this repo. `changed` lists the files a run would change, or changed when apply is true;
// a dry run writes nothing.
export function regenerateAuthoredMocs(vaultPath, { apply = false, project, graph, excluded } = {}) {
  const { written, outputs } = planAuthoredMocs(vaultPath, { project, graph, excluded });
  const changed = outputs.filter((o) => o.next !== o.previous);
  if (apply) for (const o of changed) commitFenced(o.abs, o.next);
  return { written, changed: changed.map((o) => o.path), outputs: outputs.map(({ path, previous, next }) => ({ path, previous, next })) };
}

// ---- all of them, from one graph ----

// Refresh generated nodes only; a second full scan would undo the benefit. The text comes from the
// planned output, not from disk, so a dry run sees what an apply would have written and the later
// phases (the index lists the roadmap and the map) plan the same in both modes.
function updateSnapshot(graph, outputs) {
  for (const { path, next } of outputs) {
    const { metadata } = parseNote(next);
    const page = { ...metadata, path, name: basename(path, '.md').toLowerCase(), title: basename(path, '.md'), catalogMarkdown: next };
    const i = graph.pages.findIndex(p => p.path === path);
    // A foreign tracked catalog keeps its committed metadata even when we
    // update its fence: `next` preserves another writer's working frontmatter.
    if (i >= 0 && graph.pages[i].catalogMarkdown !== undefined) continue;
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
// `projectOnly` omits index generation entirely and requires an explicit project before the graph is built.
export function refreshCatalogs(vaultPath, { project, projectOnly = false, apply = false, ownedPaths, buildGraphImpl = buildGraph, now, diff = false } = {}) {
  validateProject(project);
  if (typeof projectOnly !== 'boolean') throw new Error('projectOnly must be a boolean');
  if (projectOnly && project === undefined) throw new Error('projectOnly requires an explicit project');
  if (ownedPaths !== undefined) {
    try { checkLedgerPaths(ownedPaths); } catch { throw new Error('ownedPaths must be exact vault-relative paths'); }
  }
  const started = performance.now();
  let graph = buildGraphImpl(vaultPath);
  let excluded = [];
  let snapshot = { policy: 'working-tree', head: null };
  if (ownedPaths !== undefined) ({ graph, excluded, snapshot } = scopeGraph(vaultPath, graph, ownedPaths));
  const graphMs = performance.now() - started;
  const phases = (write) => {
    const backlog = regenerateBacklogRoadmaps(vaultPath, { project, apply: write, graph, now, excluded });
    updateSnapshot(graph, backlog.outputs.filter(o => backlog.changed.includes(o.path)));
    const moc = regenerateAuthoredMocs(vaultPath, { project, apply: write, graph, excluded });
    updateSnapshot(graph, moc.outputs.filter(o => moc.changed.includes(o.path)));
    return { backlog, moc };
  };
  // A catalog this run creates can share its file name with a page, which makes that name ambiguous and changes the
  // links of any catalog rendered before it existed. A first pass that writes nothing puts every new catalog in the
  // graph. Which catalogs exist does not depend on their links, so the second pass renders the final text.
  phases(false);
  const { backlog, moc } = phases(apply);
  const index = projectOnly ? null : regenerateIndex(vaultPath, { graph, apply, excluded });
  const stale = staleCatalogLinks(vaultPath, graph.pages, { project, ownedPaths });
  const changedOutputs = [
    ...backlog.outputs.filter(o => backlog.changed.includes(o.path)),
    ...moc.outputs.filter(o => moc.changed.includes(o.path)),
    ...(index?.changed ? [{ path: 'index.md', previous: index.previous, next: index.next }] : []),
  ];
  return {
    applied: apply, project: project ?? null, projectOnly, snapshot, pages: graph.pages.length, graphBuilds: 1,
    graphMs: Math.round(graphMs), elapsedMs: Math.round(performance.now() - started),
    changed: changedOutputs.map(o => o.path),
    projects: { backlog: backlog.written, moc: moc.written },
    ...(backlog.unrecognized.length ? { unrecognized: backlog.unrecognized } : {}),
    ...(stale.length ? { staleCatalogs: stale } : {}),
    ...(diff ? { diffs: changedOutputs.map(o => ({ path: o.path, ...lineDiff(o.previous, o.next) })) } : {}),
  };
}
