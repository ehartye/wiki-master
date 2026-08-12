// A wikilink is inline Markdown/Obsidian syntax — a `[[...]]` span containing a raw
// newline (hard-wrapped prose whose paragraph reflow happened to straddle a link) can
// never resolve, and can never be a legitimate deferred forward-reference either. See
// scripts/lib/dewrap-links.mjs for the detection/repair logic and why an ordinary wrap
// is always safe to fix (a lossless whitespace-collapse, nothing invented) while a
// hyphen-adjacent wrap ("Diagno-\nstics" vs "Wizards-\n  Definition...") needs the real
// page index to pick the correct reading rather than guessing from shape alone.
//
// Only ever touches wiki/ content (isContent) — raw/ clippings are immutable inputs,
// never rewritten. A span resolveDewrap cannot pin to exactly one reading is left
// completely untouched and reported for manual review, mirroring
// repair-provenance-links.mjs's own discipline: never guess.
//
//   node scripts/repair-wrapped-links.mjs           # dry run
//   node scripts/repair-wrapped-links.mjs --apply
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, isContent, normalizeName } from './lib/graph.mjs';
import { dewrapText } from './lib/dewrap-links.mjs';

// Dry run by default (apply: false) — matches every other repair/generation script in
// this repo. Returns a structured summary either way, so a caller can inspect what
// WOULD happen without writing anything.
export function repairWrappedLinks(vaultPath, { apply = false } = {}) {
  const { pages } = buildGraph(vaultPath);
  const content = pages.filter((p) => isContent(p.path));

  const existingNames = new Set(content.map((p) => normalizeName(p.name)));
  const resolves = (name) => existingNames.has(normalizeName(name));

  let filesTouched = 0;
  let fixed = 0;
  const skipped = [];
  for (const p of content) {
    const abs = join(vaultPath, p.path);
    const text = readFileSync(abs, 'utf8');
    const r = dewrapText(text, { resolves });
    if (r.fixed > 0) {
      filesTouched += 1;
      fixed += r.fixed;
      if (apply) writeFileSync(abs, r.text);
    }
    for (const span of r.skippedSpans) skipped.push({ page: p.path, span });
  }
  return { filesTouched, fixed, skipped };
}

export function main() {
  const { path: vaultPath } = resolveVault();
  const apply = process.argv.includes('--apply');
  const { filesTouched, fixed, skipped } = repairWrappedLinks(vaultPath, { apply });

  console.log(JSON.stringify({ type: 'repair-wrapped-links', applied: apply, filesTouched, fixed, skipped: skipped.length }));
  if (skipped.length) {
    console.log('Skipped (ambiguous or unresolved against the real page index — left untouched, needs manual review):');
    for (const { page, span } of skipped.slice(0, 15)) console.log(`  ${page}\n    ${JSON.stringify(span)}`);
    if (skipped.length > 15) console.log(`  ... and ${skipped.length - 15} more`);
  }
  if (!apply) console.error('dry run — re-run with --apply to rewrite the links');
  return { filesTouched, fixed, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
