// Remove raw clippings that duplicate another clipping's content-hash, keeping
// the copy the vault actually cites. Groups without a clear keeper are refused
// and reported, never guessed at.
//
//   node scripts/dedupe-clippings.mjs           # dry run
//   node scripts/dedupe-clippings.mjs --apply
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, buildNameIndex, resolveLinkTarget } from './lib/graph.mjs';
import { planClippingDedupe } from './lib/dedupe.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();
const graph = buildGraph(vault);
const byName = buildNameIndex(graph.pages);

// A clipping counts as cited when some OTHER page resolves a link to it.
const cited = new Set();
for (const p of graph.pages) {
  for (const t of [...p.outTargets, ...(p.fmTargets ?? [])]) {
    const target = resolveLinkTarget(byName, t);
    if (target && target !== p.path) cited.add(target);
  }
}

const clippings = graph.pages.filter((p) => p.path.startsWith('raw/') && p.path.endsWith('.md'));
const { remove, refused } = planClippingDedupe(clippings, (p) => cited.has(p));

if (apply) for (const f of remove) unlinkSync(join(vault, f));

console.log(JSON.stringify({
  type: 'dedupe-clippings', applied: apply, removed: remove.length, refused: refused.length,
}));
for (const r of refused) console.log(`  refused ${r.hash.slice(0, 7)}: ${r.reason}\n    ${r.files.join('\n    ')}`);
if (remove.length) console.log(remove.slice(0, 10).map((f) => `  ${apply ? 'removed' : 'would remove'} ${f}`).join('\n'));
if (remove.length > 10) console.log(`  ... and ${remove.length - 10} more`);
if (!apply) console.error('dry run — re-run with --apply to delete');
