// Repair for TWO related `sources:` frontmatter defects — both look correct
// to the eye (Obsidian still renders every `[[...]]` as a clickable link) but
// are not valid YAML list syntax, and both cause `.obsidian/types.json`'s
// `sources` list registration to surface "type mismatch, expected list" in
// Obsidian's Properties panel. See fixInlineSources's and fixBlockSources's
// own comments in lib/backfill.mjs for exactly why each shape breaks:
//
// - Inline: `sources: [[A]]` or comma-joined `sources: [[A]], [[B]], [[C]]`.
//   Confirmed on the live vault: 283 (inline-unquoted) + 35 (quoted-scalar)
//   pages across wiki/sources, wiki/concepts, wiki/entities, wiki/syntheses.
// - Block list: `sources:\n  - [[A]]\n  - [[B]]` with UNQUOTED items. This
//   turned out to be the vault's actual DOMINANT shape — 508 pages, found
//   only once validation started checking each parsed item's actual type
//   (a plain "does yaml.safe_load throw" check, used the first time around,
//   does not catch this: the block parses "successfully" into a list of
//   lists instead of a list of strings).
//
// Pure string surgery (no YAML parsing in the fixers themselves): each
// recognizes and rewrites only its own exact shape, and is a no-op on
// anything else (including a genuinely valid `sources: []`, an
// already-correct quoted flow sequence, or an already-quoted block list).
// Dry-run by default, `--apply` to write. Idempotent and safe to re-run.
// Scans the WHOLE vault (not scoped to one subdirectory like
// repair-sources-order.mjs) since both defects span every page type.
//
//   node scripts/repair-inline-sources.mjs           # dry run
//   node scripts/repair-inline-sources.mjs --apply
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { fixInlineSources, fixBlockSources } from './lib/backfill.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();
const { pages } = buildGraph(vault);

const fixed = [];
for (const p of pages) {
  const abs = join(vault, p.path);
  const text = readFileSync(abs, 'utf8');
  const out = fixBlockSources(fixInlineSources(text));
  if (out === text) continue;
  if (apply) writeFileSync(abs, out);
  fixed.push(p.path);
}

console.log(JSON.stringify({ type: 'repair-inline-sources', applied: apply, fixed: fixed.length }));
for (const p of fixed.slice(0, 15)) console.log(`  ${p}`);
if (fixed.length > 15) console.log(`  ... and ${fixed.length - 15} more`);
if (!apply) console.error('dry run — re-run with --apply to rewrite the frontmatter');
