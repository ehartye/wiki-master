import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGraph, citationBody, isContent, isEvidencePath, isMoc, isStub } from './graph.mjs';
import { frontmatterDamage, normalizeIdentity, parseNote, strayCarriageReturn, withoutComment } from './note.mjs';
import { blank, prose } from './prose.mjs';
import { unrecognizedBacklogItems } from './authored-group.mjs';

export { prose };

function links(text, { clean = true, offset = 0 } = {}) {
  const visible = clean ? prose(text) : text;
  const out = [];
  for (let pos = 0; (pos = visible.indexOf('[[', pos)) !== -1;) {
    const start = pos;
    pos += 2;
    const prefix = visible.slice(0, start);
    if ((prefix.match(/\\+$/)?.[0].length ?? 0) % 2 || prefix.endsWith('!')) continue;
    const end = visible.indexOf(']]', pos);
    const nested = visible.indexOf('[[', pos);
    const closed = end !== -1 && (nested === -1 || end < nested);
    const finish = closed ? end : (visible.indexOf('\n', pos) === -1 ? visible.length : visible.indexOf('\n', pos));
    const inside = visible.slice(pos, finish);
    // Obsidian tables escape the alias separator: [[Target\|Label]].
    const target = inside.split(/[|#]/, 1)[0].replace(/\\$/, '').trim();
    const malformed = !closed || /[\r\n]/.test(inside) || (!target && !inside.startsWith('#'));
    if (target || malformed) out.push({ target, malformed, line: offset + text.slice(0, start).split('\n').length, text: text.slice(start, closed ? end + 2 : finish) });
    pos = closed ? end + 2 : finish;
  }
  return out;
}

function prepare(page, markdown) {
  const { body, metadata } = parseNote(markdown);
  const prefix = markdown.slice(0, markdown.length - body.length);
  const offset = prefix.split('\n').length - 1;
  const bodyLinks = links(body, { offset });
  // Only sources: is the provenance channel; aliases/title examples are not.
  const fmLines = prefix.split('\n');
  const start = fmLines.findIndex(line => /^sources:/.test(line));
  let stop = start + 1;
  while (start >= 0 && stop < fmLines.length && /^(?:\s*$|[ \t]+\S|[ \t]*-\s)/.test(fmLines[stop])) stop++;
  const sourceText = start < 0 ? '' : fmLines.slice(start, stop).map(line => {
    const valueStart = line.startsWith('sources:') ? 'sources:'.length : (line.match(/^[ \t]*-[ \t]*/)?.[0].length ?? 0);
    const head = line.slice(0, valueStart), value = line.slice(valueStart);
    const kept = withoutComment(value);
    return head + kept + blank(value.slice(kept.length));
  }).join('\n');
  const sourceLinks = links(sourceText, { clean: false, offset: start });
  const factual = citationBody(prose(body), { preserveLines: true });
  const factualLinks = links(factual, { clean: false, offset });
  const factualKeys = new Set(factualLinks.map(x => JSON.stringify([x.line, x.target])));
  for (const link of bodyLinks) link.factual = factualKeys.has(JSON.stringify([link.line, link.target]));
  return { ...page, bodyLinks, sourceLinks,
    outTargets: bodyLinks.filter(x => !x.malformed).map(x => x.target),
    fmTargets: sourceLinks.filter(x => !x.malformed).map(x => x.target),
    evidenceTargets: factualLinks.filter(x => !x.malformed).map(x => x.target),
    declaresNoSources: Array.isArray(metadata.sources) && metadata.sources.length === 0,
    frontmatterDamage: frontmatterDamage(markdown),
    strayCarriageReturn: strayCarriageReturn(markdown),
    words: (prose(body).match(/\S+/g) ?? []).length,
    provenanceLine: start < 0 ? offset + 1 : start + 1,
  };
}

function resolver(pages) {
  const exact = new Map(), stems = new Map(), labels = new Map();
  const names = new Map(pages.map(p => [p.path, normalizeIdentity(p.name)]));
  const add = (map, key, path) => {
    key = normalizeIdentity(key);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(path);
  };
  for (const p of pages) {
    add(exact, p.path, p.path);
    add(stems, p.path.replace(/\.md$/i, ''), p.path);
    for (const label of [p.name, p.metadata?.title, ...(p.aliases ?? [])].filter(Boolean)) add(labels, label, p.path);
  }
  return (target, nav = false) => {
    const key = normalizeIdentity(target);
    // A file named exactly, path and extension, wins over another file's
    // extension-stripped path: the "X.md.md" convention makes the stem of
    // "build.md.md" spell the full path of "Build.md".
    if (exact.has(key)) return [...exact.get(key)].sort();
    if (stems.has(key)) return [...stems.get(key)].sort();
    if (key.includes('/')) return [];
    const label = labels.has(key) ? key : key.replace(/\.md$/i, '');
    const candidates = [...(labels.get(label) ?? [])];
    let preferred = candidates.filter(path => nav ? isContent(path) : path.startsWith('raw/'));
    if (!preferred.length) preferred = candidates;
    // Within the channel: a generated MOC yields to real content in navigation, then a file whose
    // NAME is the link outranks files that only share its title or an alias. Two files with the
    // same stem stay ambiguous.
    if (nav && preferred.length > 1) { const real = preferred.filter(path => !isMoc(path)); if (real.length) preferred = real; }
    if (preferred.length > 1) { const named = preferred.filter(path => names.get(path) === label); if (named.length === 1) preferred = named; }
    return preferred.sort();
  };
}

const VERIFY = {
  'malformed-link': 'Read the surrounding prose and correct the intended wikilink syntax; rerun health and verify meaning is preserved.',
  'unresolved-citation': 'Locate the intended evidence, verify it supports the claim, repair the exact citation and rerun health.',
  'ambiguous-link': 'Read the candidate pages, choose the intended identity, qualify its canonical path and rerun health.',
  'malformed-frontmatter': 'Open the file with its bytes visible, normalise the damaged line ending or close the fence without changing any text, rerun health and verify the page\'s metadata is now read.',
  'missing-evidence': 'Verify the substantive claims against evidence and restore the required citation trail; rerun health. Do not add unrelated citations or weaken status to clear this issue.',
};

// `sources`, a Set of vault-relative paths, scopes what is reported to those pages; the scan still reads the
// whole vault, because a link is ambiguous only against every page. With it the result also lists `pages`,
// the named paths that are scanned content pages, so a caller can tell a path the scan never saw from a
// page with nothing to report. Without it the result is the whole-vault one.
export function scanIntegrity(vaultPath, { sources } = {}) {
  const graph = buildGraph(vaultPath);
  const pages = graph.pages.map(p => isContent(p.path) ? prepare(p, readFileSync(join(vaultPath, p.path), 'utf8')) : p);
  const content = pages.filter(p => isContent(p.path));
  const byPath = new Map(pages.map(p => [p.path, p]));
  const resolve = resolver(pages);
  const issues = new Map(), forwards = new Map();
  const add = (map, rule, p, link, extra = {}) => {
    const target = link.target ?? '';
    const key = JSON.stringify([rule, p.path, target]);
    if (map.has(key)) {
      const item = map.get(key);
      if (!item.lines.includes(link.line)) item.lines.push(link.line);
      return;
    }
    map.set(key, { id: createHash('sha256').update(key).digest('hex').slice(0, 20), rule,
      source: p.path, target, line: link.line, lines: [link.line], evidence: link.text,
      ...(VERIFY[rule] ? { verification: VERIFY[rule] } : {}), ...extra });
  };
  const evidenceEdges = p => [
    ...(p.fmTargets ?? []).map(t => resolve(t)),
    ...(p.evidenceTargets ?? []).map(t => resolve(t, true)),
  ].filter(paths => paths.length === 1).map(paths => paths[0]).filter(isEvidencePath);
  const reachesRaw = start => {
    const seen = new Set([start.path]);
    let frontier = [start];
    for (let depth = 0; depth < 3; depth++) {
      const next = [];
      for (const p of frontier) for (const path of evidenceEdges(p)) {
        if (path.startsWith('raw/')) return true;
        if (!seen.has(path)) { seen.add(path); next.push(byPath.get(path)); }
      }
      frontier = next;
    }
    return false;
  };
  let provenanceEligible = 0;
  for (const p of content) {
    let citationDefect = false;
    // Unread metadata would otherwise surface as a missing trail on a page that declares none.
    if (p.frontmatterDamage) add(issues, 'malformed-frontmatter', p, p.frontmatterDamage);
    for (const [channel, occurrences] of [['sources', p.sourceLinks], ['body', p.bodyLinks]]) {
      for (const link of occurrences) {
        const citation = channel === 'sources' || (link.factual && /^(raw|wiki\/sources)\//i.test(link.target));
        const candidates = resolve(link.target, !citation);
        const rule = link.malformed ? 'malformed-link' : candidates.length > 1 ? 'ambiguous-link' : !candidates.length && citation ? 'unresolved-citation' : null;
        if (rule) {
          add(issues, rule, p, link, { channel, ...(candidates.length > 1 ? { candidates } : {}) });
          if (citation) citationDefect = true;
        } else if (!candidates.length) add(forwards, 'unresolved-navigation', p, link, { disposition: 'Unscored: may be an intentional forward link. Missing target, age and similarity do not prove damage.' });
      }
    }
    const sourcePage = p.path.startsWith('wiki/sources/');
    const authoredDisclosure = p.path.startsWith('wiki/authored/') && p.declaresNoSources;
    if (!p.path.startsWith('wiki/') || isStub(p) || authoredDisclosure) continue;
    provenanceEligible++;
    const hasEvidence = sourcePage ? evidenceEdges(p).some(path => path.startsWith('raw/')) : reachesRaw(p);
    if (!hasEvidence && !citationDefect && !p.frontmatterDamage) add(issues, 'missing-evidence', p, { line: p.provenanceLine,
      text: sourcePage ? 'Substantive source page has no unambiguous direct citation to raw evidence.' : 'Substantive derived page has no unambiguous evidence route to raw within three hops.' });
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const sorted = map => [...map.values()].sort((a, b) => compare(a.source, b.source) || compare(a.rule, b.rule) || compare(a.target, b.target));
  const scoped = list => (sources ? list.filter(x => sources.has(x.source ?? x.page)) : list);
  const findings = scoped(sorted(issues));
  return { version: 1, status: !content.length ? 'empty' : findings.length ? 'defects' : 'clear',
    defectCount: findings.length, issues: findings, forwardLinks: scoped(sorted(forwards)),
    ...(sources ? { pages: content.map(p => p.path).filter(path => sources.has(path)).sort(compare) } : {}),
    // Unscored: a page with a carriage return that is not half of a CRLF. It stays readable, so it is not a defect.
    strayCarriageReturns: scoped(content.filter(p => p.strayCarriageReturn).map(p => ({ page: p.path, line: p.strayCarriageReturn })).sort((a, b) => compare(a.page, b.page))),
    // Unscored: a backlog item whose status the generated roadmap cannot place (it lists them under "Unrecognized status").
    unrecognizedBacklogStatus: scoped(unrecognizedBacklogItems(content.filter(p => p.path.startsWith('wiki/authored/') && p.kind === 'backlog-item'))
      .map(p => ({ page: p.path, status: p.backlogStatus ?? null })).sort((a, b) => compare(a.page, b.page))),
    coverage: { contentPages: content.length, provenanceEligible, stubs: content.filter(isStub).length,
      checks: Object.keys(VERIFY),
      notChecked: ['factual correctness', 'external URLs', 'heading/block anchors', 'historical moves/deletions', 'Markdown-style links'],
      exclusions: ['raw bodies', 'templates', 'logs', 'system files', 'dot-prefixed files and directories', 'code examples', 'comments', 'embeds'] },
  };
}

export function integrityReport(r) {
  const lines = [`Open integrity defects: ${r.defectCount} (target 0)`,
    `Scanned ${r.coverage.contentPages} content pages; ${r.coverage.provenanceEligible} require evidence; ${r.coverage.stubs} stubs.`,
    `Unresolved navigation: ${r.forwardLinks.length} (unscored; preserve intentional forward links).`];
  if (r.status === 'empty') lines.push('No content pages were checked; this is not a health verdict.');
  if (r.strayCarriageReturns?.length) lines.push(`Stray carriage returns: ${r.strayCarriageReturns.length} page(s) (unscored; the page is readable, but a bare return can split a line wrongly): ${r.strayCarriageReturns.slice(0, 5).map(x => `${x.page}:${x.line}`).join(', ')}${r.strayCarriageReturns.length > 5 ? ', ...' : ''}`);
  if (r.unrecognizedBacklogStatus?.length) lines.push(`Backlog items with a missing or unrecognized status: ${r.unrecognizedBacklogStatus.length} (unscored; the project's generated roadmap lists them under "Unrecognized status"): ${r.unrecognizedBacklogStatus.slice(0, 5).map(x => `${x.page} (${x.status ?? 'no status'})`).join(', ')}${r.unrecognizedBacklogStatus.length > 5 ? ', ...' : ''}`);
  for (const issue of r.issues) lines.push(`  ${issue.id} ${issue.rule} ${issue.source}:${issue.line}${issue.target ? ` -> ${JSON.stringify(issue.target)}` : ''}`, `    ${issue.evidence.replace(/\s+/g, ' ')}`, `    Verify: ${issue.verification}`);
  lines.push('Structural integrity only; factual truth and completeness require separate review.',
    'Use --json for the full worklist, --backlog for ingest, --legacy for the historical score.');
  return lines.join('\n');
}
