import { buildNameIndex, resolveLinkTarget } from './graph.mjs';
import { slugify } from '../clip.mjs';

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

// Plan the repair of citations that name a clipping's ORIGINAL TITLE rather than
// its filename. The clipper slugifies a title into a filename (`slugify`: `/`, `:`,
// `#`, `*`, `?`, quotes and brackets all become `-`, then a 120-char cap), but
// ingest wrote `sources: [[<remembered title>]]`. Every source whose title carried
// one of those characters, or ran long, therefore cited a file that never existed:
// the citation trail dead-ended at the one hop the whole vault rests on, and the
// clipping read as unparsed. On the live vault this was 11 source pages and 11
// clippings — all of them correctly ingested, all of them uncitable.
//
// The join is the CONTENT HASH, never the title — the title is precisely what
// drifted. `slugify` is only used to decide WHICH of a page's own clippings an
// unresolved target meant, and only among candidates the hash already vouched for.
// A target that cannot be pinned that way is reported, never guessed.
//
// Returns { repairs: [{page, from, to}], ambiguous, unresolved }. Pure over the
// graph; the CLI does the file I/O.
export function planCitationRepair({ pages }) {
  const byName = buildNameIndex(pages);
  const clipByHash = new Map();
  for (const p of pages) {
    if (p.path.startsWith('raw/') && p.path.endsWith('.md') && p.sourceHash) {
      if (!clipByHash.has(p.sourceHash)) clipByHash.set(p.sourceHash, p.path);
    }
  }

  const plan = { repairs: [], ambiguous: [], unresolved: [] };
  for (const p of pages) {
    const hashes = (p.sourceHashes ?? []).map((h) => String(h).toLowerCase());
    if (!hashes.length) continue;
    const targets = p.fmTargets ?? [];
    const broken = targets.filter((t) => !resolveLinkTarget(byName, t));
    if (!broken.length) continue;

    // Only clippings this page's hashes vouch for, minus the ones it already
    // cites correctly — those are spoken for and must not be re-used.
    const cited = new Set(targets.map((t) => resolveLinkTarget(byName, t)).filter(Boolean));
    const free = hashes.map((h) => clipByHash.get(h)).filter((c) => c && !cited.has(c));

    for (const from of broken) {
      const want = slugify(from).toLowerCase();
      const bySlug = free.filter((c) => deSuffix(bareName(c)) === want);
      // Derived match, or the unambiguous 1:1 case where there is nothing else it
      // could mean. Anything else needs a human.
      const to = bySlug.length === 1 ? bySlug[0]
        : (broken.length === 1 && free.length === 1 ? free[0] : undefined);
      if (!to) {
        (free.length ? plan.ambiguous : plan.unresolved).push({ page: p.path, target: from, candidates: free });
        continue;
      }
      plan.repairs.push({ page: p.path, from, to });
      free.splice(free.indexOf(to), 1);
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
// Record the source pages/clippings a page rests on, in its `sources:` frontmatter.
// Merges rather than replaces: a page can gain provenance for one claim while
// already declaring it for another, and dropping the existing list would break the
// trail it already had. Compares on the link's target, so an existing aliased
// form (`[[path|Display]]`) is never duplicated by its bare name.
export function insertSources(fileText, links) {
  const targets = links.map((l) => String(l).trim()).filter(Boolean);
  if (!targets.length) return fileText;
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText; // no frontmatter — nothing to anchor to
  let block = fm[2];
  const render = (ls) => `sources: [${ls.map((l) => `"[[${l}]]"`).join(', ')}]`;
  const key = (l) => l.split('|')[0].split('/').pop().replace(/\.md$/i, '').toLowerCase();

  const existing = block.match(/^sources:.*$/m);
  if (existing) {
    const have = [...existing[0].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
    const haveKeys = new Set(have.map(key));
    const add = targets.filter((t) => !haveKeys.has(key(t)));
    if (!add.length) return fileText;
    block = block.slice(0, existing.index) + render([...have, ...add]) + block.slice(existing.index + existing[0].length);
  } else {
    // Sit it just after `status:` where the schema puts it, or last if absent.
    const anchor = block.match(/^status:.*$/m);
    const line = render(targets);
    block = anchor
      ? block.slice(0, anchor.index + anchor[0].length) + '\n' + line + block.slice(anchor.index + anchor[0].length)
      : `${block}\n${line}`;
  }
  return fm[1] + block + fm[3] + fileText.slice(fm[0].length);
}

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
  // `sources:` is written either inline (`sources: [[X]]`, matched whole by
  // `.*` on its own line) or as a YAML block list (`sources:` bare, then
  // `  - [[X]]` continuation lines). `/^sources:.*$/m` only ever matched the
  // FIRST line, so on a block list it landed `source-hashes:` between the bare
  // key and its own list items — invalid YAML that takes the whole frontmatter
  // block down with it, not just `sources`. Walk past every continuation line
  // before inserting.
  const bare = block.match(/^sources:[ \t]*$/m);
  let idx;
  if (bare) {
    idx = bare.index + bare[0].length;
    const items = block.slice(idx).match(/^(\r?\n[ \t]*-.*)*/);
    if (items) idx += items[0].length;
  } else {
    const inline = block.match(/^sources:.*$/m);
    idx = inline ? inline.index + inline[0].length : null;
  }
  if (idx != null) {
    block = block.slice(0, idx) + '\n' + list + block.slice(idx);
  } else {
    block = `${block}\n${list}`;
  }
  return fm[1] + block + fm[3] + fileText.slice(fm[0].length);
}

// Repairs EXISTING damage from the bug `insertSourceHashes` used to have: a bare
// `sources:` key with `source-hashes:` wedged before its own list item(s) instead
// of after — invalid YAML (a real parser rejects it outright), which is why
// Obsidian reports "No frontmatter found" on an affected page rather than just
// missing `sources`. Pure string surgery, no YAML parsing, so it can't reformat
// anything it doesn't specifically recognize; anything else is returned as-is.
export function fixSourcesOrder(fileText) {
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText;
  const defect = fm[2].match(/^sources:[ \t]*\r?\n(source-hashes:.*)\r?\n((?:[ \t]*-.*\r?\n?)+)/m);
  if (!defect) return fileText;
  const [whole, hashLine, items] = defect;
  const fixed = `sources:\n${items.replace(/\r?\n?$/, '\n')}${hashLine}\n`;
  const block = fm[2].slice(0, defect.index) + fixed + fm[2].slice(defect.index + whole.length);
  return fm[1] + block + fm[3] + fileText.slice(fm[0].length);
}

// A `sources:` line written inline as `sources: [[A]]` or comma-joined as
// `sources: [[A]], [[B]], [[C]]` looks correct to the eye (Obsidian still
// renders each `[[...]]` as a clickable link) but is not valid YAML list
// syntax: `[[A]]` is one bracket pair too many — a flow sequence containing a
// flow sequence containing the string "A" — and multiple comma-joined bracket
// pairs on one line do not parse as one legal flow value at all (nothing
// encloses the whole thing). `.obsidian/types.json` registers `sources` as a
// list (`multitext`) vault-wide, so every page carrying this shape surfaces
// "type mismatch, expected list" in Obsidian's Properties panel — confirmed
// live on 283 pages across wiki/sources, wiki/concepts, wiki/entities, and
// wiki/syntheses. Rewrites into the SAME quoted flow-sequence shape
// `insertSources` (above) already emits for this exact field — `sources:
// ["[[A]]", "[[B]]"]` — rather than an unquoted block list: an unquoted
// `- [[link]]` block-list item is itself flow-parsed by YAML (same
// double-bracket ambiguity one level down), which breaks outright on any link
// text containing a YAML-significant bare character (`?` is the one this
// vault's own link titles hit — e.g. "...Why Should You Care?..."). Quoting
// makes every item an unambiguous plain string regardless of its content.
// Pure string surgery, same discipline as fixSourcesOrder: it only recognizes
// this exact inline shape; `sources: []` (a genuinely valid empty list) and
// an already-correct block or flow list are both left untouched.
export function fixInlineSources(fileText) {
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText;
  // The trailing terminator is `\r?\n` when another frontmatter field follows
  // `sources:`, or an empty end-of-string match when `sources:` is the LAST
  // field — in that case fm[3]'s own leading `\r?\n` (captured as part of the
  // closing `---` fence) already supplies the newline, so `sep` must stay ''
  // rather than add a second one and leave a blank line before the fence.
  const unquoted = fm[2].match(/^sources:[ \t]*((?:\[\[[^\]]+\]\][ \t]*,?[ \t]*)+)(\r?\n|$)/m);
  // Second, distinct shape: a single QUOTED-STRING scalar (`sources: "[[X]]"`)
  // — a valid scalar, but a scalar, not a list. Tried only when the unquoted
  // shape above did not match, so the two never fight over the same line.
  const quotedScalar = !unquoted
    && fm[2].match(/^sources:[ \t]*"(\[\[[^\]]+\]\])"[ \t]*(\r?\n|$)/m);
  const defect = unquoted || quotedScalar;
  if (!defect) return fileText;
  const links = [...defect[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
  if (!links.length) return fileText;
  const sep = defect[2];
  const fixed = `sources: [${links.map((l) => `"[[${l}]]"`).join(', ')}]${sep}`;
  const block = fm[2].slice(0, defect.index) + fixed + fm[2].slice(defect.index + defect[0].length);
  return fm[1] + block + fm[3] + fileText.slice(fm[0].length);
}
