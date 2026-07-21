// One-time migration: record each legacy wiki/sources page's clipping hashes in
// a `source-hashes:` frontmatter field, so the ingest-backlog metric can join on
// the content hash instead of a fuzzy wikilink. See
// docs/superpowers/specs/2026-07-21-hash-ingest-state-design.md §6.
//
// Dry-run by default (prints the plan); pass --apply to write. Idempotent and
// safe to re-run: only pages still missing source-hashes are touched, and
// ambiguous/unresolved citations are reported for review, never guessed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { planSourceHashBackfill, insertSourceHashes } from './lib/backfill.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();
const plan = planSourceHashBackfill(buildGraph(vault));

let written = 0;
for (const { path, hashes } of plan.pages) {
  if (apply) {
    const f = join(vault, path);
    writeFileSync(f, insertSourceHashes(readFileSync(f, 'utf8'), hashes));
  }
  written++;
}

console.log(
  JSON.stringify({
    type: 'backfill-source-hashes',
    applied: apply,
    written,
    ambiguous: plan.ambiguous.length,
    unresolved: plan.unresolved.length,
    nohash: plan.nohash.length,
  })
);
if (plan.ambiguous.length || plan.unresolved.length || plan.nohash.length) {
  console.log(
    JSON.stringify(
      { ambiguous: plan.ambiguous, unresolved: plan.unresolved, nohash: plan.nohash },
      null,
      2
    )
  );
}
if (!apply) console.error('dry run — re-run with --apply to write the frontmatter');
