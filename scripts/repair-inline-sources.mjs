// One-time repair for `sources:` frontmatter written inline as `sources: [[A]]`
// or comma-joined as `sources: [[A]], [[B]], [[C]]` — valid-looking, and still
// Obsidian-clickable, but not valid YAML list syntax (see fixInlineSources's
// own comment in lib/backfill.mjs for why). `.obsidian/types.json` registers
// `sources` as a list vault-wide, so every affected page surfaces "type
// mismatch, expected list" in Obsidian's Properties panel. Confirmed on the
// live vault: 283 pages across wiki/sources, wiki/concepts, wiki/entities, and
// wiki/syntheses (wiki/authored is unaffected — those pages always use the
// already-valid `sources: []`).
//
// Pure string surgery (fixInlineSources), no YAML parsing: it only recognizes
// and rewrites the exact inline-wikilink-list shape, and is a no-op on
// anything else (including a genuinely valid `sources: []` and an
// already-correct block list). Dry-run by default, `--apply` to write.
// Idempotent and safe to re-run. Scans the WHOLE vault (not scoped to one
// subdirectory like repair-sources-order.mjs) since this defect spans four
// different page types.
//
//   node scripts/repair-inline-sources.mjs           # dry run
//   node scripts/repair-inline-sources.mjs --apply
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { fixInlineSources } from './lib/backfill.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();
const { pages } = buildGraph(vault);

const fixed = [];
for (const p of pages) {
  const abs = join(vault, p.path);
  const text = readFileSync(abs, 'utf8');
  const out = fixInlineSources(text);
  if (out === text) continue;
  if (apply) writeFileSync(abs, out);
  fixed.push(p.path);
}

console.log(JSON.stringify({ type: 'repair-inline-sources', applied: apply, fixed: fixed.length }));
for (const p of fixed.slice(0, 15)) console.log(`  ${p}`);
if (fixed.length > 15) console.log(`  ... and ${fixed.length - 15} more`);
if (!apply) console.error('dry run — re-run with --apply to rewrite the frontmatter');
