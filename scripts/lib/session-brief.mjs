import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNote } from './note.mjs';

// The pure parts of `session-brief`: which wiki project a repository belongs to, and what a project's state page
// says. The state page is the one the studio process defines (`reference/studio-state.md`: Phase, Rigor tier,
// Next step, Blocked by, Current sprint, Artifact registry, Open questions, Last gate result).

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
const REQUIRED = [['Phase', 'phase'], ['Rigor tier', 'tier'], ['Next step', 'next'], ['Blocked by', 'blocked'], ['Current sprint', 'sprint'], ['Last gate result', 'gate']];

function sections(body) {
  const out = new Map();
  let name = null;
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##[ \t]+(.+?)[ \t]*$/);
    if (h) { name = h[1]; out.set(name, []); } else if (name) out.get(name).push(line);
  }
  return out;
}
const textOf = (lines = []) => lines.map((l) => l.trim()).filter(Boolean).join(' ');

function tableRows(lines = [], columns) {
  const rows = [];
  let header = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (!header) { header = cells.map((c) => c.toLowerCase()); continue; }
    const row = {};
    for (const [key, name] of columns) row[key] = cells[header.indexOf(name)] ?? '';
    rows.push(row);
  }
  return rows;
}

export function parseStatePage(markdown) {
  const secs = sections(parseNote(markdown).body);
  const fields = {};
  const empty = [];
  for (const [heading, key] of REQUIRED) {
    const text = textOf(secs.get(heading));
    fields[key] = PLACEHOLDER.test(text) ? '' : text;
    if (!fields[key]) empty.push(heading);
  }
  const registry = tableRows(secs.get('Artifact registry'), [['artifact', 'artifact'], ['path', 'path'], ['owner', 'owner'], ['status', 'status'], ['lastVerified', 'last verified']]);
  const questions = tableRows(secs.get('Open questions'), [['question', 'question'], ['owner', 'owner'], ['gate', 'must be answered by'], ['status', 'status']]);
  return { fields, empty, registry, questions };
}

// The phases in order, and the phase each gate closes (G1 closes concept ... G5 closes release).
const PHASES = ['adopt', 'concept', 'pre-production', 'production', 'beta', 'release', 'live'];
const GATE_PHASE = { G1: 'concept', G2: 'pre-production', G3: 'production', G4: 'beta', G5: 'release' };
const DAY = 24 * 60 * 60 * 1000;
const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function buildBrief({ state, items = [], today = new Date(), staleDays = 30 }) {
  const f = state.fields;
  const show = (s) => s || '(empty)';
  const report = [`Phase: ${show(f.phase)}, tier: ${show(f.tier)}`, `Next step: ${show(f.next)}`, `Blocked by: ${show(f.blocked)}`];
  const stale = [];
  for (const row of state.registry) {
    if (row.status.toLowerCase() === 'absent') continue;
    const m = row.lastVerified.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const verified = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
    if (Number.isNaN(verified)) { stale.push({ artifact: row.artifact, path: row.path, reason: 'no date' }); continue; }
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
  return { report, empty: state.empty, stale, blockedItems, overdue, dueNext };
}

const BY = { remote: 'the repository remote', folder: 'the repository folder name', flag: '--project' };

export function formatBrief({ project, path, by, brief, staleDays = 30 }) {
  const lines = [`Project: ${project} (${path}), matched by ${BY[by] ?? by}`];
  if (!brief) {
    lines.push(`no state page at ${path}/reference/studio-state.md; run studio-start to create it`);
    return lines.join('\n');
  }
  const extra = [];
  if (brief.empty.length) extra.push(`Empty required field(s): ${brief.empty.join(', ')}; the page is incomplete, run studio-start`);
  if (brief.stale.length) extra.push(`Stale artifacts (not verified for more than ${staleDays} days):`, ...brief.stale.map((s) => `  - ${s.artifact} (${s.reason})`));
  if (brief.blockedItems.length) extra.push('Blocked backlog items:', ...brief.blockedItems.map((i) => `  - ${i.path} (${i.title})`));
  if (brief.overdue.length) extra.push('Open questions past their gate:', ...brief.overdue.map((q) => `  - ${q.question} (gate ${q.gate}, owner ${q.owner || 'none'})`));
  if (brief.dueNext.length) extra.push('Open questions due at the next gate:', ...brief.dueNext.map((q) => `  - ${q.question} (gate ${q.gate}, owner ${q.owner || 'none'})`));
  lines.push(...brief.report, '', ...(extra.length ? extra : ['No stale artifacts, blocked items or overdue questions.']));
  return lines.join('\n');
}
