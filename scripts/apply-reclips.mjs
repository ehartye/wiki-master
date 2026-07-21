// Perform the re-clips that triage dispositions asked for.
//
// A `reclip` disposition closed the issue but never did the work, so requests
// piled up invisibly (30 sources, one of them dispositioned three times). This
// closes the loop: fold the log for what was asked, derive from the vault what is
// still needed, re-extract via the right clipper, and carry the content hash
// forward so the re-clipped source is not orphaned.
//
//   node scripts/apply-reclips.mjs                          # dry run
//   node scripts/apply-reclips.mjs --apply
//   node scripts/apply-reclips.mjs --apply --from=~/Downloads
//
// --from is for sources you had to fetch by hand (a paywall, a 403). Files there
// are matched to a pending re-clip by the clipping's TITLE, because a DOI URL
// carries no filename to match on.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveVault } from './lib/vault.mjs';
import { loadIssueLog, pendingReclips, recordIssue } from './lib/triage.mjs';
import { matchLocalFile } from './lib/migrate.mjs';
import { swapSourceHash } from './lib/repoint.mjs';
import { splitBody } from './refresh-fidelity.mjs';
import {
  pdfToText, pdfToTextOcr, pdfClipContent, assessFidelity, ocrReachable,
  shouldTryOcr, preferBetterExtraction,
} from './clip-pdf.mjs';
import { docxToText } from './clip-docx.mjs';
import { xlsxToText } from './clip-xlsx.mjs';

const apply = process.argv.includes('--apply');
const limArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limArg ? Number(limArg.slice(8)) : Infinity;
// Where to look for hand-downloaded sources. A paywalled PDF cannot be fetched,
// so you retrieve it yourself; this is how the pass finds it. Matched by clipping
// TITLE, since a DOI URL carries no filename to match on.
const FROM = process.argv.find((a) => a.startsWith('--from='))?.slice(7);
const fromFiles = FROM ? readdirSync(FROM, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : [];
const { path: vault } = resolveVault();
const norm = (s) => String(s ?? '').replace(/\\\\/g, '\\').toLowerCase();
const field = (fm, k) => (new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, 'm').exec(fm) || [])[1];

// Index clippings by their recorded source so a disposition (keyed by URL) finds
// the note it refers to.
const clipDir = join(vault, 'raw', 'clippings');
const bySource = new Map();
for (const f of readdirSync(clipDir)) {
  if (!f.endsWith('.md')) continue;
  const text = readFileSync(join(clipDir, f), 'utf8');
  const src = field(text.slice(0, 1500), 'source');
  if (src) bySource.set(norm(src), { file: f, text });
}

async function localCopy(url) {
  if (!/^https?:\/\//i.test(url)) return existsSync(url) ? url : null;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ext = extname(new URL(url).pathname) || '.pdf';
  const p = join(mkdtempSync(join(tmpdir(), 'wm-reclip-')), `src${ext}`);
  writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  return p;
}

function extract(path, meta) {
  const e = extname(path).toLowerCase();
  if (/\.(docx?|doc)$/.test(e)) return pdfClipContent({ ...meta, text: docxToText(path) });
  if (/\.(xlsx?|xlsm)$/.test(e)) return pdfClipContent({ ...meta, text: xlsxToText(path) });
  // PDF: same quality-gated OCR escalation the clipper uses.
  let clip = pdfClipContent({ ...meta, text: pdfToText(path) });
  if (shouldTryOcr(clip) && ocrReachable()) {
    clip = preferBetterExtraction(clip, pdfClipContent({ ...meta, text: pdfToTextOcr(path), extraction: 'ocr' }));
  }
  return clip;
}

const report = { asked: 0, alreadyResolved: 0, reclipped: 0, usedLocal: 0, stillDegraded: [], failed: [], noClipping: [] };
const targets = pendingReclips(loadIssueLog(vault));
report.asked = targets.length;

for (const { url, file } of targets.slice(0, LIMIT)) {
  const hit = bySource.get(norm(url));
  if (!hit) { report.noClipping.push(url); continue; }
  // "Already done" is DERIVED: if the clipping reads clean, the re-clip is moot.
  if (!assessFidelity(splitBody(hit.text)).degraded) { report.alreadyResolved++; continue; }
  if (!apply) { report.reclipped++; continue; }

  try {
    const fm = hit.text.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
    const oldHash = field(fm, 'source-hash');
    const title = field(fm, 'title');
    // A hand-downloaded copy wins over the URL: it is why you downloaded it, and
    // re-fetching a paywalled source would only 403 again.
    // Precedence: a file you picked in the UI (exact, no inference) > a match in
    // --from (title-based, can be ambiguous) > re-fetching the URL (403s on a
    // paywall, which is why you picked the file in the first place).
    const picked = file && existsSync(file) ? file : null;
    const local = !picked && FROM ? matchLocalFile(title, fromFiles) : null;
    const path = picked ?? (local ? join(FROM, local) : await localCopy(url));
    if (!path) { report.failed.push({ url, reason: 'source file not found locally' }); continue; }
    if (picked || local) report.usedLocal++;
    const clip = extract(path, {
      title, source: field(fm, 'source'),
      quality: field(fm, 'quality') || 'medium', created: field(fm, 'created'),
    });
    if (assessFidelity(clip.md).degraded) {
      // Never trade a known-bad extraction for another one — and reopen, so the
      // request does not sit silently behind a disposition that could not be met.
      report.stillDegraded.push({ url, clipping: hit.file });
      recordIssue(vault, { url, kind: 'fidelity', reason: 're-clip attempted; extraction still degraded' });
      continue;
    }
    writeFileSync(join(clipDir, hit.file), clip.body);
    let moved = 0;
    const sdir = join(vault, 'wiki', 'sources');
    for (const f of readdirSync(sdir)) {
      if (!f.endsWith('.md')) continue;
      const sp = join(sdir, f);
      const t = readFileSync(sp, 'utf8');
      const out = swapSourceHash(t, oldHash, clip.hash);
      if (out !== t) { writeFileSync(sp, out); moved++; }
    }
    report.reclipped++;
    console.log(`reclipped ${hit.file} (${moved} summary hash${moved === 1 ? '' : 'es'} updated)`);
  } catch (e) {
    // Could not obtain the source at all (403, paywall, moved). That leaves no
    // artifact in the vault, so it belongs in the log — as a `failed` fetch, which
    // is what it now is, and which reopens the item for a different decision.
    const reason = String(e.message || e).slice(0, 120);
    report.failed.push({ url, reason });
    recordIssue(vault, { url, kind: 'failed', reason: `re-clip could not fetch source: ${reason}` });
  }
}

console.log(JSON.stringify({
  type: 'apply-reclips', applied: apply, ...report,
  stillDegraded: report.stillDegraded.length, failed: report.failed.length, noClipping: report.noClipping.length,
}));
for (const k of ['stillDegraded', 'failed', 'noClipping']) {
  if (report[k].length) console.log(JSON.stringify({ [k]: report[k].slice(0, 10) }, null, 2));
}
if (!apply) console.error('dry run — re-run with --apply to perform the re-clips');
