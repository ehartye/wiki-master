// One-time repair for existing damage left by a since-fixed bug in
// `insertSourceHashes` (scripts/lib/backfill.mjs): when a page's `sources:` was
// written as a YAML block list (`sources:` bare, then `  - [[...]]` lines) rather
// than inline, `source-hashes:` was inserted between the bare key and its own
// list item — invalid YAML that a real parser rejects outright, and that
// Obsidian itself surfaces as "No frontmatter found" (every property on the
// page, not just `sources`, goes with it). wiki-master's own scripts tolerate it
// because they regex-scan the raw frontmatter text rather than parsing YAML, so
// no health/lint metric ever caught it. Confirmed on the live vault: 193 of 476
// wiki/sources pages, all single-citation.
//
// Pure string surgery (fixSourcesOrder), no YAML parsing: it only recognizes and
// reorders the exact defect shape, and is a no-op on anything else. Dry-run by
// default, `--apply` to write. Idempotent and safe to re-run.
//
//   node scripts/repair-sources-order.mjs           # dry run
//   node scripts/repair-sources-order.mjs --apply
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { fixSourcesOrder } from './lib/backfill.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();
const { pages } = buildGraph(vault);

const fixed = [];
for (const p of pages) {
  if (!p.path.startsWith('wiki/sources/')) continue;
  const abs = join(vault, p.path);
  const text = readFileSync(abs, 'utf8');
  const out = fixSourcesOrder(text);
  if (out === text) continue;
  if (apply) writeFileSync(abs, out);
  fixed.push(p.path);
}

console.log(JSON.stringify({ type: 'repair-sources-order', applied: apply, fixed: fixed.length }));
for (const p of fixed.slice(0, 15)) console.log(`  ${p}`);
if (fixed.length > 15) console.log(`  ... and ${fixed.length - 15} more`);
if (!apply) console.error('dry run — re-run with --apply to rewrite the frontmatter');
