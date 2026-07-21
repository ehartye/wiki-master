// Repair pass: a wiki/sources page that cites a binary has no readable provenance,
// because binaries are never in the vault. Clip the binary IN PLACE — wherever it
// lives on disk — into a `.md` clipping, then repoint the summary at that clipping
// and stamp its `source-hashes`.
//
// The directory holding the binaries is always passed in; it is never a location
// this tool knows about or manages.
//
//   node scripts/clip-and-repoint.mjs --from=<dir>            # dry run
//   node scripts/clip-and-repoint.mjs --from=<dir> --apply
//   node scripts/clip-and-repoint.mjs --from=<dir> --apply --limit=5
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, computeGraphMetrics } from './lib/graph.mjs';
import { repointCitation } from './lib/repoint.mjs';
import { insertSourceHashes } from './lib/backfill.mjs';
import { recordIssue } from './lib/triage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const FROM = arg('from');
const apply = process.argv.includes('--apply');
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity;
if (!FROM) {
  console.error('usage: clip-and-repoint.mjs --from=<dir holding the binaries> [--apply] [--limit=N]');
  process.exit(2);
}

const { path: vault } = resolveVault();
const BINARY = /\.(pdf|docx?|xlsx|zip)$/i;

// Index the source directory by lowercased basename.
const byBase = new Map();
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    statSync(p).isDirectory() ? walk(p) : byBase.set(e.toLowerCase(), p);
  }
})(FROM);

// Dangling binary citations, grouped by the cited target.
const metrics = computeGraphMetrics(buildGraph(vault), { now: new Date() });
const citersOf = new Map();
for (const { source, target } of metrics.brokenLinks) {
  if (!BINARY.test(target)) continue;
  if (!citersOf.has(target)) citersOf.set(target, []);
  citersOf.get(target).push(source);
}

const frontmatter = (abs) => {
  const head = readFileSync(abs, 'utf8').slice(0, 2000);
  const fm = head.startsWith('---') ? head.slice(3, head.indexOf('\n---', 3)) : '';
  return {
    hash: /^source-hash:\s*"?([0-9a-fA-F]{6,64})"?/m.exec(fm)?.[1]?.toLowerCase(),
    fidelity: /^fidelity:\s*"?([\w-]+)"?/m.exec(fm)?.[1] ?? 'high',
  };
};

// A re-run must not re-clip: find a clipping already produced from this binary.
function existingClip(binAbs) {
  const dir = join(vault, 'raw', 'clippings');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const head = readFileSync(join(dir, f), 'utf8').slice(0, 600);
    if (head.includes(binAbs.replace(/\\/g, '\\\\')) || head.includes(binAbs)) return `raw/clippings/${f}`;
  }
  return null;
}

const report = { targets: citersOf.size, clipped: 0, reused: 0, repointed: 0, degraded: [], missing: [], failed: [] };

for (const [target, citers] of [...citersOf].slice(0, LIMIT)) {
  const base = target.split('/').pop().toLowerCase();
  const binAbs = byBase.get(base);
  if (!binAbs) { report.missing.push(target); continue; }
  if (!apply) { report.clipped++; continue; }

  let clipRel = existingClip(binAbs);
  if (clipRel) report.reused++;
  else {
    const script = /\.docx?$/i.test(binAbs) ? 'clip-docx.mjs'
      : /\.(xlsx?|xlsm)$/i.test(binAbs) ? 'clip-xlsx.mjs'
      : 'clip-pdf.mjs';
    try {
      const out = execFileSync(process.execPath, [join(HERE, script), binAbs, `--source=${binAbs}`], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      });
      clipRel = /clipped:\s*(raw\/clippings\/.+\.md)/.exec(out)?.[1];
    } catch (e) {
      report.failed.push({ target, reason: String(e.message || e).slice(0, 140) });
      continue;
    }
    if (!clipRel) { report.failed.push({ target, reason: 'clipper produced no clipping (thin/declined)' }); continue; }
    report.clipped++;
  }

  const { hash, fidelity } = frontmatter(join(vault, clipRel));
  if (!hash) { report.failed.push({ target, reason: 'clipping has no source-hash' }); continue; }

  // Repoint every citing summary. A degraded clipping is still repointed: it is the
  // best available reading, its `fidelity:` records the caveat, and leaving the
  // citation dangling would be strictly worse. The issue goes to triage instead.
  for (const page of citers) {
    const abs = join(vault, page);
    let text = readFileSync(abs, 'utf8');
    text = repointCitation(text, target, clipRel);
    text = insertSourceHashes(text, [hash]);
    writeFileSync(abs, text);
    report.repointed++;
  }
  if (fidelity !== 'high') {
    report.degraded.push({ target, clip: clipRel, fidelity });
    try { recordIssue(vault, { url: binAbs, kind: 'fidelity', reason: `extraction ${fidelity} after OCR escalation` }); } catch {}
  }
}

console.log(JSON.stringify({
  type: 'clip-and-repoint', applied: apply, from: FROM,
  ...report, degraded: report.degraded.length, missing: report.missing.length, failed: report.failed.length,
}));
for (const k of ['degraded', 'missing', 'failed']) {
  if (report[k].length) console.log(JSON.stringify({ [k]: report[k].slice(0, 10) }, null, 2));
}
if (!apply) console.error('dry run — re-run with --apply to clip and repoint');
