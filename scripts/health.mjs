import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, computeGraphMetrics, isContent } from './lib/graph.mjs';

// Health reads the vault filesystem directly — no Obsidian CLI. A CLI answer
// like "0 orphans" cannot be distinguished from a broken CLI (wrong binary,
// app not running, index mid-rebuild), and its orphan/deadend verdicts are
// computed WITH structural files' links included, which we cannot exclude
// after the fact. The filesystem is ground truth and cannot silently be empty.
export { isContent };

export function computeHealth({ orphans, deadEnds, brokenLinks, hubStubs, unparsedSources = [], declaredStubs = [] }) {
  // Independent, individually-capped penalties, then summed (avoids saturation).
  const penalty =
    Math.min(30, brokenLinks.length * 3) +
    Math.min(25, orphans.length * 2) +
    Math.min(20, deadEnds.length * 2) +
    Math.min(15, hubStubs.length * 5);
  const score = Math.max(0, 100 - penalty);
  const report =
    `Wiki health: ${score}/100 (scanned from filesystem)\n` +
    `  broken links: ${brokenLinks.length}` +
    (brokenLinks.length ? `\n    ${brokenLinks.map((b) => `${b.target}  <- ${b.source}`).join('\n    ')}` : '') +
    `\n  orphans:      ${orphans.length}\n` +
    `  dead-ends:    ${deadEnds.length}\n` +
    `  hub-stubs:    ${hubStubs.length}` +
    (hubStubs.length ? `\n    ${hubStubs.join('\n    ')}` : '') +
    `\n  declared stubs (not scored): ${declaredStubs.length}` +
    (declaredStubs.length ? `\n    ${declaredStubs.join('\n    ')}` : '') +
    `\n  unparsed raw sources (not scored): ${unparsedSources.length}` +
    (unparsedSources.length ? `\n    ${unparsedSources.join('\n    ')}` : '');
  return { score, orphans, deadEnds, brokenLinks, hubStubs, unparsedSources, declaredStubs, report };
}

export function main() {
  const { path: vaultPath } = resolveVault();
  const metrics = computeGraphMetrics(buildGraph(vaultPath));
  const r = computeHealth(metrics);
  console.log(r.report);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
