import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, isContent } from './lib/graph.mjs';

// index.md is a DERIVED artifact. Prior art is unanimous (llm_wiki forbids the
// LLM from writing its index; TheKnowledge's recovery rests on "indexes are
// derived"; Waypoint/packed-refs regenerate rather than merge): a catalog that
// is a pure function of the pages must never be read-modify-written. Regenerate
// the fenced region in full and commit by atomic rename — concurrent
// regenerations race harmlessly because both derive from the same ground truth
// and the next run converges. Prose outside the fence is never touched.

export const BEGIN_MARK = '%% BEGIN GENERATED CATALOG — edits inside this fence are overwritten; run scripts/index-gen.mjs %%';
export const END_MARK = '%% END GENERATED CATALOG %%';

const SECTIONS = [
  ['synthesis', '## Syntheses'],
  ['moc', '## Maps of Content'],
  ['concept', '## Concepts'],
  ['source', '## Sources'],
  ['entity', '## Entities'],
];

function link(p) {
  const title = basename(p.path, '.md');
  return `- [[${title}]]${p.status === 'stub' ? ' (stub)' : ''}`;
}

export function renderCatalog({ pages }) {
  const content = pages.filter((p) => isContent(p.path));
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
    lines.push(...group.map(link), '');
  }
  if (other.length) {
    lines.push('## Other');
    other.sort((a, b) => a.path.localeCompare(b.path));
    lines.push(...other.map(link), '');
  }
  return lines.join('\n').trimEnd();
}

export function regenerateIndex(vaultPath) {
  const indexPath = join(vaultPath, 'index.md');
  const catalog = renderCatalog(buildGraph(vaultPath));
  const fenced = `${BEGIN_MARK}\n${catalog}\n${END_MARK}`;

  let existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '---\ntype: synthesis\n---\n# Index\n';
  let next;
  const begin = existing.indexOf(BEGIN_MARK);
  const end = existing.indexOf(END_MARK);
  if (begin !== -1 && end !== -1 && end > begin) {
    next = existing.slice(0, begin) + fenced + existing.slice(end + END_MARK.length);
  } else {
    // No fence yet: append one, leaving all existing content untouched. The
    // legacy hand-maintained catalog is pruned by a human/skill, not by us.
    next = `${existing.trimEnd()}\n\n${fenced}\n`;
  }

  // Atomic replace: readers (and Obsidian) see old-or-new, never a torn file.
  const tmp = join(vaultPath, `index.md.tmp-${process.pid}`);
  writeFileSync(tmp, next);
  renameSync(tmp, indexPath);
  return { pages: catalog.match(/^- /gm)?.length ?? 0, path: indexPath };
}

export function main() {
  const { path: vaultPath } = resolveVault();
  const r = regenerateIndex(vaultPath);
  console.log(`index.md regenerated: ${r.pages} pages cataloged`);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
