import { existsSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
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

// Build the clipping note. Pure: no IO, no pdftotext — the testable core.
// We store the extracted TEXT as the canonical markdown representation; the
// binary PDF is never the source-of-truth note, so the vault stays greppable,
// diffable, and answerable, and `[[note]]` provenance resolves to real markdown.
export function pdfClipContent({ title, source, text, quality = 'medium', created = today() }) {
  const md = String(text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash });
  return { md, wordCount: wordCount(md), body: `${fm}\n\n${md}\n` };
}

// Extract text via poppler's pdftotext. execFileSync (not a shell) resolves the
// Windows .exe correctly; -layout keeps reading order, '-' writes to stdout.
export function pdfToText(pdfPath) {
  return execFileSync('pdftotext', ['-q', '-layout', pdfPath, '-'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

function pdftotextReachable() {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}

export function main(argv) {
  const pdfPath = argv[0];
  if (!pdfPath) {
    console.error('usage: clip-pdf.mjs <file.pdf> [--source="<url-or-path>"] [--quality=high|medium|low] [--decline="reason"]');
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

  let text;
  try { text = pdfToText(pdfPath); }
  catch {
    if (!pdftotextReachable()) {
      console.error('pdftotext (poppler) not found. Install poppler: https://poppler.freedesktop.org/');
      process.exit(1);
    }
    console.log(`extract failed (scanned/encrypted — OCR manually): ${pdfPath}`);
    return { status: 'failed' };
  }

  const title = titleFromPdf(pdfPath);
  const clip = pdfClipContent({ title, source, text, quality });
  if (clip.wordCount < THIN_WORD_FLOOR) {
    recordDecline(vaultPath, source, 'thin text (likely scanned/image PDF — needs OCR)');
    console.log(`thin content (OCR manually; decline recorded): ${pdfPath}`);
    return { status: 'thin' };
  }

  const slug = slugify(title);
  const file = join(vaultPath, 'raw', 'clippings', `${slug}.md`);
  if (existsSync(file)) { console.log(`exists (slug clash): ${slug}`); return { status: 'duplicate' }; }

  writeFileSync(file, clip.body);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality}, from PDF)`);
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
