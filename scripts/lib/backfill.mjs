import { buildNameIndex, resolveLinkTarget } from './graph.mjs';

// Clipping filenames carry a `-<hash7>` disambiguator (optionally `-<hash7>-<n>`
// for a same-title re-clip). A legacy citation names the bare title, so matching
// requires stripping that suffix from the clipping's own name.
const deSuffix = (name) => name.replace(/-[0-9a-f]{7}(-\d+)?$/i, '');
const bareName = (target) => {
  const noExt = target.toLowerCase().replace(/\.md$/i, '');
  return noExt.split('/').pop() || noExt;
};

// Plan the one-time backfill of `source-hashes` onto legacy source pages.
// Returns { pages: [{path, hashes}], ambiguous, unresolved, nohash }. Pure over
// the graph so it is unit-testable; the CLI does the file I/O. Ambiguous or
// unresolved citations are logged for human review, never guessed (a wrong hash
// would silently mis-attribute provenance — the property the whole vault rests on).
export function planSourceHashBackfill({ pages }) {
  const byName = buildNameIndex(pages);
  const clipByPath = new Map();
  const byTitle = new Map(); // de-suffixed clipping name -> [paths]
  for (const p of pages) {
    if (!(p.path.startsWith('raw/') && p.path.endsWith('.md'))) continue;
    clipByPath.set(p.path, p);
    const key = deSuffix(p.name);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(p.path);
  }

  const resolveClip = (target) => {
    // Exact / path-qualified / extension-qualified first — the unambiguous forms.
    const t = resolveLinkTarget(byName, target);
    if (t && t.startsWith('raw/') && t.endsWith('.md')) return { path: t };
    // Otherwise fall back to a de-suffixed bare-title match.
    const cands = byTitle.get(bareName(target));
    if (!cands?.length) return { unresolved: true };
    if (cands.length > 1) return { ambiguous: cands };
    return { path: cands[0] };
  };

  const plan = { pages: [], ambiguous: [], unresolved: [], nohash: [] };
  for (const p of pages) {
    if (!p.path.startsWith('wiki/sources/')) continue;
    if (p.sourceHashes?.length) continue; // already migrated
    const hashes = new Set();
    for (const target of p.fmTargets ?? []) {
      const r = resolveClip(target);
      if (r.ambiguous) { plan.ambiguous.push({ page: p.path, target, candidates: r.ambiguous }); continue; }
      if (r.unresolved) { plan.unresolved.push({ page: p.path, target }); continue; }
      const clip = clipByPath.get(r.path);
      if (!clip?.sourceHash) { plan.nohash.push({ page: p.path, target, clip: r.path }); continue; }
      hashes.add(clip.sourceHash);
    }
    if (hashes.size) plan.pages.push({ path: p.path, hashes: [...hashes] });
  }
  return plan;
}

// Insert a `source-hashes: [...]` line into a page's frontmatter, after the
// `sources:` line when present (else at the end of the block). Idempotent: a page
// that already declares source-hashes is returned unchanged.
export function insertSourceHashes(fileText, hashes) {
  const list = `source-hashes: [${hashes.map((h) => `"${h}"`).join(', ')}]`;
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText; // no frontmatter — nothing to anchor to
  let block = fm[2];
  if (/^source-hashes:/m.test(block)) return fileText;
  const s = block.match(/^sources:.*$/m);
  if (s) {
    const idx = s.index + s[0].length;
    block = block.slice(0, idx) + '\n' + list + block.slice(idx);
  } else {
    block = `${block}\n${list}`;
  }
  return fm[1] + block + fm[3] + fileText.slice(fm[0].length);
}
