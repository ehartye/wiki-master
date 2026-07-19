import { existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { slugify, buildFrontmatter, knownSourceUrls, disambiguateSlug } from './clip.mjs';

const THIN_WORD_FLOOR = 100;

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// A Word document has no HTML <title>; derive a human title from the filename.
// Handles both .docx (modern) and .doc (legacy) extensions.
export function titleFromDocx(docxPath) {
  return basename(docxPath).replace(/\.docx?$/i, '').replace(/[_]+/g, ' ').trim() || 'untitled';
}

// Build the clipping note. Pure: no IO, no pandoc — the testable core. The
// extracted TEXT is stored as the canonical markdown representation (never the
// binary .docx), so the vault stays greppable, diffable, and answerable, and
// `[[note]]` provenance resolves to a real markdown clipping. Mirrors
// clip-pdf's pdfClipContent, minus the PDF-only concerns: a .docx has no fixed
// pages (so no running header/footer to strip) and pandoc reads its XML directly
// (so there is no math-font mangling to flag as fidelity: degraded).
export function docxClipContent({ title, source, text, quality = 'medium', created = today() } = {}) {
  const md = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash });
  return { md, wordCount: wordCount(md), hash, body: `${fm}\n\n${md}\n` };
}

// Extract text via pandoc. execFileSync (not a shell) resolves the Windows .exe
// correctly. `-t plain` strips markup to quotable prose; `--wrap=none` prevents
// pandoc from hard-wrapping paragraphs at 72 columns, which would otherwise break
// any verbatim span across a synthetic line break. pandoc reads the docx XML in
// reading order, so columns/tables come out coherent without the two-column
// interleaving that forces `-layout` avoidance in the PDF path.
export function docxToText(docxPath) {
  return execFileSync('pandoc', [docxPath, '-t', 'plain', '--wrap=none'], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
}

function pandocReachable() {
  try { execFileSync('pandoc', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}

export function main(argv) {
  const docxPath = argv[0];
  if (!docxPath) {
    console.error('usage: clip-docx.mjs <file.docx> [--source="<url-or-path>"] [--quality=high|medium|low] [--decline="reason"]');
    process.exit(2);
  }
  const srcArg = argv.find((a) => a.startsWith('--source='));
  const source = srcArg ? srcArg.split('=').slice(1).join('=') : docxPath;
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

  if (!existsSync(docxPath)) { console.error(`file not found: ${docxPath}`); process.exit(2); }

  let text;
  try { text = docxToText(docxPath); }
  catch {
    // Distinguish "pandoc not installed" (fatal) from "this file failed" (skip, so
    // batch runs continue). A per-file failure is usually a corrupt or
    // password-protected document.
    if (!pandocReachable()) {
      console.error('pandoc not found. Install pandoc: https://pandoc.org/installing.html');
      process.exit(1);
    }
    console.log(`extraction failed (corrupt/protected docx — clip manually): ${docxPath}`);
    return { status: 'failed' };
  }

  const title = titleFromDocx(docxPath);
  const clip = docxClipContent({ title, source, text, quality });

  if (clip.wordCount < THIN_WORD_FLOOR) {
    recordDecline(vaultPath, source, 'thin text (empty/near-empty docx)');
    console.log(`thin content (decline recorded): ${docxPath}`);
    return { status: 'thin' };
  }

  // Same-source re-clips are already caught by isDuplicateUrl above, so a slug
  // collision here is a DIFFERENT document sharing a title (or a case-variant).
  // Disambiguate rather than drop — silently losing a distinct source is worse
  // than a suffixed slug. Case-insensitive to match the filesystem and Obsidian's
  // wikilink resolution.
  const dir = join(vaultPath, 'raw', 'clippings');
  const taken = new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3).toLowerCase()));
  const slug = disambiguateSlug(slugify(title), clip.hash, (s) => taken.has(s.toLowerCase()));
  const file = join(dir, `${slug}.md`);

  writeFileSync(file, clip.body);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality}, docx)`);
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
