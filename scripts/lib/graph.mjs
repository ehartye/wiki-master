import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const STUB_WORD_FLOOR = 10;
export const HUB_MIN_BACKLINKS = 5;

// Structural/system files are not wiki content: they may link to everything
// (index.md) or nothing (templates) by design. The predicate is applied at
// COLLECTION time — excluded files contribute neither nodes nor edges to any
// metric — so no downstream check can forget it.
const SYSTEM_FILES = new Set(['index.md', 'log.md', 'vault-schema.md']);
// The evidence trail: a page's provenance is BOTH channels — frontmatter
// `sources:` and body wikilinks pointing at source pages or raw/ — followed
// transitively (concept → source page → clipping). Body links to other concepts
// are NOT evidence: a trail must lead toward raw/, not sideways into other
// unverified pages.
export function isEvidencePath(path) {
  return path.startsWith('raw/') || path.startsWith('wiki/sources/');
}

const MAX_EVIDENCE_DEPTH = 3;

// BREADTH-first, so every page is reached by its SHORTEST route. Depth-first
// with one shared `seen` set loses evidence: a source page reached late down a
// long chain gets marked seen at the depth limit, and the direct citation of
// that same page — one hop from its own clipping — then bails on `seen` and is
// never expanded. Order of a page's links must not decide what counts as
// evidence.
export function evidencePaths(page, byName, pages) {
  const seen = new Set([page.path]);
  const found = [];
  let frontier = [{ p: page, depth: 0, viaEvidence: false }];
  while (frontier.length) {
    const next = [];
    for (const { p, depth, viaEvidence } of frontier) {
      if (p.path !== page.path && (viaEvidence || isEvidencePath(p.path))) found.push(p.path);
      if (depth >= MAX_EVIDENCE_DEPTH) continue;
      for (const t of [...(p.fmTargets ?? []), ...(p.outTargets ?? [])]) {
        const target = pages.get(resolveLinkTarget(byName, t));
        if (!target || seen.has(target.path)) continue;
        // From the page itself: only step toward evidence. From evidence pages:
        // keep following their provenance (source page → its raw clippings).
        if (depth === 0 && !isEvidencePath(target.path)) continue;
        seen.add(target.path);
        next.push({ p: target, depth: depth + 1, viaEvidence: isEvidencePath(target.path) });
      }
    }
    frontier = next;
  }
  return found;
}

export function isContent(path) {
  if (!path.endsWith('.md')) return false;
  if (SYSTEM_FILES.has(path)) return false;
  if (path.startsWith('_templates/')) return false;
  if (path.startsWith('raw/')) return false; // immutable sources: inputs, not scored
  if (path.startsWith('log/')) return false; // one file per operation: the audit
  // trail (browsed via log.base), never a wikilink-graph node. This is the same
  // exclusion log.md already carries above — the per-op folder replaced it.
  return true;
}

export function isStub({ status, words }) {
  return status === 'stub' || (words ?? 0) < STUB_WORD_FLOOR;
}

function splitFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: '', body: md };
  return { fm: m[1], body: md.slice(m[0].length) };
}

// Two link channels with different semantics:
//  - body wikilinks are NAVIGATION: they drive orphan/dead-end metrics.
//  - frontmatter wikilinks (sources:) are PROVENANCE: they count as citation
//    (a cited raw file is "parsed") and a broken one is a real defect, but
//    they never hide a dead-end — a reader cannot navigate via frontmatter.
function wikilinks(text) {
  const out = [];
  for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

// Parse a `source-hashes:` frontmatter list — YAML flow (`["h1","h2"]`) or block
// sequence (`\n  - h1\n  - h2`). Hashes are hex; the guard keeps stray prose out.
function hashList(fm) {
  const flow = fm.match(/^source-hashes:\s*\[([^\]]*)\]/m);
  const src = flow ? flow[1] : fm.match(/^source-hashes:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/m)?.[1];
  if (!src) return undefined;
  const out = [...src.matchAll(/([0-9a-fA-F]{6,64})/g)].map((m) => m[1].toLowerCase());
  return out.length ? out : undefined;
}

export function buildGraph(vaultPath) {
  const pages = [];
  (function walk(dir, rel) {
    for (const e of readdirSync(dir)) {
      if (e.startsWith('.')) continue;
      const abs = join(dir, e);
      const r = rel ? `${rel}/${e}` : e;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else if (e.endsWith('.md')) {
        const { fm, body } = splitFrontmatter(readFileSync(abs, 'utf8'));
        const status = fm.match(/^status:\s*"?([\w-]+)"?/m)?.[1];
        const type = fm.match(/^type:\s*"?([\w-]+)"?/m)?.[1];
        const created = fm.match(/^created:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1];
        const updated = fm.match(/^updated:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1];
        // Ingest-state key: the clipping carries `source-hash`; a summary page
        // carries `source-hashes` listing the clippings it covers. See
        // docs/superpowers/specs/2026-07-21-hash-ingest-state-design.md.
        const sourceHash = fm.match(/^source-hash:\s*"?([0-9a-fA-F]{6,64})"?/m)?.[1]?.toLowerCase();
        const sourceHashes = hashList(fm);
        pages.push({
          path: r,
          name: e.slice(0, -3).toLowerCase(),
          title: e.slice(0, -3),
          status,
          type,
          created,
          updated,
          sourceHash,
          sourceHashes,
          words: (body.match(/\S+/g) || []).length,
          outTargets: wikilinks(body),
          fmTargets: wikilinks(fm),
          // `sources: []` is a DISCLOSURE — an internally-derived page (an
          // experiment readout, an analysis) stating it has no external
          // artifact. Omitting the key entirely discloses nothing. Those are
          // different states and must not collapse into one verdict.
          declaresNoSources: /^sources:\s*\[\s*\]\s*$/m.test(fm),
        });
      } else {
        // Non-markdown files are Obsidian attachments (PDFs, docx, images, …).
        // They emit no links and are never scored as content, but they ARE
        // valid link targets: `[[paper.pdf]]` provenance resolves to the file,
        // exactly as Obsidian resolves it. The link name keeps the extension.
        pages.push({
          path: r,
          name: e.toLowerCase(),
          title: e,
          type: 'attachment',
          words: 0,
          outTargets: [],
          fmTargets: [],
        });
      }
    }
  })(vaultPath, '');
  return { pages };
}

function normalizeName(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

// Bounded Levenshtein: returns >2 early when lengths differ by >2 (typos are near).
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

// A broken wikilink is not one thing. Split the flat list into three classes so
// the score can penalize real problems and credit intentional deferral:
//   - defect:   near-match to an existing page — a typo, casing, or un-propagated
//               rename that should be retargeted. (Exact case-only misses already
//               RESOLVE via byName, so these are edit-distance ≤ 2 variants.)
//   - stale:    a forward-link on an OLD page (source updated > staleDays ago) to a
//               LOW-demand target (referenced < demandThreshold) that was never
//               written — abandoned intent worth pruning or promoting.
//   - deferred: everything else — a fresh, or corroborated (≥ demandThreshold),
//               forward-link to a not-yet-written concept. Healthy by design;
//               `/wiki-relink` materializes these on demand, not eagerly.
// Age uses the linking page's `updated`/`created` frontmatter; pass `now` (a Date)
// for determinism. Without `now`, nothing can be proven stale (all → deferred).
export function classifyBrokenLinks(brokenLinks, pages, { now = null, staleDays = 90, demandThreshold = 3 } = {}) {
  const existing = new Map();
  for (const p of pages) {
    if (!isContent(p.path)) continue;
    const nn = normalizeName(p.name);
    if (!existing.has(nn)) existing.set(nn, p.title ?? p.name);
  }
  const demand = new Map();
  for (const b of brokenLinks) demand.set(b.target, (demand.get(b.target) || 0) + 1);
  const dateOf = new Map();
  for (const p of pages) dateOf.set(p.path, p.updated || p.created || null);

  const defects = [], stale = [], deferred = [];
  for (const b of brokenLinks) {
    const nt = normalizeName(b.target);
    let suggest = existing.get(nt) && existing.get(nt) !== b.target ? existing.get(nt) : null;
    if (!suggest) {
      for (const [en, real] of existing) {
        if (Math.abs(en.length - nt.length) <= 2 && editDistance(nt, en) <= 2) { suggest = real; break; }
      }
    }
    if (suggest) { defects.push({ ...b, suggest }); continue; }

    const refs = demand.get(b.target) || 1;
    const d = dateOf.get(b.source);
    const ageDays = now && d ? Math.floor((now - new Date(d)) / 86400000) : null;
    if (ageDays !== null && ageDays > staleDays && refs < demandThreshold) {
      stale.push({ ...b, refs, ageDays });
    } else {
      deferred.push({ ...b, refs, ageDays });
    }
  }
  return { defects, stale, deferred };
}

// The index resolveLinkTarget() resolves against: every page registers BOTH
// its bare basename ("csx") and its full, directory-qualified,
// extension-stripped path ("wiki/sources/csx"), both lowercased. This
// matters because this vault has real, unavoidable basename collisions — a
// wiki/sources/ summary page and its raw/clippings/ source frequently share
// the exact same filename (the vault's own long-standing naming pattern) —
// and a bare-name-only index cannot tell them apart: whichever page the
// filesystem walk visits first silently wins, and every OTHER page sharing
// that basename becomes permanently unreachable by name, however it is
// linked. Measured against the live vault this was not a corner case: all
// 117 wiki/* pages sharing a basename with a raw/clippings/ file were
// unreachable this way, and every single one read as a false orphan. But a
// link that names a directory ("[[wiki/sources/CSX]]") is NOT ambiguous —
// Obsidian resolves a path-qualified link to that exact file — so
// registering the full path as its own key lets resolveLinkTarget check for
// an unambiguous exact match before ever falling back to the bare-basename
// map, which remains exactly as ambiguous as before for links that truly
// don't qualify a directory.
export function buildNameIndex(pages) {
  const byName = new Map();
  for (const p of pages) {
    if (!byName.has(p.name)) byName.set(p.name, p.path);
    const fullKey = p.path.replace(/\.md$/i, '').toLowerCase();
    if (!byName.has(fullKey)) byName.set(fullKey, p.path);
  }
  return byName;
}

// A wikilink target may be written as a bare basename ("Foo"), a
// vault-relative path ("wiki/sources/Foo"), or a raw-file path with
// extension ("raw/clippings/Foo.md") — this vault's own documented citation
// convention (`sources: [[raw/clippings/X.md]]`) uses the last form
// throughout, and Obsidian itself resolves all three, preferring an exact
// path match when one is given and falling back to basename matching only
// for a truly unqualified link. byName (built by buildNameIndex) carries
// both kinds of key, so checking the full (extension-stripped) target first
// picks the exact, unambiguous match; only an unqualified bare name falls
// through to the collision-prone basename fallback.
export function resolveLinkTarget(byName, target) {
  // A link whose name itself ends in .md: the `agents.md` convention files the
  // note as "X.md.md", so its page name (one .md stripped) is "X.md" — and
  // [[X.md]] must land there, exactly as Obsidian resolves it. Check the
  // un-stripped target first; stripping .md below would turn "X.md" into "X"
  // and miss the page. Harmless for every other target (a bare name or a
  // path-qualified key never carries a trailing .md in the index).
  const lower = target.toLowerCase();
  if (byName.has(lower)) return byName.get(lower);
  const full = lower.replace(/\.md$/i, '');
  if (byName.has(full)) return byName.get(full);
  const bare = full.split('/').pop() || full;
  return byName.get(bare);
}

export function computeGraphMetrics({ pages }, opts = {}) {
  const byName = buildNameIndex(pages);

  const inbound = new Map(pages.map((p) => [p.path, 0]));
  const brokenLinks = [];
  const seenBroken = new Set();
  for (const p of pages) {
    if (!isContent(p.path)) continue; // source-side exclusion, applied once
    for (const t of [...p.outTargets, ...(p.fmTargets ?? [])]) {
      const target = resolveLinkTarget(byName, t);
      if (target) inbound.set(target, inbound.get(target) + 1);
      else {
        const key = `${p.path} ${t}`;
        if (!seenBroken.has(key)) {
          seenBroken.add(key);
          brokenLinks.push({ source: p.path, target: t });
        }
      }
    }
  }

  const content = pages.filter((p) => isContent(p.path));
  // Root pages (syntheses, MOCs) are cluster entry points: linked from
  // index.md and linking downward is their natural, healthy state. They are
  // never orphan candidates, but participate in every other metric.
  const isRoot = (path) => path.startsWith('wiki/syntheses/') || path.startsWith('moc/');
  const orphans = content
    .filter((p) => !isRoot(p.path) && inbound.get(p.path) === 0)
    .map((p) => p.path);
  const deadEnds = content
    .filter((p) => !p.outTargets.some((t) => resolveLinkTarget(byName, t)))
    .map((p) => p.path);
  const hubStubs = content
    .filter((p) => inbound.get(p.path) >= HUB_MIN_BACKLINKS && isStub(p))
    .map((p) => p.path);
  // Two DIFFERENT binary facts about a raw source. Collapsing them into one
  // number is what made "has this been ingested?" feel unanswerable:
  //
  //   unparsed      — nothing in the wiki cites it at all. Completely untouched.
  //   unsummarized  — no wiki/sources page cites it, so no summary exists.
  //
  // A source can be cited by a concept's provenance frontmatter (deliberate, and
  // it counts as a citation) while never having been summarized. That source is
  // parsed but NOT ingested, and it still needs work. Reporting only the first
  // number hid exactly that case.
  const unparsedSources = pages
    .filter((p) => p.path.startsWith('raw/') && inbound.get(p.path) === 0)
    .map((p) => p.path);

  const isSourcePage = (path) => path.startsWith('wiki/sources/');
  const pageByPath = new Map(pages.map((p) => [p.path, p]));

  // A source page that cites no raw file claims an ingest happened while leaving
  // its clipping indistinguishable from one never processed. Scored as a defect —
  // it breaks provenance, which is the property every citation in the wiki rests on.
  const citesRaw = (p) =>
    [...p.outTargets, ...(p.fmTargets ?? [])].some((t) => {
      const target = resolveLinkTarget(byName, t);
      return target && target.startsWith('raw/');
    });

  // ── Ingest backlog: a content-hash join, not link resolution ────────────────
  // A raw clipping is ingested iff its `source-hash` is recorded in some
  // wiki/sources page's `source-hashes`. Hash equality is immune to the
  // `-<hash7>` filename suffix and to citation-format drift — the two failures
  // that made link-resolution manufacture 172 phantom backlog items (~0 real).
  // Only `.md` clippings are ingestable units: the pipeline summarizes a
  // clipping's markdown, never the binary original, so a raw `.pdf`/`.xlsx`/`.zip`
  // can never be a summary target and is excluded from the backlog entirely.
  const ingestedHashes = new Set();
  for (const p of pages) {
    if (!isSourcePage(p.path)) continue;
    for (const h of p.sourceHashes ?? []) ingestedHashes.add(h);
  }
  // Transitional fallback (remove once backfillPending hits 0 — see
  // docs/superpowers/specs/2026-07-21-hash-ingest-state-design.md §6.1): a source
  // page that predates `source-hashes` still credits its clipping via the old
  // link-resolution path, so migration never regresses a real ingest. A MIGRATED
  // page (one that already carries `source-hashes`) is trusted by hash alone — so
  // a stale wikilink on it no longer masks a re-clip, and re-ingest-on-change
  // begins working the moment a page is backfilled.
  const legacyCited = new Set();
  for (const p of pages) {
    if (!isSourcePage(p.path) || p.sourceHashes?.length) continue;
    for (const t of [...p.outTargets, ...(p.fmTargets ?? [])]) {
      const target = resolveLinkTarget(byName, t);
      if (target) legacyCited.add(target);
    }
  }
  const clippings = pages.filter((p) => p.path.startsWith('raw/') && p.path.endsWith('.md'));
  // A clipping with no `source-hash` cannot be hash-joined — a data defect
  // surfaced for repair, not itself a verdict about ingestion.
  const missingHash = clippings.filter((p) => !p.sourceHash).map((p) => p.path);
  const unsummarizedSources = clippings
    .filter((p) => !(p.sourceHash && ingestedHashes.has(p.sourceHash)) && !legacyCited.has(p.path))
    .map((p) => p.path);
  // Migration progress: source pages that cite a raw clipping but have not yet
  // recorded its hash. The backfill targets exactly this set; it reaches 0 when
  // the vault is fully migrated and the fallback above can be deleted.
  const backfillPending = pages.filter(
    (p) => isSourcePage(p.path) && !(p.sourceHashes?.length) && citesRaw(p)
  ).length;

  const provenanceGaps = pages
    .filter((p) => isSourcePage(p.path) && !p.declaresNoSources && !citesRaw(p))
    .map((p) => p.path);

  // Everything OUTSIDE wiki/sources/ went unaudited for provenance: a concept
  // resting on nothing at all still scored a clean 100, because provenanceGaps
  // was gated on isSourcePage. This closes that, and measures the property that
  // actually matters for finding things — can the page be walked back to raw/ —
  // rather than whether a particular field is filled in. Frontmatter `sources:`
  // and body wikilinks are one and the same edge in Obsidian's link graph, so
  // requiring a specific channel would enforce house style, not provenance.
  //
  // Source pages keep the stricter direct-citation rule above: a summary must
  // cite its OWN clipping, not borrow reachability from a neighbour it links.
  // moc/ is exempt by the vault contract — Maps of Content are navigational
  // hubs that route to pages carrying provenance.
  const needsTrail = (p) =>
    p.path.startsWith('wiki/') && !isSourcePage(p.path) && !p.declaresNoSources;
  const reachesRaw = (p) => evidencePaths(p, byName, pageByPath).some((x) => x.startsWith('raw/'));
  const unreachableProvenance = pages.filter((p) => needsTrail(p) && !reachesRaw(p)).map((p) => p.path);

  // Declared, not silent: visible so a reader can audit the claim, but not
  // scored — the same treatment declaredStubs get. Penalizing a deliberate
  // disclosure would only teach authors to stop disclosing.
  const declaredNoProvenance = pages
    .filter((p) => p.declaresNoSources && isContent(p.path) &&
      (isSourcePage(p.path) ? !citesRaw(p) : !reachesRaw(p)))
    .map((p) => p.path);

  // Pages that declare themselves stubs. Informational, not scored: the
  // declaration is deliberate authoring state, but it must be visible —
  // a vault with six self-declared stubs must not read as pristine.
  const declaredStubs = content.filter((p) => p.status === 'stub').map((p) => p.path);

  const brokenClass = classifyBrokenLinks(brokenLinks, pages, opts);

  return { orphans, deadEnds, brokenLinks, hubStubs, unparsedSources, unsummarizedSources, missingHash, backfillPending, provenanceGaps, unreachableProvenance, declaredNoProvenance, declaredStubs, brokenClass };
}
