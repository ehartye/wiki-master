import { statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildGraph, buildNameIndex, evidencePaths, resolveLinkTarget, isContent } from './lib/graph.mjs';
import { cosine } from './lib/embed.mjs';
import { resolveVault } from './lib/vault.mjs';
import { readManifestFile, readVectorStore } from './index-embed.mjs';
import { auditIdentity } from './identity-audit.mjs';

const pairKey = (a, b) => [a, b].sort().join('\0');
const compare = (a, b) => b.score - a.score || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);

export function suggestRelationships({ pages }, { limit = 20, seed, since, vectors = new Map() } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be an integer from 1 to 1000');
  if (since && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(Date.parse(since)) || new Date(since).toISOString().slice(0, 10) !== since)) throw new Error('since must be a valid YYYY-MM-DD date');
  const active = pages.filter(p => !p.path.split('/').some(part => part.startsWith('.')));
  const names = buildNameIndex(active);
  const byPath = new Map(active.map(p => [p.path, p]));
  const identities = new Map();
  for (const p of active.filter(p => isContent(p.path))) for (const label of [p.name, p.path, p.path.replace(/\.md$/i, ''), p.metadata?.title, ...(p.aliases ?? [])].filter(Boolean)) {
    const name = label.trim().toLowerCase();
    if (!identities.has(name)) identities.set(name, new Set());
    identities.get(name).add(p.path);
  }
  const blocked = new Set([...identities.values()].filter(paths => paths.size > 1).flatMap(paths => [...paths]));
  const concepts = active.filter(p => p.path.startsWith('wiki/concepts/') && p.path.endsWith('.md') && !blocked.has(p.path)).sort((a, b) => a.path.localeCompare(b.path));
  const seedPath = seed && (byPath.has(seed) ? seed : resolveLinkTarget(names, seed, { nav: true }));
  if (seed && !concepts.some(p => p.path === seedPath)) throw new Error('seed must resolve to an unambiguous concept page');
  const existing = new Set();
  for (const p of concepts) for (const target of p.outTargets ?? []) {
    const path = resolveLinkTarget(names, target, { nav: true });
    if (path) existing.add(pairKey(p.path, path));
  }
  const frequency = new Map();
  const sourceSets = new Map(concepts.map(p => {
    const sources = new Map();
    for (const path of evidencePaths(p, names, byPath)) {
      const source = byPath.get(path);
      const hashes = source?.sourceHash ? [source.sourceHash] : source?.sourceHashes ?? [];
      for (const identity of hashes.length ? hashes.map(h => `hash:${h.toLowerCase()}`) : [`path:${path}`]) {
        if (!sources.has(identity)) sources.set(identity, []);
        sources.get(identity).push(path);
      }
    }
    for (const identity of sources.keys()) frequency.set(identity, (frequency.get(identity) ?? 0) + 1);
    return [p.path, sources];
  }));
  let candidates = [];
  let total = 0;
  for (let i = 0; i < concepts.length; i++) for (let j = i + 1; j < concepts.length; j++) {
    const a = concepts[i], b = concepts[j];
    if (seedPath && a.path !== seedPath && b.path !== seedPath) continue;
    if (since && ![a, b].some(p => (p.updated ?? p.metadata?.updated ?? p.created ?? '') >= since)) continue;
    if (existing.has(pairKey(a.path, b.path))) continue;
    const aSources = sourceSets.get(a.path), bSources = sourceSets.get(b.path);
    const reasons = [];
    let score = 0;
    for (const [identity, paths] of aSources) if (bSources.has(identity)) {
      score += 1 / frequency.get(identity); // Common sources cannot dominate by popularity alone.
      reasons.push({ kind: 'shared-source', identity, paths: [...new Set([...paths, ...bSources.get(identity)])].sort() });
    }
    const av = vectors.get(a.path), bv = vectors.get(b.path);
    const similarity = av?.length && av.length === bv?.length ? cosine(av, bv) : null;
    if (Number.isFinite(similarity) && similarity >= 0.65) {
      score += similarity * 0.25;
      reasons.push({ kind: 'semantic-neighbor', similarity });
    }
    if (!reasons.length) continue;
    const aTopic = a.metadata?.topic ?? a.metadata?.project;
    const bTopic = b.metadata?.topic ?? b.metadata?.project;
    if (aTopic && bTopic && aTopic !== bTopic) {
      score *= 1.2;
      reasons.push({ kind: 'cross-topic', topics: [aTopic, bTopic], note: 'Different declared scopes; assess whether they complement one another.' });
    }
    total++;
    candidates.push({ from: a.path, to: b.path, score, proposedRole: 'related', verification: 'unverified', reasons });
    // Retain only bounded top candidates, even when a broad source cites many concepts.
    if (candidates.length >= limit * 2) candidates = candidates.sort(compare).slice(0, limit);
  }
  candidates.sort(compare);
  const identity = auditIdentity({ pages: active }, { limit });
  return { readOnly: true, scanned: concepts.length, total, truncated: Math.max(0, total - limit), candidates: candidates.slice(0, limit), identityReview: identity.findings.filter(f => f.kind !== 'invalid-placement'), identityFindingsTotal: identity.total,
    disclaimer: 'Candidates are unverified. Shared evidence or similarity does not establish claim entailment, identity, or a complementary relationship. Human review must choose a role and explanation.' };
}

// Existing vectors only: this read-only command never embeds or refreshes files.
function existingPageVectors(vaultPath) {
  const dir = join(vaultPath, '.wiki-master');
  const manifest = readManifestFile(dir), store = readVectorStore(dir), vectors = new Map();
  for (const [path, entry] of Object.entries(manifest)) {
    if (!path.startsWith('wiki/concepts/') || path.split('/').some(part => part.startsWith('.'))) continue;
    let stat;
    try { stat = statSync(join(vaultPath, path)); } catch { continue; }
    if (stat.mtimeMs !== entry.mtimeMs || stat.size !== entry.size) continue;
    const chunks = (entry.chunks ?? []).map(c => store[c.hash]).filter(v => v?.length);
    if (!chunks.length || chunks.some(v => v.length !== chunks[0].length)) continue;
    vectors.set(path, Array.from(chunks[0], (_, i) => chunks.reduce((sum, v) => sum + v[i], 0) / chunks.length));
  }
  return vectors;
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { vault: { type: 'string' }, limit: { type: 'string' }, seed: { type: 'string' }, since: { type: 'string' }, semantic: { type: 'boolean' }, json: { type: 'boolean' } } });
  const vaultPath = values.vault ?? resolveVault().path;
  const report = suggestRelationships(buildGraph(vaultPath), { limit: values.limit === undefined ? 20 : Number(values.limit), seed: values.seed, since: values.since, vectors: values.semantic ? existingPageVectors(vaultPath) : new Map() });
  console.log(values.json ? JSON.stringify(report, null, 2) : `${report.disclaimer}\nRelationship candidates: ${report.total} (${report.truncated} omitted)\n${report.candidates.map(c => `${c.from} ↔ ${c.to}\n  proposed ${c.proposedRole} (unverified): ${c.reasons.map(r => r.identity ?? r.kind).join(', ')}`).join('\n')}\nIdentity findings requiring review: ${report.identityFindingsTotal}`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
