// Generated per-project MOC for wiki/authored/ pages. See
// docs/superpowers/specs/2026-08-11-authored-project-docs-design.md §5.3.
//
// Mirrors index-gen.mjs's own fence contract exactly, on purpose: hand-written
// prose around the fence is never touched; only the fenced region is a pure
// function of the pages, regenerated in full and committed by atomic rename.
// Where a target file has no fence yet, one is appended -- the same choice
// index-gen.mjs already made and proved safe, rather than a more conservative
// (and more complex) "flag for manual migration" convention invented fresh for
// an identical problem.
//
// The fence itself is deliberately bare -- one `- [[title]]` bullet per page,
// grouped by kind, no invented description text -- for the same reason
// index-gen.mjs's own generated catalog is bare: approximating a hand-written
// one-line description from frontmatter alone would be a new, more fragile
// heuristic for a job hand-written prose (preserved outside the fence) already
// does better.
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, findAmbiguousNames, wikilinkTarget } from './lib/graph.mjs';
import { groupByProject, groupByKind, OTHER } from './lib/authored-group.mjs';

export const BEGIN_MARK = '%% BEGIN GENERATED CATALOG — edits inside this fence are overwritten; run scripts/moc-authored-gen.mjs %%';
export const END_MARK = '%% END GENERATED CATALOG %%';

// A project with only one page has nothing to navigate BETWEEN -- a MOC would
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

// `sparta-suite/migrator` -> `sparta-suite-migrator` (a plain filesystem-safe
// stem, one level flat -- moc/ stays a flat folder like the two MOCs that
// already live there, per spec §4's decision against physical nesting).
export function projectSlug(project) {
  return project.replace(/\//g, '-');
}

function link(p, ambiguousNames) {
  return `- [[${wikilinkTarget(p, ambiguousNames)}]]`;
}

export function renderProjectCatalog({ pages, ambiguousNames = new Set() }) {
  // backlog-item pages are already indexed by the project's own generated roadmap.md
  // (backlog-gen.mjs, grouped by backlog-status). Listing each one again here would
  // recreate the exact per-item sprawl the folder/backlog split exists to remove --
  // the MOC only ever needs to point at the roadmap page itself (kind: roadmap, above).
  const filtered = pages.filter((p) => p?.kind !== 'backlog-item');
  const lines = [];
  for (const { kind, pages: group } of groupByKind(filtered)) {
    lines.push(KIND_HEADING[kind] ?? `## ${kind}`);
    const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
    lines.push(...sorted.map((p) => link(p, ambiguousNames)), '');
  }
  return lines.join('\n').trimEnd();
}

function writeFenced(path, catalog) {
  const fenced = `${BEGIN_MARK}\n${catalog}\n${END_MARK}`;
  const existing = existsSync(path)
    ? readFileSync(path, 'utf8')
    : `---\ntype: moc\nsources: []\nai-generated: true\n---\n`;
  let next;
  const begin = existing.indexOf(BEGIN_MARK);
  const end = existing.indexOf(END_MARK);
  if (begin !== -1 && end !== -1 && end > begin) {
    next = existing.slice(0, begin) + fenced + existing.slice(end + END_MARK.length);
  } else {
    // No fence yet: append one, leaving all existing content untouched --
    // mirrors index-gen.mjs's regenerateIndex exactly (see module comment).
    next = `${existing.trimEnd()}\n\n${fenced}\n`;
  }
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, next);
  renameSync(tmp, path);
}

// Dry run by default (apply: false) — matches every other repair/generation
// script in this repo. Returns { written: [project, ...] } either way, so a
// caller can inspect what WOULD happen without writing anything.
export function regenerateAuthoredMocs(vaultPath, { apply = false } = {}) {
  const { pages } = buildGraph(vaultPath);
  // Computed from the WHOLE vault, before filtering to wiki/authored/ — a bare
  // name written into project A's MOC is exactly as ambiguous as one written
  // anywhere else if project B (or any other page) shares that basename.
  const ambiguousNames = findAmbiguousNames(pages);
  const authored = pages.filter((p) => p.path.startsWith('wiki/authored/'));
  const projects = groupByProject(authored).filter((g) => g.pages.length >= MIN_PAGES);
  const written = [];
  for (const { project, pages: projectPages } of projects) {
    written.push(project);
    if (!apply) continue;
    const mocPath = join(vaultPath, 'moc', `${projectSlug(project)}.md`);
    writeFenced(mocPath, renderProjectCatalog({ pages: projectPages, ambiguousNames }));
  }
  return { written };
}

export function main() {
  const { path: vaultPath } = resolveVault();
  const apply = process.argv.includes('--apply');
  const r = regenerateAuthoredMocs(vaultPath, { apply });
  console.log(JSON.stringify({ type: 'moc-authored-gen', applied: apply, projects: r.written }));
  if (!apply) console.error('dry run — re-run with --apply to write');
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
