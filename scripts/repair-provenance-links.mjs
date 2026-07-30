// A summary page cites its clipping by the page's ORIGINAL TITLE, but the clipper
// stored that clipping under a slugified filename (`/`, `:`, `#` -> `-`, capped at
// 120 chars). The citation therefore names a file that does not exist: the trail
// dead-ends one hop from the evidence, the page reads as a provenanceGap, and the
// clipping reads as unparsed even though it was ingested correctly.
//
// The repair joins on the CONTENT HASH, not the title — the title is exactly what
// drifted (see planCitationRepair). Citations that cannot be pinned to one clipping
// are reported for review, never guessed: a wrong citation would silently
// mis-attribute provenance, the one property the whole vault rests on.
//
//   node scripts/repair-provenance-links.mjs           # dry run
//   node scripts/repair-provenance-links.mjs --apply
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { planCitationRepair } from './lib/backfill.mjs';
import { repointCitation } from './lib/repoint.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();
const plan = planCitationRepair(buildGraph(vault));

let written = 0;
for (const { page, from, to } of plan.repairs) {
  const abs = join(vault, page);
  const text = readFileSync(abs, 'utf8');
  const out = repointCitation(text, from, to);
  if (out === text) continue; // citation already gone (concurrent edit) — skip, don't force
  if (apply) writeFileSync(abs, out);
  written++;
}

console.log(
  JSON.stringify({
    type: 'repair-provenance-links',
    applied: apply,
    repaired: written,
    ambiguous: plan.ambiguous.length,
    unresolved: plan.unresolved.length,
  })
);
for (const r of plan.repairs.slice(0, 15)) console.log(`  ${r.page}\n    - [[${r.from}]]\n    + [[${r.to}]]`);
if (plan.repairs.length > 15) console.log(`  ... and ${plan.repairs.length - 15} more`);
if (plan.ambiguous.length || plan.unresolved.length) {
  console.log(JSON.stringify({ ambiguous: plan.ambiguous, unresolved: plan.unresolved }, null, 2));
  console.log('\nThese name no clipping this page\'s hashes vouch for, or more than one — left for human review.');
}
if (!apply) console.error('dry run — re-run with --apply to rewrite the citations');
