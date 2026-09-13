import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGraph, citationBody, isContent, isEvidencePath, isStub } from './graph.mjs';
import { normalizeIdentity, parseNote, withoutComment } from './note.mjs';

const blank = text => text.replace(/[^\r\n]/g, ' ');

// Preserve offsets so diagnostics always refer to the original file. This is a
// wikilink scanner, not a renderer: headings and external URLs are not checked.
function prose(text) {
  let fence = null;
  const fenced = text.split(/(?<=\n)/).map(line => {
    const container = line.replace(/^(?: {0,3}>[ \t]?)+/, '');
    const marker = container.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return blank(line);
    }
    if (marker) { fence = marker[1]; return blank(line); }
    // Indented code is not a navigational edge either.
    return /^(?: {4}|\t)/.test(line) ? blank(line) : line;
  }).join('');
  const comments = fenced.replace(/<!--[\s\S]*?(?:-->|$)|%%[\s\S]*?(?:%%|$)/g, blank);
  const runs = [...comments.matchAll(/`+/g)];
  let result = '', cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    const close = runs.findIndex((run, j) => j > i && run[0].length === runs[i][0].length);
    if (close < 0) continue;
    const end = runs[close].index + runs[close][0].length;
    result += comments.slice(cursor, runs[i].index) + blank(comments.slice(runs[i].index, end));
    cursor = end;
    i = close;
  }
  return result + comments.slice(cursor);
}

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
    words: (prose(body).match(/\S+/g) ?? []).length,
    provenanceLine: start < 0 ? offset + 1 : start + 1,
  };
}

function resolver(pages) {
  const exact = new Map(), labels = new Map();
  const add = (map, key, path) => {
    key = normalizeIdentity(key);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(path);
  };
  for (const p of pages) {
    add(exact, p.path, p.path);
    add(exact, p.path.replace(/\.md$/i, ''), p.path);
    for (const label of [p.name, p.metadata?.title, ...(p.aliases ?? [])].filter(Boolean)) add(labels, label, p.path);
  }
  return (target, nav = false) => {
    const key = normalizeIdentity(target);
    if (exact.has(key)) return [...exact.get(key)].sort();
    if (key.includes('/')) return [];
    const candidates = [...(labels.get(key) ?? labels.get(key.replace(/\.md$/i, '')) ?? [])];
    const preferred = candidates.filter(path => nav ? isContent(path) : path.startsWith('raw/'));
    return (preferred.length ? preferred : candidates).sort();
  };
}

const VERIFY = {
  'malformed-link': 'Read the surrounding prose and correct the intended wikilink syntax; rerun health and verify meaning is preserved.',
  'unresolved-citation': 'Locate the intended evidence, verify it supports the claim, repair the exact citation and rerun health.',
  'ambiguous-link': 'Read the candidate pages, choose the intended identity, qualify its canonical path and rerun health.',
  'missing-evidence': 'Verify the substantive claims against evidence and restore the required citation trail; rerun health. Do not add unrelated citations or weaken status to clear this issue.',
};

export function scanIntegrity(vaultPath) {
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
    if (!hasEvidence && !citationDefect) add(issues, 'missing-evidence', p, { line: p.provenanceLine,
      text: sourcePage ? 'Substantive source page has no unambiguous direct citation to raw evidence.' : 'Substantive derived page has no unambiguous evidence route to raw within three hops.' });
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const sorted = map => [...map.values()].sort((a, b) => compare(a.source, b.source) || compare(a.rule, b.rule) || compare(a.target, b.target));
  const findings = sorted(issues);
  return { version: 1, status: !content.length ? 'empty' : findings.length ? 'defects' : 'clear',
    defectCount: findings.length, issues: findings, forwardLinks: sorted(forwards),
    coverage: { contentPages: content.length, provenanceEligible, stubs: content.filter(isStub).length,
      checks: Object.keys(VERIFY),
      notChecked: ['factual correctness', 'external URLs', 'heading/block anchors', 'historical moves/deletions', 'Markdown-style links'],
      exclusions: ['raw bodies', 'templates', 'logs', 'system files', 'dot directories', 'code examples', 'comments', 'embeds'] },
  };
}

export function integrityReport(r) {
  const lines = [`Open integrity defects: ${r.defectCount} (target 0)`,
    `Scanned ${r.coverage.contentPages} content pages; ${r.coverage.provenanceEligible} require evidence; ${r.coverage.stubs} stubs.`,
    `Unresolved navigation: ${r.forwardLinks.length} (unscored; preserve intentional forward links).`];
  if (r.status === 'empty') lines.push('No content pages were checked; this is not a health verdict.');
  for (const issue of r.issues) lines.push(`  ${issue.id} ${issue.rule} ${issue.source}:${issue.line}${issue.target ? ` -> ${JSON.stringify(issue.target)}` : ''}`, `    ${issue.evidence.replace(/\s+/g, ' ')}`, `    Verify: ${issue.verification}`);
  lines.push('Structural integrity only; factual truth and completeness require separate review.',
    'Use --json for the full worklist, --backlog for ingest, --legacy for the historical score.');
  return lines.join('\n');
}
