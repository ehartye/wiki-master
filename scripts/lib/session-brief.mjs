import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNote, frontmatterDamage } from './note.mjs';

// The pure parts of `session-brief`: which wiki project a repository belongs to, and what a project's state page
// says. Both the optional Studio orientation and historical state pages are read without imposing a workflow.

// A repository reference in a form two spellings of the same place share: `host/owner/name` for a remote of any
// kind (https, ssh://, scp-style, with credentials or a .git suffix), `owner/name` as written, or a bare folder name.
export function normalizeRepoRef(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (!s) return null;
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  const scp = !url && /^[^/\s]+@[^:/\s]+:/.test(s);
  if (url) s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (url || scp) s = s.replace(/^[^@/]*@/, '').replace(/^([^/:]+)[:/]/, '$1/');
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
  return s || null;
}

const AUTHORED = 'wiki/authored';

// A project maps to a vault-relative directory (including nested project tiers).
export function validateProject(project) {
  if (project === undefined) return;
  if (typeof project !== 'string' || !project || project.includes('\\') || project.includes(':') ||
      project.includes('\0') || project.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) {
    throw new Error('project must be a nonempty vault-relative project slug');
  }
}

// The overview pages that carry a `repo:` key, as { project, path, refs }. Overview pages sit at most three
// folders under wiki/authored (a project tier may be nested), so the walk stops there.
function overviewPages(vaultPath) {
  const found = [];
  (function walk(rel, depth) {
    let entries;
    try { entries = readdirSync(join(vaultPath, ...rel.split('/')), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory() && depth < 3) walk(`${rel}/${e.name}`, depth + 1);
      else if (e.isFile() && e.name === 'overview.md') {
        let metadata;
        try { metadata = parseNote(readFileSync(join(vaultPath, ...rel.split('/'), e.name), 'utf8')).metadata; } catch { continue; }
        const refs = [].concat(metadata.repo ?? []).map(normalizeRepoRef).filter(Boolean);
        if (refs.length) found.push({ project: rel.slice(AUTHORED.length + 1), path: rel, refs });
      }
    }
  })(AUTHORED, 0);
  return found;
}

export function findProject(vaultPath, { remote, folder }) {
  const remoteRef = normalizeRepoRef(remote);
  const folderRef = normalizeRepoRef(folder);
  const matches = [];
  for (const page of overviewPages(vaultPath)) {
    let by = null;
    for (const ref of page.refs) {
      if (remoteRef && (ref === remoteRef || (ref.includes('/') && remoteRef.endsWith(`/${ref}`)))) { by = 'remote'; break; }
      if (folderRef && ref === folderRef && !ref.includes('/')) by = 'folder';
    }
    if (by) matches.push({ project: page.project, path: page.path, by });
  }
  return { matches: matches.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : 0)) };
}

// The template fills each field with `<...>`, and one of them nests another pair inside it.
const PLACEHOLDER = /^<.*>$/;
const LEGACY = [['Phase', 'phase'], ['Rigor tier', 'tier'], ['Next step', 'next'], ['Blocked by', 'blocked'], ['Current sprint', 'sprint'], ['Last gate result', 'gate']];
const ORIENTATION = [['Current focus', 'focus'], ['Dependencies and open questions', 'dependencies'], ['Recent decisions', 'decisions']];

function sections(body, warnings) {
  const out = new Map();
  let name = null, fence = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    const h = line.match(/^##[ \t]+(.+?)[ \t]*$/);
    if (h) {
      name = h[1];
      if (out.has(name)) { warnings.push(`Duplicate section: ${name}; only the first is read.`); name = null; }
      else out.set(name, []);
    } else if (name) out.get(name).push(line);
  }
  if (fence) warnings.push('Unclosed code fence; its contents were not read as orientation.');
  return out;
}
const textOf = (lines = []) => lines.map((l) => l.trim()).filter((l) => l && !PLACEHOLDER.test(l)).join(' ');
const firstValue = (lines = []) => {
  const line = lines.find((l) => l.trim())?.trim() ?? '';
  return PLACEHOLDER.test(line) ? '' : line;
};
const readable = (text) => text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target.split('/').pop().replace(/\.md(?=#|$)/, ''));
const linked = (text) => text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => `[${label || target.split('/').pop().replace(/\.md(?=#|$)/, '')}](${target})`);

// Wiki aliases and escaped pipes are cell content, not table delimiters.
function cellsOf(line) {
  const protectedPipes = [];
  const safe = line.replace(/\[\[[^\]]+\]\]|\\\|/g, (s) => {
    protectedPipes.push(s.replace(/\\\|/g, '|'));
    return `\u0000${protectedPipes.length - 1}\u0000`;
  });
  return safe.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\u0000(\d+)\u0000/g, (_, i) => protectedPipes[+i]));
}

function tableRows(lines = [], columns, warnings, section) {
  const rows = [];
  let header = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = cellsOf(t);
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      if (columns.some(([, name]) => !header.includes(name)) || new Set(header).size !== header.length) {
        warnings.push(`Unrecognized ${section} table header; records were not interpreted.`);
        return [];
      }
      continue;
    }
    if (cells.length !== header.length) { warnings.push(`Malformed row in ${section}; row was not interpreted.`); continue; }
    const row = {};
    for (const [key, name] of columns) row[key] = cells[header.indexOf(name)] ?? '';
    rows.push(row);
  }
  return rows;
}

export function parseStatePage(markdown) {
  const warnings = [];
  const damage = frontmatterDamage(markdown);
  if (damage) warnings.push(damage.text);
  const secs = sections(damage ? '' : parseNote(markdown).body, warnings);
  const schema = [...ORIENTATION.map(([h]) => h), 'Relevant records'].some((h) => secs.has(h)) ? 'orientation'
    : [...LEGACY.map(([h]) => h), 'Last checkpoint review', 'Artifact registry', 'Open questions'].some((h) => secs.has(h)) ? 'legacy' : 'unknown';
  const fields = {};
  const empty = [];
  for (const [heading, key] of schema === 'orientation' ? ORIENTATION : schema === 'legacy' ? LEGACY : []) {
    const lines = secs.get(key === 'gate' && secs.has('Last checkpoint review') ? 'Last checkpoint review' : heading);
    fields[key] = schema === 'orientation' || ['next', 'blocked', 'sprint', 'gate'].includes(key) ? textOf(lines) : firstValue(lines);
    if (!fields[key]) empty.push(heading);
  }
  const registry = schema === 'legacy' ? tableRows(secs.get('Artifact registry'), [['artifact', 'artifact'], ['path', 'path'], ['owner', 'owner'], ['status', 'status'], ['lastVerified', 'last verified']], warnings, 'Artifact registry') : [];
  const questions = schema === 'legacy' ? tableRows(secs.get('Open questions'), [['question', 'question'], ['owner', 'owner'], ['gate', 'must be answered by'], ['status', 'status']], warnings, 'Open questions') : [];
  const records = schema === 'orientation' ? tableRows(secs.get('Relevant records'), [['record', 'record'], ['path', 'actual wiki path or existing source link'], ['maintainer', 'maintainer'], ['notes', 'notes']], warnings, 'Relevant records').filter((r) => !PLACEHOLDER.test(r.record)) : [];
  return { schema, fields, empty, registry, questions, records, warnings };
}

// The phases in order, and the phase each gate closes (G1 closes concept ... G5 closes release).
const PHASES = ['adopt', 'concept', 'pre-production', 'production', 'beta', 'release', 'live'];
const GATE_PHASE = { G1: 'concept', G2: 'pre-production', G3: 'production', G4: 'beta', G5: 'release' };
const DAY = 24 * 60 * 60 * 1000;
const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function buildBrief({ state, items = [], today = new Date(), staleDays = 30 }) {
  const f = state.fields;
  const show = (s) => readable(s || '(empty)');
  const report = state.schema === 'orientation' ? ORIENTATION.filter(([, key]) => f[key]).map(([heading, key]) => `${heading}: ${show(f[key])}`)
    : state.schema === 'legacy' ? [`Phase: ${show(f.phase)}, tier: ${show(f.tier)}`, `Next step: ${show(f.next)}`, `Blocked by: ${show(f.blocked)}`] : [];
  const stale = [], unverified = [];
  for (const row of state.registry) {
    if (row.status.toLowerCase() === 'absent') continue;
    const m = row.lastVerified.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const verified = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
    if (Number.isNaN(verified) || new Date(verified).toISOString().slice(0, 10) !== row.lastVerified) { unverified.push({ artifact: row.artifact, path: row.path, reason: 'no valid verification date' }); continue; }
    if (verified > utcDay(today)) { unverified.push({ artifact: row.artifact, path: row.path, reason: 'verification date is in the future' }); continue; }
    const days = Math.floor((utcDay(today) - verified) / DAY);
    if (days > staleDays) stale.push({ artifact: row.artifact, path: row.path, reason: `${days} days` });
  }
  const blockedItems = items.filter((i) => i.backlogStatus === 'blocked').map((i) => ({ path: i.path, title: i.title }));
  const current = PHASES.indexOf(f.phase);
  const overdue = [], dueNext = [];
  for (const q of state.questions) {
    if (q.status.toLowerCase() !== 'open') continue;
    const phase = GATE_PHASE[q.gate.toUpperCase()];
    if (!phase || current < 0) continue;
    const at = PHASES.indexOf(phase);
    if (current > at) overdue.push(q);
    else if (current === at) dueNext.push(q);
  }
  return { schema: state.schema, report, empty: state.empty, records: state.records, warnings: state.warnings, stale, unverified, blockedItems, overdue, dueNext };
}

const BY = { remote: 'the repository remote', folder: 'the repository folder name', flag: '--project' };

export function formatBrief({ project, path, by, brief, staleDays = 30 }) {
  const lines = [`Project: ${project} (${path}), matched by ${BY[by] ?? by}`];
  if (!brief) {
    lines.push(`no state page at ${path}/reference/studio-state.md; orientation is optional and work can continue`);
    return lines.join('\n');
  }
  // Existing callers may construct the historical brief object themselves.
  brief = { schema: 'legacy', records: [], warnings: [], unverified: [], ...brief };
  const extra = [];
  if (brief.schema === 'unknown') extra.push('No recognized orientation sections; consult the source page. Orientation is optional.');
  if (brief.schema === 'orientation' && !brief.report.length && !brief.records.length) extra.push('No orientation details recorded; orientation is optional.');
  if (brief.schema === 'legacy' && brief.empty.length) extra.push(`Unfilled legacy fields: ${brief.empty.join(', ')}; these are not prerequisites for work.`);
  extra.push(...brief.warnings);
  if (brief.records.length) extra.push('Relevant records (notes are advisory, not verification evidence):', ...brief.records.map((r) => `  - ${readable(r.record)}: ${linked(r.path)}${r.maintainer ? ` (maintainer: ${readable(r.maintainer)})` : ''}${r.notes ? ` — ${readable(r.notes)}` : ''}`));
  if (brief.unverified.length) extra.push('Unverified artifacts:', ...brief.unverified.map((s) => `  - ${readable(s.artifact)} (${s.reason})`));
  if (brief.stale.length) extra.push(`Stale artifacts (not verified for more than ${staleDays} days):`, ...brief.stale.map((s) => `  - ${readable(s.artifact)} (${s.reason})`));
  if (brief.blockedItems.length) extra.push('Blocked backlog items:', ...brief.blockedItems.map((i) => `  - ${i.path} (${i.title})`));
  if (brief.overdue.length || brief.dueNext.length) extra.push('Legacy gate annotations only; no approval or work prerequisite is implied.');
  if (brief.overdue.length) extra.push('Legacy open questions past their recorded gate:', ...brief.overdue.map((q) => `  - ${readable(q.question)} (gate ${q.gate}, owner: ${readable(q.owner || 'none')})`));
  if (brief.dueNext.length) extra.push('Legacy open questions at their recorded phase:', ...brief.dueNext.map((q) => `  - ${readable(q.question)} (gate ${q.gate}, owner: ${readable(q.owner || 'none')})`));
  lines.push(...brief.report, '', ...(extra.length ? extra : ['No stale artifacts, blocked items or overdue questions.']));
  return lines.join('\n');
}
