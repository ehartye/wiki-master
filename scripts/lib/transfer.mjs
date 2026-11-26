import { createHash } from 'node:crypto';
import { buildNameIndex, resolveLinkTarget, isContent } from './graph.mjs';
import { sortedByPath, inboundMap, isStructural } from './purge.mjs';
import { clippingHash } from './clipping-hash.mjs';
import { prose } from './prose.mjs';

// Planning for a copy or move of wiki content from one registered vault to another (scripts/transfer.mjs).
// Everything here is a pure function of the two vaults' page records and file bytes, so the plan an owner
// reviews and the plan an apply recomputes are the same computation, and its digest binds one to the other.
//
// The selection is explicit and bounded:
//   seed      — the pages named (paths, or every page under a folder).
//   linked    — pages a selected page links to or cites, up to `depth` hops from a seed (default 1).
//   cited     — `wiki/sources/` pages named in a selected page's `sources:`, followed until raw, at any depth:
//               a destination page's provenance must resolve inside the destination.
//   evidence  — raw files (clippings, attachments, figure renders) a selected page links to or cites.
// Nothing outside that is pulled in. Raw pages never extend the selection through their body links (a
// clipping's own `[[...]]` is captured text, often notation), only to the raw attachments they embed and the
// figure sidecars their `figures:` field lists.

export const PLAN_VERSION = 1;
export const DEFAULT_DEPTH = 1;
export const CONFLICT_MODES = ['refuse', 'keep-destination'];

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export { sha as sha256Bytes };

// Root-level files (VAULT.md, AGENTS.md, index.md, vault-schema.md ...) are each vault's own configuration and
// catalogs; log/ is each vault's own history and _templates/ its own scaffolding. None of them moves.
export function isSystemPath(path) {
  return !path.includes('/') || path.startsWith('log/') || path.startsWith('_templates/');
}

const isRaw = (path) => path.startsWith('raw/');
const isMarkdown = (path) => path.endsWith('.md');

const FRONTMATTER = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/;

// prose() reads a line indented by a tab or four spaces as indented code. In a wiki page that is far more often a
// nested list item, which Obsidian renders as a link, and a link the scan skipped would land at the destination as a
// live link to a page that is not there. So leading whitespace is hidden from prose() (same length, so offsets hold):
// a fence marker's becomes `>`, which prose() strips as a quote container and still sees the fence; any other line's
// becomes a placeholder. Fenced code, inline code and comments are still examples.
function linkMask(text) {
  const shown = text.replace(/^[ \t]+/gm, (lead, offset) => {
    const rest = text.slice(offset + lead.length, offset + lead.length + 3);
    return (rest === '```' || rest === '~~~' ? '>' : '\u0001').repeat(lead.length);
  });
  return prose(shown);
}

// Every wikilink in a page, with the offsets of its original text. Links in code and comments are examples,
// not links, and are neither followed nor rewritten. `channel` is the resolution question
// the link asks: `provenance` for a `sources:` entry, `nav` for everything else, including other frontmatter
// lists such as `depends-on` and `specced-in`.
export function scanLinks(text) {
  const mask = linkMask(text);
  const fm = text.match(FRONTMATTER);
  const fmEnd = fm ? fm[0].length : 0;
  const keyAt = (index) => {
    const before = text.slice(0, index);
    const keys = [...before.matchAll(/^([\w-]+):/gm)];
    return keys.length ? keys.at(-1)[1] : null;
  };
  const out = [];
  for (const m of mask.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
    const innerStart = m.index + m[1].length + 2;
    const inner = text.slice(innerStart, innerStart + m[2].length);
    const aliasAt = inner.search(/\\?\|/);
    const head = aliasAt < 0 ? inner : inner.slice(0, aliasAt);
    const aliasPart = aliasAt < 0 ? '' : inner.slice(aliasAt);
    const hashAt = head.indexOf('#');
    const target = (hashAt < 0 ? head : head.slice(0, hashAt)).trim();
    const heading = hashAt < 0 ? '' : head.slice(hashAt);
    const alias = aliasPart.replace(/^\\?\|/, '');
    const inFrontmatter = m.index < fmEnd;
    const key = inFrontmatter ? keyAt(m.index) : null;
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      text: text.slice(m.index, m.index + m[0].length),
      embed: m[1] === '!',
      target,
      heading,
      aliasPart,
      alias,
      inFrontmatter,
      key,
      channel: key === 'sources' ? 'provenance' : 'nav',
      inTable: !inFrontmatter && /^\s*\|/.test(text.slice(lineStart, m.index)),
    });
  }
  return out;
}

// The plain text a link to a page outside the selection becomes: what the reader saw, and where the page lives.
// It names the vault ID and the vault-relative path, never a root, and is never a link of any kind.
export function plainReference(link, { vault, path }) {
  const label = (link.alias || link.target).trim() || path;
  return `${label} (vault ${vault}: ${path})`;
}

// The same link, written with the target's full vault path so it resolves to the same file at the destination
// whatever else shares its name there. The displayed text is kept: an existing alias stays, and a bare link
// gains its old text as the alias (escaped in a table row). Frontmatter entries and embeds get no new alias.
export function qualifiedLink(link, path) {
  let aliasPart = link.aliasPart;
  if (!aliasPart && !link.inFrontmatter && !link.embed) aliasPart = `${link.inTable ? '\\|' : '|'}${link.target}${link.heading}`;
  return `${link.embed ? '!' : ''}[[${path}${link.heading}${aliasPart}]]`;
}

function figurePaths(text) {
  const fm = text.match(FRONTMATTER)?.[0] ?? '';
  const flow = fm.match(/^figures:[ \t]*\[(.*)\][ \t]*$/m);
  let items = [];
  if (flow) items = [...flow[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^,\s][^,]*)/g)].map((m) => (m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : (m[2] ?? m[3]).trim()));
  else {
    const block = fm.match(/^figures:[ \t]*\r?\n((?:[ \t]+-[ \t]*.+\r?\n?)+)/m);
    if (block) items = [...block[1].matchAll(/-[ \t]*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S.*?))[ \t]*$/gm)].map((m) => (m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : (m[2] ?? m[3])));
  }
  return items.filter(Boolean).map((p) => p.replace(/^\[\[|\]\]$/g, ''));
}

// Expands a folder seed into its pages. A folder with no page is an error for the caller to report.
export function pagesUnder(pages, folder) {
  const prefix = `${folder.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  return pages.map((p) => p.path).filter((p) => p.startsWith(prefix)).sort();
}

/**
 * Plans a transfer. Pure: reads go through `source.read(path)` and `destination.read(path)`, which return a
 * Buffer, or null when the file does not exist.
 *
 * source / destination: { id, pages (buildGraph records), read(path) }; destination also { recycled }: entries
 * of its own purge manifests ({ from, 'source-hash' }), whose next --reconcile would re-bin a file landing there.
 */
export function planTransfer({ source, destination, seeds, depth = DEFAULT_DEPTH, mode = 'copy', onConflict = 'refuse', allowHashMismatch = false }) {
  const errors = [];
  if (!['copy', 'move'].includes(mode)) errors.push(`mode must be copy or move (got "${mode}")`);
  if (!CONFLICT_MODES.includes(onConflict)) errors.push(`on-conflict must be ${CONFLICT_MODES.join(' or ')} (got "${onConflict}")`);
  if (!Number.isInteger(depth) || depth < 0) errors.push(`depth must be a whole number of 0 or more (got "${depth}")`);
  const srcPages = sortedByPath(source.pages);
  const byPath = new Map(srcPages.map((p) => [p.path, p]));
  const seedList = [...new Set(seeds)].sort();
  if (!seedList.length) errors.push('no seed pages were given');
  for (const s of seedList) {
    if (!byPath.has(s)) errors.push(`seed is not a page in vault ${source.id}: ${s}`);
    else if (isSystemPath(s)) errors.push(`seed is a vault system file, which never transfers: ${s}`);
  }
  if (errors.length) return { errors };

  const byName = buildNameIndex(srcPages);
  const textCache = new Map();
  const textOf = (path) => {
    if (!textCache.has(path)) textCache.set(path, source.read(path)?.toString('utf8') ?? '');
    return textCache.get(path);
  };
  const linkCache = new Map();
  const linksOf = (path) => {
    if (!linkCache.has(path)) linkCache.set(path, scanLinks(textOf(path)));
    return linkCache.get(path);
  };
  const resolveIn = (index, link) => resolveLinkTarget(index, link.target, { nav: link.channel === 'nav' });

  const selected = new Map(); // path -> { reason, depth, via }
  const add = (path, reason, d, via) => {
    if (selected.has(path) || isSystemPath(path)) return false;
    selected.set(path, { reason, depth: d, via });
    return true;
  };
  for (const s of seedList) add(s, 'seed', 0, null);

  // Navigation: links and citations from a non-raw page, one hop per depth level.
  let frontier = seedList.filter((p) => !isRaw(p) && isMarkdown(p));
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const from of frontier) {
      for (const link of linksOf(from)) {
        const to = resolveIn(byName, link);
        if (!to || isRaw(to)) continue;
        if (add(to, 'linked', d, from) && isMarkdown(to)) next.push(to);
      }
    }
    frontier = next;
  }

  // Evidence: raw files any selected page cites or embeds, and the source pages its `sources:` names, until
  // the provenance trail reaches raw. A `sources:` entry naming anything else outside the selection blocks.
  const blocking = [];
  const work = [...selected.keys()].filter((p) => isMarkdown(p));
  while (work.length) {
    const from = work.shift();
    if (isRaw(from)) {
      for (const link of linksOf(from)) {
        const to = resolveIn(byName, link);
        if (to && isRaw(to) && !isMarkdown(to)) add(to, 'evidence', null, from);
      }
      for (const fig of figurePaths(textOf(from))) {
        if (!byPath.has(fig) || !isRaw(fig)) continue;
        if (add(fig, 'evidence', null, from)) work.push(fig);
        const png = fig.replace(/\.md$/i, '.png');
        if (png !== fig && byPath.has(png)) add(png, 'evidence', null, from);
      }
      continue;
    }
    for (const link of linksOf(from)) {
      const to = resolveIn(byName, link);
      if (!to) continue;
      if (isRaw(to)) {
        if (add(to, 'evidence', null, from) && isMarkdown(to)) work.push(to);
      } else if (link.channel === 'provenance' && to.startsWith('wiki/sources/')) {
        if (add(to, 'cited', null, from)) work.push(to);
      } else if (link.channel === 'provenance' && !selected.has(to)) {
        blocking.push({ path: from, reason: 'provenance-outside-selection', detail: `sources: names ${to}, which is not selected; add it as a seed or raise --depth` });
      }
    }
  }

  // The destination's name index as it will be once the selection lands, for deciding which links need their
  // full path to keep resolving to the same file.
  const selectedPaths = new Set(selected.keys());
  const destPages = destination.pages.filter((p) => !selectedPaths.has(p.path));
  const destIndex = buildNameIndex(sortedByPath([...destPages, ...[...selectedPaths].map((p) => byPath.get(p))]));
  const destLower = new Map(destination.pages.map((p) => [p.path.toLowerCase(), p.path]));
  const recycledPaths = new Set((destination.recycled ?? []).map((e) => String(e.from ?? '').toLowerCase()));
  const recycledHashes = new Set((destination.recycled ?? []).map((e) => String(e['source-hash'] ?? '').toLowerCase()).filter(Boolean));

  const entries = [];
  const linkChanges = [];
  const attaches = [];
  const unhashed = [];
  const mismatched = [];
  const conflicts = [];
  const outputs = new Map();
  let bytes = 0;
  for (const path of [...selectedPaths].sort()) {
    const page = byPath.get(path);
    const info = selected.get(path);
    const srcBytes = source.read(path);
    if (srcBytes === null) { blocking.push({ path, reason: 'unreadable', detail: 'the file could not be read' }); continue; }
    const srcSha = sha(srcBytes);
    let out = srcBytes;
    const counts = { kept: 0, qualified: 0, plain: 0, unresolved: 0 };
    let hashMismatch = false;
    if (isRaw(path)) {
      if (isMarkdown(path) && !path.startsWith('raw/figures/')) {
        if (!page.sourceHash) unhashed.push(path);
        else if (clippingHash(srcBytes.toString('utf8')) !== page.sourceHash) {
          // Already so at the source. Refused unless the owner accepts copying it as it is: byte for byte, with
          // the mismatch named in the plan and both log entries, and its source-hash left unverified.
          hashMismatch = true;
          if (allowHashMismatch) mismatched.push(path);
          else blocking.push({ path, reason: 'hash-mismatch', detail: 'the stored text does not match its source-hash, so it is not the capture the hash records (--allow-hash-mismatch copies it as it is)' });
        }
      }
    } else if (isMarkdown(path)) {
      const text = textOf(path);
      let result = '';
      let cursor = 0;
      for (const link of linksOf(path)) {
        const at = resolveIn(byName, link);
        let replacement = null;
        let kind;
        if (!at) {
          kind = 'unresolved';
          const there = resolveIn(destIndex, link);
          if (there) attaches.push({ page: path, link: link.text, resolves: there });
        } else if (isSystemPath(at) && !at.includes('/')) {
          kind = 'kept'; // index.md and the other root files: every vault has its own
        } else if (selectedPaths.has(at)) {
          if (resolveIn(destIndex, link) === at) kind = 'kept';
          else { kind = 'qualified'; replacement = qualifiedLink(link, at); }
        } else if (link.channel === 'provenance') {
          kind = 'kept'; // already reported as blocking above
        } else {
          kind = 'plain';
          replacement = plainReference(link, { vault: source.id, path: at });
        }
        counts[kind] += 1;
        if (replacement !== null) {
          linkChanges.push({ page: path, kind, from: link.text, to: replacement });
          result += text.slice(cursor, link.start) + replacement;
          cursor = link.end;
        }
      }
      if (cursor) out = Buffer.from(result + text.slice(cursor), 'utf8');
    }
    const outSha = sha(out);
    outputs.set(path, out);
    bytes += out.length;

    // What the destination already holds at this path.
    let state = 'write';
    let conflict = null;
    const existing = destLower.get(path.toLowerCase());
    if (existing && existing !== path) conflict = `the destination has ${existing}, which differs only in letter case`;
    else {
      const there = destination.read(path);
      if (there !== null) {
        if (sha(there) === outSha) state = 'present';
        else conflict = 'the destination already has a different file at this path';
      }
    }
    if (!conflict && state === 'write' && (recycledPaths.has(path.toLowerCase()) || (page.sourceHash && recycledHashes.has(page.sourceHash)))) {
      conflict = 'a purge recorded in the destination\'s .recycle/ names this file, so its next --reconcile would bin it again';
    }
    if (conflict) {
      if (onConflict === 'keep-destination') state = 'keep-destination';
      else { state = 'conflict'; conflicts.push({ path, detail: conflict }); }
    }
    entries.push({
      path, reason: info.reason, depth: info.depth, via: info.via,
      layer: isRaw(path) ? 'raw' : 'wiki', bytes: out.length, srcSha, outSha, state, conflict, links: counts,
      ...(page.sourceHash ? { sourceHash: page.sourceHash } : {}),
      ...(hashMismatch ? { hashMismatch } : {}),
    });
  }

  // A move removes at the source what is being moved and nothing another page there still needs:
  //  - A seed that is not evidence is always removed: it is what the owner asked to move. Pages staying behind
  //    that link to it become collateral, to be repaired as plain text, as a purge's are.
  //  - Any other selected page stays (copied, in both vaults) when a page outside the selection links to or
  //    cites it, such as a concept or source page another project shares.
  //  - Evidence a kept page cites stays with it, raw files and source pages alike, so its provenance does not
  //    break; a kept clipping keeps its figures and attachments. Nothing else is kept on a kept page's account:
  //    a kept page that links to a removed page is collateral too.
  let removal = null;
  if (mode === 'move') {
    const transferred = new Set(entries.filter((e) => e.state === 'write' || e.state === 'present').map((e) => e.path));
    const seedSet = new Set(seedList);
    const isEvidence = (p) => isRaw(p) || p.startsWith('wiki/sources/');
    const inbound = inboundMap(srcPages, byName);
    const targetsOf = (p) => [
      ...(p.outTargets ?? []).map((t) => resolveLinkTarget(byName, t, { nav: true })),
      ...(p.fmTargets ?? []).map((t) => resolveLinkTarget(byName, t, { nav: false })),
    ];
    const keptBy = new Map();
    for (const p of transferred) {
      if (seedSet.has(p) && !isEvidence(p)) continue;
      const holders = [...(inbound.get(p) ?? [])].filter((r) => !transferred.has(r) && !isStructural(r));
      if (holders.length) keptBy.set(p, holders.sort());
    }
    const work = [...keptBy.keys()];
    while (work.length) {
      const k = work.pop();
      const cited = [
        ...targetsOf(byPath.get(k)).filter((t) => t && isEvidence(t)),
        ...(isRaw(k) ? entries.filter((e) => e.via === k && isRaw(e.path)).map((e) => e.path) : []),
      ];
      for (const t of cited) {
        if (!transferred.has(t) || keptBy.has(t)) continue;
        keptBy.set(t, [k]);
        work.push(t);
      }
    }
    const remove = new Set([...transferred].filter((p) => !keptBy.has(p)));
    const collateral = srcPages
      .filter((p) => !remove.has(p.path) && isContent(p.path) && targetsOf(p).some((t) => remove.has(t)))
      .map((p) => p.path).sort();
    removal = {
      remove: [...remove].sort(),
      keep: [...keptBy].map(([path, by]) => ({ path, by })).sort((a, b) => (a.path < b.path ? -1 : 1)),
      collateral,
    };
  }

  const digest = sha(JSON.stringify({
    version: PLAN_VERSION, from: source.id, to: destination.id, mode, depth, onConflict, allowHashMismatch, seeds: seedList,
    // `write` and `present` are one decision: a resumed apply finds some of its own files already there.
    entries: entries.map((e) => [e.path, e.srcSha, e.outSha, e.state === 'present' ? 'write' : e.state]),
    remove: removal?.remove ?? [],
  }));
  const count = (layer) => entries.filter((e) => e.layer === layer).length;
  const plan = {
    id: digest.slice(0, 16),
    digest,
    from: source.id,
    to: destination.id,
    mode, depth, onConflict, allowHashMismatch, seeds: seedList,
    entries,
    linkChanges,
    conflicts,
    blocking,
    notes: { unhashed, mismatched, attaches },
    removal,
    totals: { files: entries.length, wiki: count('wiki'), raw: count('raw'), bytes },
  };
  // The bytes each entry lands as, for apply. Not enumerable, so a printed or serialized plan leaves them out.
  Object.defineProperty(plan, 'outputs', { value: outputs });
  return plan;
}
