import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const STUB_WORD_FLOOR = 10;
export const HUB_MIN_BACKLINKS = 5;

// Structural/system files are not wiki content: they may link to everything
// (index.md) or nothing (templates) by design. The predicate is applied at
// COLLECTION time — excluded files contribute neither nodes nor edges to any
// metric — so no downstream check can forget it.
const SYSTEM_FILES = new Set(['index.md', 'log.md', 'vault-schema.md']);
export function isContent(path) {
  if (!path.endsWith('.md')) return false;
  if (SYSTEM_FILES.has(path)) return false;
  if (path.startsWith('_templates/')) return false;
  if (path.startsWith('raw/')) return false; // immutable sources: inputs, not scored
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
        pages.push({
          path: r,
          name: e.slice(0, -3).toLowerCase(),
          title: e.slice(0, -3),
          status,
          type,
          created,
          updated,
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
  const full = target.toLowerCase().replace(/\.md$/i, '');
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
  const citedBySourcePage = new Set();
  for (const p of pages) {
    if (!isSourcePage(p.path)) continue;
    for (const t of [...p.outTargets, ...(p.fmTargets ?? [])]) {
      const target = resolveLinkTarget(byName, t);
      if (target) citedBySourcePage.add(target);
    }
  }
  // The actionable backlog: these are the sources /wiki-ingest still owes a page.
  const unsummarizedSources = pages
    .filter((p) => p.path.startsWith('raw/') && !citedBySourcePage.has(p.path))
    .map((p) => p.path);

  // The other half of the contract: a source page that cites no raw file claims
  // an ingest happened while leaving its clipping indistinguishable from one
  // never processed. Scored as a defect — it breaks provenance, which is the
  // property every citation in the wiki rests on.
  const citesRaw = (p) =>
    [...p.outTargets, ...(p.fmTargets ?? [])].some((t) => {
      const target = resolveLinkTarget(byName, t);
      return target && target.startsWith('raw/');
    });

  const provenanceGaps = pages
    .filter((p) => isSourcePage(p.path) && !p.declaresNoSources && !citesRaw(p))
    .map((p) => p.path);

  // Declared, not silent: visible so a reader can audit the claim, but not
  // scored — the same treatment declaredStubs get. Penalizing a deliberate
  // disclosure would only teach authors to stop disclosing.
  const declaredNoProvenance = pages
    .filter((p) => isSourcePage(p.path) && p.declaresNoSources && !citesRaw(p))
    .map((p) => p.path);

  // Pages that declare themselves stubs. Informational, not scored: the
  // declaration is deliberate authoring state, but it must be visible —
  // a vault with six self-declared stubs must not read as pristine.
  const declaredStubs = content.filter((p) => p.status === 'stub').map((p) => p.path);

  const brokenClass = classifyBrokenLinks(brokenLinks, pages, opts);

  return { orphans, deadEnds, brokenLinks, hubStubs, unparsedSources, unsummarizedSources, provenanceGaps, declaredNoProvenance, declaredStubs, brokenClass };
}
