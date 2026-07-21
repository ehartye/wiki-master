// A page quotes a clipping verbatim but declares no path to it, so the quote
// cannot be walked back to raw/ and reads as unverifiable. The repair is to
// record the source the page already rests on — never to alter the quote.
//
// Only quotes found VERBATIM in a clipping are repaired. A quote that matches
// nothing is left alone: it needs a human, and inventing provenance for it would
// be the exact failure guardrail #2 exists to prevent.
//
//   node scripts/repair-quote-provenance.mjs           # dry run
//   node scripts/repair-quote-provenance.mjs --apply
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, buildNameIndex, resolveLinkTarget, evidencePaths } from './lib/graph.mjs';
import { checkQuotes, normalize, quoteFragments } from './lint.mjs';
import { insertSources } from './lib/backfill.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();
const graph = buildGraph(vault);
const byName = buildNameIndex(graph.pages);
const pages = new Map(graph.pages.map((p) => [p.path, p]));

const body = (p) => readFileSync(join(vault, p), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
const clippings = graph.pages
  .filter((p) => p.path.startsWith('raw/') && p.path.endsWith('.md'))
  .map((p) => [p.path, normalize(body(p.path))]);

// Which wiki/sources page covers a clipping? Concepts cite source pages, not raw.
const coverOf = new Map();
for (const p of graph.pages) {
  if (!p.path.startsWith('wiki/sources/')) continue;
  for (const t of [...(p.fmTargets ?? []), ...(p.outTargets ?? [])]) {
    const target = resolveLinkTarget(byName, t);
    if (target?.startsWith('raw/') && !coverOf.has(target)) coverOf.set(target, p.path);
  }
}

// Attribution needs DISTINCTIVE text. quoteFragments splits a quote on bracketed
// insertions, so `"what comes after [[Some Page]]"` reduces to the fragment "what
// comes after" — which occurs in any prose and matched an unrelated textbook.
// Citing on that would fabricate provenance, the precise failure guardrail #2
// exists to prevent. Require one long verbatim run before believing a match.
const MIN_ANCHOR = 40;

const wanted = new Map(); // page -> Map(clipping -> link to record)
let unmatched = 0, tooGeneric = 0;
for (const f of checkQuotes(vault, graph)) {
  const frags = quoteFragments(f.quote).map((x) => normalize(x).replace(/^[.,;:!?\s]+|[.,;:!?\s]+$/g, ''));
  if (!frags.length) continue;
  if (!frags.some((fr) => fr.length >= MIN_ANCHOR)) { tooGeneric++; continue; }
  const hit = clippings.find(([, text]) => frags.every((fr) => text.includes(fr)));
  if (!hit) { unmatched++; continue; }
  const [clipPath] = hit;
  // Prefer the summary that covers the clipping; a source page cites raw directly.
  const cover = coverOf.get(clipPath);
  const link = (cover && cover !== f.page) ? cover : clipPath;
  if (link === f.page) continue;
  if (!wanted.has(f.page)) wanted.set(f.page, new Map());
  wanted.get(f.page).set(clipPath, link);
}

const changed = [];
for (const [page, byClip] of wanted) {
  const p = pages.get(page);
  // The test is whether the CLIPPING is reachable, not the link. A cover page
  // reachable only at the depth limit leaves its clipping one hop too far; citing
  // that same page directly shortens the path and brings the clipping into range.
  const reachable = new Set(evidencePaths(p, byName, pages));
  const missing = [...new Set([...byClip].filter(([clip]) => !reachable.has(clip)).map(([, link]) => link))];
  if (!missing.length) continue;
  const abs = join(vault, page);
  const text = readFileSync(abs, 'utf8');
  const out = insertSources(text, missing.map((m) => m.replace(/\.md$/i, '')));
  if (out === text) continue;
  if (apply) writeFileSync(abs, out);
  changed.push({ page, added: missing });
}

console.log(JSON.stringify({
  type: 'repair-quote-provenance', applied: apply, pages: changed.length,
  links: changed.reduce((a, c) => a + c.added.length, 0), unmatchedQuotes: unmatched, tooGeneric,
}));
for (const c of changed.slice(0, 15)) console.log(`  ${c.page}\n    + ${c.added.join('\n    + ')}`);
if (changed.length > 15) console.log(`  ... and ${changed.length - 15} more pages`);
console.log(`\n${unmatched} quotes matched no clipping and ${tooGeneric} carried no distinctive run — both left for human review, never auto-cited.`);
if (!apply) console.error('dry run — re-run with --apply to record provenance');
