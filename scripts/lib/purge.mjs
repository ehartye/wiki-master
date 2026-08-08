import { buildNameIndex, resolveLinkTarget, isContent } from './graph.mjs';

// ---- closure ----

// Pages that exist to point at other pages. index.md catalogs everything and a
// MOC's whole job is linking, so an inbound edge from one carries no evidence
// that the target belongs to a topic. They are excluded from the "is anything
// outside the set referencing this?" test — never from being purged, which a
// seed can still do explicitly.
// Mirrors graph.mjs's SYSTEM_FILES for the file-set part; if a fourth system
// file is ever added there, add it here too.
const STRUCTURAL_FILES = new Set(['index.md', 'log.md', 'vault-schema.md']);
// Deliberately NOT the same prefix set graph.mjs's isContent() excludes:
// raw/ is omitted because clippings are purge targets, not structure, and
// wiki/syntheses/ is omitted because — unlike graph.mjs's isRoot(), which
// groups syntheses with moc/ as link-hub roots — purge must treat a synthesis
// as ordinary content that can be the off-topic survivor of a closure.
const STRUCTURAL_PREFIXES = ['moc/', 'log/', '_templates/'];

export function isStructural(path) {
  return STRUCTURAL_FILES.has(path) || STRUCTURAL_PREFIXES.some((p) => path.startsWith(p));
}

// Any function that builds a name index (buildNameIndex is first-writer-wins on
// the plain key) must sort pages by path first, or array order decides which
// file a bare `sources: [[Foo]]` citation resolves to — and therefore which
// files get binned. readdirSync is alphabetical on NTFS but hash-ordered on
// ext4, so without this two machines compute different purge sets from the
// same vault, defeating the cross-machine convergence this feature exists for.
// Sorting puts raw/ before wiki/, so a bare provenance citation resolves to the
// clipping — which is what the vault's documented `sources: [[raw/clippings/X.md]]`
// convention means anyway.
export function sortedByPath(pages) {
  return [...pages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Inverts the graph: target path -> set of page paths linking to it. The two
// link channels resolve differently and mixing them up silently mis-attributes
// provenance edges — body wikilinks ask the navigation question (nav: true),
// `sources:` frontmatter asks the provenance question (nav: false). Same
// convention as graph.mjs's computeGraphMetrics().
export function inboundMap(pages, byName) {
  const inbound = new Map(pages.map((p) => [p.path, new Set()]));
  const add = (from, target, nav) => {
    const to = resolveLinkTarget(byName, target, { nav });
    if (to && to !== from && inbound.has(to)) inbound.get(to).add(from);
  };
  for (const p of pages) {
    for (const t of p.outTargets ?? []) add(p.path, t, true);
    for (const t of p.fmTargets ?? []) add(p.path, t, false);
  }
  return inbound;
}

// Grows a purge set from explicit seeds by repeatedly admitting any page whose
// every non-structural referent is already inside. Deliberately asymmetric:
// over-matching destroys work and is discovered late, under-matching leaves one
// page to delete by hand and is discovered immediately. So a page with ANY
// outside referent is never admitted — it becomes collateral instead.
//
// Returns { purge, collateral, blocking }, all sorted vault-relative paths.
//   purge      — move these
//   collateral — survive, but link into the set; their references need repair
//   blocking   — survive, but ALL their provenance is inside the set. Guardrail
//                #2 says a claim with no evidence is a defect, so purge stops
//                and asks rather than guessing.
// blocking ⊆ collateral by construction: a page whose every resolved fmTarget
// is in the set necessarily has a target in the set, so it always shows up in
// collateral too. Resolve blocking FIRST — Task 7's repair step acts on
// collateral, and repairing a page the user is about to purge (by resolving
// the blocking prompt) would be wasted or wrong work.
export function planPurge({ pages: inputPages, seedPaths }) {
  // Sorted before indexing, not for tidiness — see sortedByPath's comment.
  const pages = sortedByPath(inputPages);
  const byName = buildNameIndex(pages);
  const inbound = inboundMap(pages, byName);
  const known = new Set(pages.map((p) => p.path));
  const set = new Set(seedPaths.filter((p) => known.has(p)));

  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (set.has(p.path) || isStructural(p.path)) continue;
      // Filters by isStructural, not isContent — a deliberate departure from
      // computeGraphMetrics's source-side exclusion, which drops raw/ pages from
      // every graph metric at collection time "so no downstream check can forget it."
      // Here a raw clipping's wikilink DOES count as an outside referent: an edge
      // from immutable captured text is weak evidence, but ignoring it would purge
      // a page graph.mjs would have left alone — the over-match direction this
      // design refuses. 78 of the 1100 clippings in the live vault carry [[...]]
      // (mostly W3C internal-slot notation like [[length]]), so this is a real
      // condition, not a hypothetical.
      const refs = [...inbound.get(p.path)].filter((r) => !isStructural(r));
      // No referent at all is not evidence of topic membership — an orphan
      // unrelated to the topic would otherwise be swept in by vacuous truth. This
      // also catches pages referenced ONLY by structural pages (refs is already
      // structural-filtered above) — e.g. linked solely from index.md, which
      // links everything, so admitting that class would sweep in every
      // content-orphan in the vault. Do not narrow this to "refs is empty."
      if (refs.length === 0) continue;
      if (refs.every((r) => set.has(r))) {
        set.add(p.path);
        grew = true;
      }
    }
  }

  const targetsOf = (p) => [
    ...(p.outTargets ?? []).map((t) => resolveLinkTarget(byName, t, { nav: true })),
    ...(p.fmTargets ?? []).map((t) => resolveLinkTarget(byName, t, { nav: false })),
  ].filter(Boolean);

  // The collateral/blocking pool asks a DIFFERENT question from the refs filter
  // above ("does this page need reference repair?" vs "is this an outside
  // referent?"), so it uses a different predicate. isContent excludes index.md
  // (regenerated by index-gen.mjs, never repaired), log/ (an immutable audit
  // trail — you do not rewrite history), _templates/, and raw/ (guardrail #1:
  // raw bodies are immutable, so a dangling link there is never ours to fix).
  // It KEEPS moc/, which isStructural would have dropped — a MOC linking into
  // the purged set has real broken links, isContent('moc/x.md') is true so
  // health.mjs counts them, and nothing regenerates a MOC.
  const survivors = pages.filter((p) => !set.has(p.path) && isContent(p.path));

  const collateral = survivors
    .filter((p) => targetsOf(p).some((t) => set.has(t)))
    .map((p) => p.path)
    .sort();

  const blocking = survivors
    .filter((p) => {
      const evidence = (p.fmTargets ?? []).map((t) => resolveLinkTarget(byName, t, { nav: false })).filter(Boolean);
      return evidence.length > 0 && evidence.every((e) => set.has(e));
    })
    .map((p) => p.path)
    .sort();

  return { purge: [...set].sort(), collateral, blocking };
}

// ---- manifest ----

export const BIN_DIR = '.recycle';

// The dot segment comes first, always. See the test — three readers exclude the
// bin with anchored ^wiki/ filters, and only leading-dot placement satisfies
// them together with graph.mjs's readdir dot-skip.
export function binPathFor(id, originalPath) {
  return `${BIN_DIR}/${id}/${originalPath}`;
}

export function purgeId(topic, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const slug = String(topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${day}-${slug || 'purge'}`;
}

// Keyed by BOTH path and content hash: path finds a file that came back where it
// was, `source-hash` finds one that came back under a different name. Same join
// health.mjs --backlog already uses, so it inherits a contract already proven
// against filename drift.
export function buildManifest({ id, topic, date, purge, collateral, pages, hashes }) {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const entries = purge.map((from) => {
    const page = byPath.get(from) ?? {};
    const entry = {
      layer: from.startsWith('raw/') ? 'raw' : 'wiki',
      from,
      sha256: hashes[from],
    };
    if (page.sourceHash) entry['source-hash'] = page.sourceHash;
    if (page.url) entry.url = page.url;
    return entry;
  });
  return {
    id,
    topic,
    date,
    entries,
    declines: entries.map((e) => e.url).filter(Boolean),
    collateral,
  };
}
