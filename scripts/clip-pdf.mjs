import { existsSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { slugify, buildFrontmatter, knownSourceUrls } from './clip.mjs';

const THIN_WORD_FLOOR = 100;

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// A PDF has no HTML <title>; derive a human title from the filename.
export function titleFromPdf(pdfPath) {
  return basename(pdfPath).replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || 'untitled';
}

// Remove running headers/footers — the repeated title line and page-number
// footer that pdftotext emits at every page boundary, which otherwise get
// stitched mid-sentence into an otherwise-verbatim span. pdftotext separates
// pages with a form-feed (\f). A boundary line (first/last non-empty line of a
// page) that recurs — after digits are masked, so "5-70"/"5-71" collapse to one
// pattern — on at least half the pages is treated as running chrome and dropped.
export function stripRunningHeadersFooters(text) {
  const pages = String(text).split('\f');
  if (pages.length < 4) return pages.join('\n'); // too few pages to detect reliably
  const norm = (s) => s.trim().replace(/\d+/g, '#');
  const linesOf = (pg) => pg.split('\n');
  const nonEmptyIdx = (lines) => lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);

  const freq = new Map();
  for (const pg of pages) {
    const ne = nonEmptyIdx(linesOf(pg));
    if (!ne.length) continue;
    for (const i of [ne[0], ne[ne.length - 1]]) {
      const n = norm(linesOf(pg)[i]);
      freq.set(n, (freq.get(n) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.floor(pages.length * 0.5));
  const running = new Set([...freq].filter(([, c]) => c >= threshold).map(([n]) => n));

  return pages
    .map((pg) => {
      const lines = linesOf(pg);
      const ne = nonEmptyIdx(lines);
      if (ne.length) {
        const fi = ne[0], li = ne[ne.length - 1];
        if (running.has(norm(lines[fi]))) lines[fi] = '';
        if (li !== fi && running.has(norm(lines[li]))) lines[li] = '';
      }
      return lines.join('\n');
    })
    .join('\n');
}

// Detect extractions that pdftotext cannot render faithfully — chiefly math:
// symbol fonts whose glyphs have no Unicode mapping surface as '?' between
// alphanumerics ("x2 ? 1"), the replacement char, or (cid:NN) tokens. We can't
// fix these without OCR, but we can FLAG them so ingest paraphrases equations
// with attribution instead of quoting mangled text as if verbatim (guardrail #5).
export function assessFidelity(text) {
  const words = (text.match(/\S+/g) || []).length || 1;
  const mangledMath = (text.match(/[A-Za-z0-9)\]]\s?\?\s?[A-Za-z0-9(]/g) || []).length;
  const replacement = (text.match(/�/g) || []).length;
  const cid = (text.match(/\(cid:\d+\)/g) || []).length;
  // Degraded means "don't trust verbatim spans, paraphrase math". Calibrated so
  // math-heavy prose (many '?'-for-operator manglings) and glyph-dump PDFs
  // ((cid:NN) tokens, high replacement-char density) trip it, while a handful of
  // stray glyphs in figure captions of otherwise-clean prose does not.
  const degraded = mangledMath >= 8 || cid > 5 || replacement / words > 0.015;
  return { degraded, mangledMath, replacement, cid };
}

// Build the clipping note. Pure: no IO, no pdftotext — the testable core.
// We store the extracted TEXT as the canonical markdown representation; the
// binary PDF is never the source-of-truth note, so the vault stays greppable,
// diffable, and answerable, and `[[note]]` provenance resolves to real markdown.
export function pdfClipContent({ title, source, text, quality = 'medium', created = today(), extraction } = {}) {
  const cleaned = stripRunningHeadersFooters(text || '');
  const md = cleaned.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const fidelity = assessFidelity(md).degraded ? 'degraded' : 'high';
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, fidelity, extraction });
  return { md, wordCount: wordCount(md), fidelity, extraction, body: `${fm}\n\n${md}\n` };
}

// Extract text via poppler's pdftotext. execFileSync (not a shell) resolves the
// Windows .exe correctly; '-' writes to stdout. We deliberately do NOT pass
// -layout: it preserves physical layout, which on a two-column paper interleaves
// the columns line-by-line (unreadable, no traceable verbatim span). Default
// reading-order mode reads each column top-to-bottom and de-hyphenates line
// breaks, and still emits form-feeds between pages for header/footer stripping.
export function pdfToText(pdfPath) {
  // -enc UTF-8 is mandatory: pdftotext defaults to Latin-1 on some poppler builds,
  // and Node then decodes those bytes as UTF-8, turning every accent/bullet/© into
  // U+FFFD ("Béthune" → "B�thune"). Forcing UTF-8 output makes the decode correct.
  return execFileSync('pdftotext', ['-q', '-enc', 'UTF-8', pdfPath, '-'], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
}

function pdftotextReachable() {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}

export function ocrReachable() {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    execFileSync('tesseract', ['--version'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

// OCR path: rasterize each page with poppler's pdftoppm, then recognize with
// Tesseract. Recovers text the embedded-font layer mangles — dropped accents
// ("Béthune" → "B?thune"), symbol-font math, and fully scanned/image PDFs — at
// the cost of speed and OCR's own (different) error modes. Pages are joined with
// a form-feed so header/footer stripping still applies. Tesseract's automatic
// page segmentation handles columns, so this also survives two-column layouts.
export function pdfToTextOcr(pdfPath, { dpi = 300, lang = 'eng' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clip-ocr-'));
  try {
    execFileSync('pdftoppm', ['-png', '-r', String(dpi), pdfPath, join(dir, 'page')], { stdio: 'ignore' });
    const imgs = readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .sort((a, b) => (+(a.match(/-(\d+)\.png$/)?.[1] || 0)) - (+(b.match(/-(\d+)\.png$/)?.[1] || 0)));
    const pages = imgs.map((f) =>
      execFileSync('tesseract', [join(dir, f), 'stdout', '-l', lang], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    );
    return pages.join('\f');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function main(argv) {
  const pdfPath = argv[0];
  if (!pdfPath) {
    console.error('usage: clip-pdf.mjs <file.pdf> [--source="<url-or-path>"] [--quality=high|medium|low] [--ocr] [--ocr-lang=eng] [--decline="reason"]');
    process.exit(2);
  }
  const srcArg = argv.find((a) => a.startsWith('--source='));
  const source = srcArg ? srcArg.split('=').slice(1).join('=') : pdfPath;
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';

  const { path: vaultPath } = resolveVault();

  const declineArg = argv.find((a) => a.startsWith('--decline='));
  if (declineArg) {
    const reason = declineArg.slice('--decline='.length) || 'declined';
    recordDecline(vaultPath, source, reason);
    console.log(`declined (recorded): ${source} — ${reason}`);
    return { status: 'declined' };
  }

  const declines = loadDeclines(vaultPath);
  if (isDeclined(source, declines)) {
    const e = declines.find((d) => isDeclined(source, [d]));
    console.log(`declined previously (${e.date}: ${e.reason}): ${source}`);
    return { status: 'declined' };
  }

  if (isDuplicateUrl(source, knownSourceUrls(vaultPath))) {
    console.log(`duplicate (already clipped): ${source}`); return { status: 'duplicate' };
  }

  if (!existsSync(pdfPath)) { console.error(`file not found: ${pdfPath}`); process.exit(2); }

  const title = titleFromPdf(pdfPath);
  const forceOcr = argv.includes('--ocr');
  const langArg = argv.find((a) => a.startsWith('--ocr-lang='));
  const lang = langArg ? langArg.split('=')[1] : 'eng';

  let clip;
  if (forceOcr) {
    if (!ocrReachable()) {
      console.error('OCR needs poppler (pdftoppm) + Tesseract. Install Tesseract: https://github.com/UB-Mannheim/tesseract/wiki');
      process.exit(1);
    }
    console.log('OCR: rasterizing + recognizing pages (this is slow)…');
    clip = pdfClipContent({ title, source, text: pdfToTextOcr(pdfPath, { lang }), quality, extraction: 'ocr' });
  } else {
    let text;
    try { text = pdfToText(pdfPath); }
    catch {
      if (!pdftotextReachable()) {
        console.error('pdftotext (poppler) not found. Install poppler: https://poppler.freedesktop.org/');
        process.exit(1);
      }
      text = ''; // per-URL extraction failure — fall through to the OCR fallback below
    }
    clip = pdfClipContent({ title, source, text, quality });
    // Auto-fallback: a thin text layer means a scanned/image PDF (or a broken
    // font layer) — exactly OCR's job. Only replace if OCR actually recovers text.
    if (clip.wordCount < THIN_WORD_FLOOR && ocrReachable()) {
      console.log('thin text layer — falling back to OCR (slow)…');
      const oclip = pdfClipContent({ title, source, text: pdfToTextOcr(pdfPath, { lang }), quality, extraction: 'ocr' });
      if (oclip.wordCount >= THIN_WORD_FLOOR) clip = oclip;
    }
  }

  if (clip.wordCount < THIN_WORD_FLOOR) {
    recordDecline(vaultPath, source, 'thin text (scanned/encrypted; OCR unavailable or also failed)');
    console.log(`thin content (OCR unavailable/failed; decline recorded): ${pdfPath}`);
    return { status: 'thin' };
  }

  const slug = slugify(title);
  const file = join(vaultPath, 'raw', 'clippings', `${slug}.md`);
  if (existsSync(file)) { console.log(`exists (slug clash): ${slug}`); return { status: 'duplicate' }; }

  writeFileSync(file, clip.body);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality}, ${clip.extraction === 'ocr' ? 'OCR' : 'text'})`);
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
