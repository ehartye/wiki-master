import { obsidian, assertRunning } from './lib/vault.mjs';
import { pathToFileURL } from 'node:url';

const STUB_WORD_FLOOR = 10;

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function computeHealth({ orphans, deadEnds, brokenLinks, backlinkCounts, wordCounts }) {
  const counts = Object.values(backlinkCounts);
  const threshold = mean(counts) + 2 * stddev(counts);
  const hubStubs = Object.keys(backlinkCounts).filter(
    (p) => backlinkCounts[p] > threshold && (wordCounts[p] ?? 0) < STUB_WORD_FLOOR
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

function lines(out) { return out ? out.split(/\r?\n/).filter(Boolean) : []; }

export function main() {
  assertRunning();
  const orphans = lines(obsidian(['orphans']));
  const deadEnds = lines(obsidian(['deadends']));
  const brokenLinks = lines(obsidian(['unresolved']));
  const files = lines(obsidian(['files', 'ext=md'])).filter((p) => p.startsWith('wiki/'));
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
