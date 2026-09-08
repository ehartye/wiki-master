import { obsidianJson, assertRunning } from './lib/vault.mjs';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;
const THRESHOLDS = { fresh: 30, aging: 90, stale: 180 }; // days; beyond stale => rotten

function ageDays(page, today) {
  const reviewed = page.reviewed ? new Date(page.reviewed).getTime() : NaN;
  if (!Number.isFinite(reviewed)) return Infinity;
  return (today.getTime() - reviewed) / DAY;
}

export function computeStale(pages, { today = new Date() } = {}) {
  const buckets = { fresh: [], aging: [], stale: [], rotten: [] };
  const missingReview = [];
  for (const p of pages) {
    const age = ageDays(p, today);
    if (!Number.isFinite(age)) missingReview.push(p.path);
    const withAge = { ...p, ageDays: age };
    if (age < THRESHOLDS.fresh) buckets.fresh.push(withAge);
    else if (age < THRESHOLDS.aging) buckets.aging.push(withAge);
    else if (age < THRESHOLDS.stale) buckets.stale.push(withAge);
    else buckets.rotten.push(withAge);
  }
  const report =
    `Freshness: fresh ${buckets.fresh.length} · aging ${buckets.aging.length} · ` +
    `stale ${buckets.stale.length} · rotten ${buckets.rotten.length} · missing review ${missingReview.length}`;
  return { buckets, report, missingReview };
}

// Reads pages via the native Bases dashboard (stale.base view "all").
export function main() {
  assertRunning();
  const rows = obsidianJson(['base:query', 'file=stale.base', 'view=all']) || [];
  const pages = rows.map((r) => ({
    path: r['file.path'] ?? r.path ?? r.file,
    reviewed: r.reviewed,
    updated: r.updated,
    type: r.type,
  }));
  const r = computeStale(pages, {});
  console.log(r.report);
  for (const p of [...r.buckets.stale, ...r.buckets.rotten]) {
    console.log(`  ${Number.isFinite(p.ageDays) ? `${Math.round(p.ageDays)}d` : 'missing review'}  ${p.path}`);
  }
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
