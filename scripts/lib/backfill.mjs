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
    // Not just unmigrated pages: a page repointed at a newly-clipped source has a
    // source-hashes line that omits the new hash, orphaning that clipping. Plan
    // whatever a page's citations resolve to but it has not recorded.
    const have = new Set((p.sourceHashes ?? []).map((h) => String(h).toLowerCase()));
    const hashes = new Set();
    const issues = { ambiguous: [], unresolved: [], nohash: [] };
    for (const target of p.fmTargets ?? []) {
      const r = resolveClip(target);
      if (r.ambiguous) { issues.ambiguous.push({ page: p.path, target, candidates: r.ambiguous }); continue; }
      if (r.unresolved) { issues.unresolved.push({ page: p.path, target }); continue; }
      const clip = clipByPath.get(r.path);
      if (!clip?.sourceHash) { issues.nohash.push({ page: p.path, target, clip: r.path }); continue; }
      if (!have.has(clip.sourceHash)) hashes.add(clip.sourceHash);
    }
    if (hashes.size) plan.pages.push({ path: p.path, hashes: [...hashes] });
    // Only surface citation problems for pages still owing something — a fully
    // recorded page re-reporting its binary citations every run is just noise.
    if (hashes.size || !have.size) {
      for (const k of ['ambiguous', 'unresolved', 'nohash']) plan[k].push(...issues[k]);
    }
  }
  return plan;
}

// Stamp a `source-hash:` onto a clipping that predates the field, so it can be
// hash-joined. No-op if one is already present. Note `source-hashes:` (plural, on
// summary pages) is a different key and must not satisfy this check.
export function insertSourceHash(fileText, hash) {
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText;
  if (/^source-hash:/m.test(fm[2])) return fileText;
  return fm[1] + `${fm[2]}\nsource-hash: ${String(hash).toLowerCase()}` + fm[3] + fileText.slice(fm[0].length);
}

// Insert a `source-hashes: [...]` line into a page's frontmatter, after the
// `sources:` line when present (else at the end of the block). Idempotent: a page
// that already declares source-hashes is returned unchanged.
export function insertSourceHashes(fileText, hashes) {
  const want = hashes.map((h) => String(h).toLowerCase());
  const render = (hs) => `source-hashes: [${hs.map((h) => `"${h}"`).join(', ')}]`;
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText; // no frontmatter — nothing to anchor to
  let block = fm[2];
  const rebuild = () => fm[1] + block + fm[3] + fileText.slice(fm[0].length);

  // A page can gain a source later (a binary citation replaced by a fresh clipping).
  // Merge into the existing list rather than skipping the write — skipping orphaned
  // the new clipping, which then reappeared as ingest backlog. Still one line.
  const existing = block.match(/^source-hashes:.*$/m);
  if (existing) {
    const have = [...existing[0].matchAll(/([0-9a-fA-F]{6,64})/g)].map((m) => m[1].toLowerCase());
    const merged = [...new Set([...have, ...want])];
    if (merged.length === have.length) return fileText; // nothing new to record
    block = block.slice(0, existing.index) + render(merged) + block.slice(existing.index + existing[0].length);
    return rebuild();
  }

  const list = render(want);
  const s = block.match(/^sources:.*$/m);
  if (s) {
    const idx = s.index + s[0].length;
    block = block.slice(0, idx) + '\n' + list + block.slice(idx);
  } else {
    block = `${block}\n${list}`;
  }
  return fm[1] + block + fm[3] + fileText.slice(fm[0].length);
}
