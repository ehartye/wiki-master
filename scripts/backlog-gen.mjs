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
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { groupByProject, groupByBacklogStatus } from './lib/authored-group.mjs';

export const BEGIN_MARK = '%% BEGIN GENERATED CATALOG — edits inside this fence are overwritten; run scripts/backlog-gen.mjs %%';
export const END_MARK = '%% END GENERATED CATALOG %%';

const STATUS_HEADING = {
  'in-progress': '## In progress',
  planned: '## Planned',
  blocked: '## Blocked',
  shipped: '## Shipped',
  dropped: '## Dropped',
};

function link(p) {
  return `- [[${basename(p.path, '.md')}]]`;
}

export function renderBacklogCatalog({ pages }) {
  const lines = [];
  for (const { status, pages: group } of groupByBacklogStatus(pages)) {
    lines.push(STATUS_HEADING[status] ?? `## ${status}`);
    const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
    lines.push(...sorted.map(link), '');
  }
  return lines.join('\n').trimEnd();
}

function writeFenced(path, catalog, projectTitle) {
  const fenced = `${BEGIN_MARK}\n${catalog}\n${END_MARK}`;
  const existing = existsSync(path)
    ? readFileSync(path, 'utf8')
    : `---\ntype: authored\nsources: []\nai-generated: true\nkind: roadmap\n---\n# ${projectTitle} — roadmap\n\n## Summary\n\n`;
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
  const dir = join(path, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, next);
  renameSync(tmp, path);
}

// Dry run by default (apply: false) — matches every other repair/generation script in this
// repo. Returns { written: [project, ...] } either way, so a caller can inspect what WOULD
// happen without writing anything. A project with zero backlog items is skipped entirely —
// there is nothing to index, and creating an empty roadmap.md would be pure ceremony.
export function regenerateBacklogRoadmaps(vaultPath, { apply = false } = {}) {
  const { pages } = buildGraph(vaultPath);
  const items = pages.filter((p) => p.path.startsWith('wiki/authored/') && p.kind === 'backlog-item');
  const projects = groupByProject(items);
  const written = [];
  for (const { project, pages: projectItems } of projects) {
    written.push(project);
    if (!apply) continue;
    const roadmapPath = join(vaultPath, 'wiki', 'authored', ...project.split('/'), 'roadmap.md');
    writeFenced(roadmapPath, renderBacklogCatalog({ pages: projectItems }), project);
  }
  return { written };
}

export function main() {
  const { path: vaultPath } = resolveVault();
  const apply = process.argv.includes('--apply');
  const r = regenerateBacklogRoadmaps(vaultPath, { apply });
  console.log(JSON.stringify({ type: 'backlog-gen', applied: apply, projects: r.written }));
  if (!apply) console.error('dry run — re-run with --apply to write');
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
