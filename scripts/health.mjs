import { obsidian, assertRunning } from './lib/vault.mjs';
import { pathToFileURL } from 'node:url';

const STUB_WORD_FLOOR = 10;
const HUB_MIN_BACKLINKS = 5;

export function computeHealth({ orphans, deadEnds, brokenLinks, backlinkCounts, wordCounts }) {
  // Hub-stub: heavily linked ("hub") but nearly empty ("stub"). Absolute rule —
  // robust at personal scale where μ+2σ is dominated by a single outlier.
  const hubStubs = Object.keys(backlinkCounts).filter(
    (p) => backlinkCounts[p] >= HUB_MIN_BACKLINKS && (wordCounts[p] ?? 0) < STUB_WORD_FLOOR
  );
  // Independent, individually-capped penalties, then summed (avoids saturation).
  const penalty =
    Math.min(30, brokenLinks.length * 3) +
    Math.min(25, orphans.length * 2) +
    Math.min(20, deadEnds.length * 2) +
    Math.min(15, hubStubs.length * 5);
  const score = Math.max(0, 100 - penalty);
  const report =
    `Wiki health: ${score}/100\n` +
    `  broken links: ${brokenLinks.length}\n` +
    `  orphans:      ${orphans.length}\n` +
    `  dead-ends:    ${deadEnds.length}\n` +
    `  hub-stubs:    ${hubStubs.length}` +
    (hubStubs.length ? `\n    ${hubStubs.join('\n    ')}` : '');
  return { score, orphans, deadEnds, brokenLinks, hubStubs, report };
}

// The list commands print a prose message ("No orphans found.") when empty —
// which must NOT be counted as a result row.
export function parseListOutput(out) {
  if (!out) return [];
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((l) => !/^no\b.*\bfound\b/i.test(l));
}

// Structural/system files legitimately have no links; they are not wiki content
// and must not be penalised as orphans or dead-ends.
const SYSTEM_FILES = new Set(['index.md', 'log.md', 'vault-schema.md']);
export function isContent(path) {
  if (!path.endsWith('.md')) return false;         // e.g. stale.base
  if (SYSTEM_FILES.has(path)) return false;        // catalog / log / schema
  if (path.startsWith('_templates/')) return false; // Obsidian templates
  return true;
}

export function main() {
  assertRunning();
  const orphans = parseListOutput(obsidian(['orphans'])).filter(isContent);
  const deadEnds = parseListOutput(obsidian(['deadends'])).filter(isContent);
  const brokenLinks = parseListOutput(obsidian(['unresolved']));
  const files = parseListOutput(obsidian(['files', 'ext=md'])).filter((p) => p.startsWith('wiki/'));
  const backlinkCounts = {};
  const wordCounts = {};
  for (const p of files) {
    try { backlinkCounts[p] = Number(obsidian(['backlinks', `path=${p}`, 'total'])) || 0; }
    catch { backlinkCounts[p] = 0; }
    try { wordCounts[p] = Number(obsidian(['wordcount', `path=${p}`, 'words'])) || 0; }
    catch { wordCounts[p] = 0; }
  }
  const r = computeHealth({ orphans, deadEnds, brokenLinks, backlinkCounts, wordCounts });
  console.log(r.report);
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
