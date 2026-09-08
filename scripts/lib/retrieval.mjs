import { basename } from 'node:path';
import { parseNote, normalizeIdentity } from './note.mjs';
import { wikilinks, citationBody, resolveLinkTarget, isEvidencePath } from './graph.mjs';

export const METADATA_VERSION = 2;
const FIELDS = ['title', 'type', 'kind', 'project', 'status', 'reviewed', 'updated', 'decision', 'decision-status', 'backlog', 'backlog-status', 'priority', 'scope'];

export function noteIdentity(text, path) {
  const { body, metadata, sources, aliases } = parseNote(text);
  const title = String(metadata.title || body.match(/^#\s+(.+)$/m)?.[1] || basename(path, '.md')).trim();
  const selected = Object.fromEntries(FIELDS.filter(k => metadata[k] !== undefined).map(k => [k, metadata[k]]));
  return { title, metadata: selected, sources, aliases, metadataVersion: METADATA_VERSION };
}

function normalizeLexical(value) {
  return String(value).normalize('NFKC').toLowerCase().replace(/\.md$/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function identities(path, entry = {}) {
  return [basename(path, '.md'), entry.metadata?.title, ...(entry.aliases ?? [])].filter(Boolean).map(normalizeIdentity);
}

// Qualified identities refer only to the canonical path. Punctuation folding
// helps approximate ranking, but must never turn distinct paths into aliases.
export function exactIdentity(query, path, entry = {}) {
  const label = normalizeIdentity(query);
  if (/[\\/]/.test(label)) {
    const canonical = value => normalizeIdentity(value).replaceAll('\\', '/').replace(/\.md$/i, '');
    return canonical(label) === canonical(path);
  }
  const names = identities(path, entry);
  return names.includes(label) || names.includes(label.replace(/\.md$/i, ''));
}

export function terms(query) {
  const stop = new Set(['a','an','the','what','which','how','is','are','do','does','can','i','to','of','for','in','and','or','with','about']);
  return [...new Set(normalizeLexical(query).split(' ').filter(t => t && !stop.has(t)))].slice(0, 12);
}

export function lexicalScore(query, path, entry, text = '') {
  const names = [path, ...identities(path, entry)].map(normalizeLexical);
  if (exactIdentity(query, path, entry)) return 1000;
  const words = terms(query);
  const title = normalizeLexical(entry.title || basename(path, '.md'));
  const content = normalizeLexical(text);
  let score = 0;
  for (const word of words) {
    if (title.split(' ').includes(word)) score += 12;
    else if (names.some(n => n.split(' ').includes(word))) score += 6;
    if (content.includes(word)) score += 1;
  }
  if (words.length && words.every(w => title.includes(w))) score += 20;
  return score;
}

export function inScope(path, includeRaw = false) {
  const parts = path.replaceAll('\\', '/').split('/');
  return ['wiki','moc', ...(includeRaw ? ['raw'] : [])].includes(parts[0]) &&
    parts.length > 1 && parts.every(p => p && p !== '..' && !p.startsWith('.') && p !== '_templates') &&
    !['index.md','log.md','vault-schema.md'].includes(parts.at(-1)) && path.endsWith('.md');
}

export function matchesFilters(metadata, options) {
  return ['project','type','status'].every(k => !options[k] ||
    (Array.isArray(metadata[k]) ? metadata[k] : [metadata[k]]).some(v => normalizeIdentity(v ?? '') === normalizeIdentity(options[k])));
}

export function passageFor(text, query, semanticLine) {
  const lines = text.split(/\r?\n/);
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  const bodyStart = fm ? fm[0].split('\n').length - 1 : 0;
  let start = Number.isInteger(semanticLine) && semanticLine > bodyStart && semanticLine <= lines.length ? semanticLine - 1 : bodyStart;
  if (semanticLine == null) {
    const words = terms(query);
    let best = -1;
    for (let i = bodyStart; i < lines.length; i++) {
      const line = normalizeLexical(lines[i]);
      const score = words.filter(w => line.includes(w)).length;
      if (score > best) { best = score; start = i; }
    }
  }
  let passage = '';
  let end = start;
  for (let i = start; i < Math.min(lines.length, start + 12); i++) {
    const addition = (i === start ? '' : '\n') + lines[i];
    passage += addition.slice(0, 1200 - passage.length);
    end = i;
    if (passage.length >= 1200) break;
  }
  return { startLine: start + 1, endLine: end + 1, passage };
}

export function boundedMetadata(metadata) {
  return Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k,
    Array.isArray(v) ? v.slice(0, 12).map(x => String(x).slice(0, 256)) : String(v).slice(0, 512)]));
}

// Citation targets are direct pointers, not verified evidence or claim support.
// The compact index resolves known source names; absent/bare raw names remain
// explicitly unresolved without walking all raw clippings during a query.
export function citationProvenance(text, names) {
  const { body, sources } = parseNote(text);
  const targets = [...sources.flatMap(s => wikilinks(s).length ? wikilinks(s) : [s]), ...wikilinks(citationBody(body))];
  const provenance = new Set();
  const unresolved = new Set();
  for (const target of targets) {
    const resolved = resolveLinkTarget(names, target);
    if (resolved) { if (isEvidencePath(resolved)) provenance.add(resolved); }
    else if (/^(?:wiki\/sources|raw)\//.test(target) && !target.split('/').some(p => p.startsWith('.'))) {
      provenance.add(target.endsWith('.md') ? target : `${target}.md`);
    } else unresolved.add(target);
  }
  return { provenance: [...provenance].slice(0, 12).map(s => s.slice(0, 256)),
    provenanceStatus: 'citation-targets-not-resolved',
    declaredSources: sources.slice(0, 12).map(s => s.slice(0, 256)),
    unresolvedCitations: [...unresolved].slice(0, 12).map(s => s.slice(0, 256)) };
}
