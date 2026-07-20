import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, computeGraphMetrics, isContent } from './lib/graph.mjs';

// Health reads the vault filesystem directly — no Obsidian CLI. The CLI's
// orphan/deadend verdicts are computed WITH structural files' links included
// (index.md links everything, so nothing ever looks orphaned) and it offers no
// source-side exclusion, so its answer cannot be corrected after the fact.
export { isContent };

export function computeHealth({ orphans, deadEnds, brokenLinks, hubStubs, unparsedSources = [], declaredStubs = [], brokenClass = null }) {
  // Broken links are triaged (see classifyBrokenLinks): defects (typo/rename —
  // real bugs) and stale (abandoned low-demand forward-links) are penalized;
  // deferred forward-links are healthy by design and cost nothing. Callers
  // without a classification fall back to treating every broken link as a defect.
  const defects = brokenClass ? brokenClass.defects : brokenLinks;
  const stale = brokenClass ? brokenClass.stale : [];
  const deferred = brokenClass ? brokenClass.deferred : [];

  // Independent, individually-capped penalties, then summed (avoids saturation).
  const penalty =
    Math.min(30, defects.length * 3) +
    Math.min(15, stale.length * 2) +
    Math.min(25, orphans.length * 2) +
    Math.min(20, deadEnds.length * 2) +
    Math.min(15, hubStubs.length * 5);
  const score = Math.max(0, 100 - penalty);

  const list = (arr, fmt) => (arr.length ? `\n    ${arr.map(fmt).join('\n    ')}` : '');
  const DEFERRED_SHOWN = 20;
  const report =
    `Wiki health: ${score}/100 (scanned from filesystem)\n` +
    `  broken links: ${brokenLinks.length} (defect ${defects.length} · stale ${stale.length} · deferred ${deferred.length})` +
    (defects.length ? `\n  defects (fix — typo/rename):` : '') +
    list(defects, (b) => `${b.target}  <- ${b.source}${b.suggest ? `   (did you mean [[${b.suggest}]]?)` : ''}`) +
    (stale.length ? `\n  stale (prune or promote):` : '') +
    list(stale, (b) => `${b.target}  <- ${b.source}   (${b.ageDays}d, refs ${b.refs})`) +
    (deferred.length ? `\n  deferred (healthy forward-links):` : '') +
    list(deferred.slice(0, DEFERRED_SHOWN), (b) => `${b.target}  <- ${b.source}`) +
    (deferred.length > DEFERRED_SHOWN ? `\n    … and ${deferred.length - DEFERRED_SHOWN} more` : '') +
    `\n  orphans:      ${orphans.length}\n` +
    `  dead-ends:    ${deadEnds.length}\n` +
    `  hub-stubs:    ${hubStubs.length}` +
    (hubStubs.length ? `\n    ${hubStubs.join('\n    ')}` : '') +
    `\n  declared stubs (not scored): ${declaredStubs.length}` +
    (declaredStubs.length ? `\n    ${declaredStubs.join('\n    ')}` : '') +
    `\n  unparsed raw sources (not scored): ${unparsedSources.length}` +
    (unparsedSources.length ? `\n    ${unparsedSources.join('\n    ')}` : '');
  return { score, orphans, deadEnds, brokenLinks, hubStubs, unparsedSources, declaredStubs, brokenClass, report };
}

export function main() {
  const { path: vaultPath } = resolveVault();
  const metrics = computeGraphMetrics(buildGraph(vaultPath), { now: new Date() });
  const r = computeHealth(metrics);
  console.log(r.report);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
