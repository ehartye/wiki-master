// Stamp a `source-hash` onto raw clippings that predate the field. Without one a
// clipping cannot be hash-joined, so its summary can never record it and stays
// permanently at `backfillPending`. The hash is sha256 of the clipping's own
// markdown body — the same convention the clippers use.
//
//   node scripts/repair-missing-hash.mjs           # dry run
//   node scripts/repair-missing-hash.mjs --apply
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { insertSourceHash } from './lib/backfill.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();

const targets = buildGraph(vault).pages.filter(
  (p) => p.path.startsWith('raw/') && p.path.endsWith('.md') && !p.sourceHash
);

const stamped = [];
for (const p of targets) {
  const abs = join(vault, p.path);
  const text = readFileSync(abs, 'utf8');
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = m ? text.slice(m[0].length) : text;
  const hash = createHash('sha256').update(body).digest('hex');
  if (apply) writeFileSync(abs, insertSourceHash(text, hash));
  stamped.push({ clipping: p.path, hash: hash.slice(0, 12) });
}

console.log(JSON.stringify({ type: 'repair-missing-hash', applied: apply, stamped: stamped.length }));
if (stamped.length) console.log(JSON.stringify(stamped.slice(0, 20), null, 2));
if (!apply) console.error('dry run — re-run with --apply to stamp');
