import { existsSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { existingClippingWithHash, readClippingHashes } from './lib/dedupe.mjs';
import { slugify, buildFrontmatter, knownSourceUrls, disambiguateSlug } from './clip.mjs';

const THIN_WORD_FLOOR = 100;

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// A workbook carries no title worth trusting; derive one from the filename, as the
// PDF and DOCX clippers do.
export function titleFromXlsx(xlsxPath) {
  return basename(xlsxPath).replace(/\.(xlsx?|xlsm)$/i, '').replace(/[_]+/g, ' ').trim() || 'untitled';
}

// Build the clipping note. Pure: no IO, no converters — the testable core. Mirrors
// docxClipContent. A spreadsheet's content is its tables, so the markdown table is
// the canonical representation; the binary workbook never enters the vault.
export function xlsxClipContent({ title, source, text, quality = 'medium', created = today() } = {}) {
  const md = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash });
  return { md, wordCount: wordCount(md), hash, body: `${fm}\n\n${md}\n` };
}

// Convert through HTML rather than CSV: LibreOffice's csv export emits only the
// FIRST sheet, silently dropping the rest of a workbook, while its html export
// renders every sheet as a table. pandoc then turns those tables into markdown —
// the same tool the docx path already relies on. `soffice` is called by bare name
// so PATHEXT selects the console shim (soffice.com); soffice.exe is the GUI build
// and writes nothing to stdout.
export function xlsxToText(xlsxPath) {
  const dir = mkdtempSync(join(tmpdir(), 'clip-xlsx-'));
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'html', '--outdir', dir, xlsxPath], { stdio: 'ignore' });
    const html = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.html'));
    if (!html) throw new Error('conversion produced no html');
    return execFileSync('pandoc', [join(dir, html), '-f', 'html', '-t', 'markdown', '--wrap=none'], {
      encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sofficeReachable() {
  try { execFileSync('soffice', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

export function main(argv) {
  const xlsxPath = argv[0];
  if (!xlsxPath) {
    console.error('usage: clip-xlsx.mjs <file.xlsx> [--source="<url-or-path>"] [--quality=high|medium|low] [--decline="reason"]');
    process.exit(2);
  }
  const srcArg = argv.find((a) => a.startsWith('--source='));
  const source = srcArg ? srcArg.split('=').slice(1).join('=') : xlsxPath;
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

  if (!existsSync(xlsxPath)) { console.error(`file not found: ${xlsxPath}`); process.exit(2); }

  let text;
  try { text = xlsxToText(xlsxPath); }
  catch {
    // Distinguish "converter missing" (fatal — fix the install) from "this file
    // failed" (skip, so batch runs continue).
    if (!sofficeReachable()) {
      console.error('LibreOffice (soffice) not found. Install it: https://www.libreoffice.org/download/');
      process.exit(1);
    }
    console.log(`extraction failed (corrupt/protected workbook — clip manually): ${xlsxPath}`);
    return { status: 'failed' };
  }

  const title = titleFromXlsx(xlsxPath);
  const clip = xlsxClipContent({ title, source, text, quality });

  if (clip.wordCount < THIN_WORD_FLOOR) {
    recordDecline(vaultPath, source, 'thin content (empty/near-empty workbook)');
    console.log(`thin content (decline recorded): ${xlsxPath}`);
    return { status: 'thin' };
  }

  const dir = join(vaultPath, 'raw', 'clippings');

  // isDuplicateUrl only catches a re-clip of the same PATH; a moved or renamed
  // workbook slips past it and the slug disambiguation below then mints a second
  // file for content the vault already holds. Identity is the extracted body's
  // hash, which does not care where the workbook lives.
  const already = existingClippingWithHash(readClippingHashes(dir), clip.hash);
  if (already) {
    console.log(`exists (same content): ${already}`);
    return { status: 'duplicate', file: already };
  }

  // A slug collision that is NOT a hash match is a DIFFERENT workbook sharing a
  // title. Disambiguate rather than drop.
  const taken = new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3).toLowerCase()));
  const slug = disambiguateSlug(slugify(title), clip.hash, (s) => taken.has(s.toLowerCase()));
  const file = join(dir, `${slug}.md`);

  writeFileSync(file, clip.body);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality}, xlsx)`);
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
