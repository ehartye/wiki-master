import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildGraph } from './lib/graph.mjs';
import { resolveVault } from './lib/vault.mjs';

const FOLDERS = new Set(['concepts', 'entities', 'sources', 'syntheses', 'authored']);
const TYPE_FOLDER = { concept: 'concepts', entity: 'entities', source: 'sources', synthesis: 'syntheses', authored: 'authored', moc: '../moc' };
const key = s => String(s).trim().toLowerCase();

// Identity findings are review work, never permission to merge or rename pages.
export function auditIdentity({ pages }, { limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be an integer from 1 to 1000');
  const eligible = pages.filter(p => !p.path.split('/').some(part => part.startsWith('.')) && p.path.endsWith('.md') && /^(wiki|raw|moc)\//.test(p.path));
  const findings = [];
  const names = new Map();
  const identities = new Map();
  const register = (name, p, alias, title = false) => {
    const normalized = key(name);
    if (!normalized) return;
    if (!identities.has(normalized)) identities.set(normalized, []);
    identities.get(normalized).push({ path: p.path, alias, title });
  };
  for (const p of eligible) {
    const name = key(p.name ?? p.path.split('/').pop().replace(/\.md$/i, ''));
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(p.path);
    register(name, p, false);
    register(p.path, p, false);
    register(p.path.replace(/\.md$/i, ''), p, false);
    if (p.metadata?.title) register(p.metadata.title, p, false, true);
    for (const alias of p.aliases ?? []) register(alias, p, true);
    if (p.path.startsWith('wiki/') || p.path.startsWith('moc/')) {
      const folder = p.path.startsWith('moc/') ? '../moc' : p.path.split('/')[1];
      const expected = TYPE_FOLDER[p.type ?? p.metadata?.type];
      if ((folder !== '../moc' && !FOLDERS.has(folder)) || (expected && expected !== folder)) findings.push({
        kind: 'invalid-placement', severity: 'defect', paths: [p.path],
        reason: expected ? `Declared type belongs in ${expected === '../moc' ? 'moc/' : `wiki/${expected}/`}.` : 'Page is outside a supported wiki content folder.',
      });
    }
  }
  for (const [name, paths] of names) {
    if (paths.length < 2) continue;
    const intentional = paths.every(p => p.startsWith('wiki/authored/')) ||
      (paths.some(p => p.startsWith('raw/')) && paths.filter(p => !p.startsWith('raw/')).every(p => p.startsWith('wiki/sources/')) && paths.filter(p => p.startsWith('wiki/')).length === 1);
    findings.push({ kind: 'duplicate-basename', name, severity: intentional ? 'qualified-ambiguity' : 'review', paths: paths.sort(),
      reason: intentional ? 'Expected name reuse; use full paths. Bare names remain ambiguous.' : 'Review scope and identity; distinct pages may need qualified links. Do not merge automatically.' });
  }
  for (const [name, registrations] of identities) {
    const paths = [...new Set(registrations.map(r => r.path))].sort();
    if (paths.length > 1 && registrations.some(r => r.alias)) findings.push({ kind: 'alias-collision', name, severity: 'review', paths, reason: 'Alias overlaps another page identity; equivalent meaning requires human review.' });
    else if (paths.length > 1 && registrations.some(r => r.title)) findings.push({ kind: 'duplicate-title', name, severity: 'review', paths, reason: 'Declared title overlaps another page identity; review scope and use canonical paths.' });
  }
  findings.sort((a, b) => `${a.kind}:${a.name ?? ''}:${a.paths.join('|')}`.localeCompare(`${b.kind}:${b.name ?? ''}:${b.paths.join('|')}`));
  return { scanned: eligible.length, total: findings.length, truncated: Math.max(0, findings.length - limit), findings: findings.slice(0, limit), readOnly: true };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { vault: { type: 'string' }, limit: { type: 'string' }, json: { type: 'boolean' } } });
  const report = auditIdentity(buildGraph(values.vault ?? resolveVault().path), { limit: values.limit === undefined ? 50 : Number(values.limit) });
  console.log(values.json ? JSON.stringify(report, null, 2) : `Identity audit: ${report.total} findings across ${report.scanned} pages (read-only)\n${report.findings.map(f => `${f.severity}: ${f.kind}${f.name ? ` (${f.name})` : ''}\n  ${f.paths.join(', ')}\n  ${f.reason}`).join('\n')}${report.truncated ? `\n… ${report.truncated} further findings omitted` : ''}`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
