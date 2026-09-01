import { existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline, removeDecline } from './lib/decline.mjs';
import { existingClippingWithHash, readClippingHashes } from './lib/dedupe.mjs';
import { slugify, buildFrontmatter, knownSourceUrls, disambiguateSlug } from './clip.mjs';
import { parseTopicArg } from './lib/topic.mjs';

const THIN_WORD_FLOOR = 100;

// The floor exists to catch an extraction that FAILED — a corrupt, image-only, or
// password-protected document pandoc turned into almost nothing. It cannot tell that
// apart from a document which is genuinely short, because word count is the only
// signal it has, and a one-page classroom handout (a bare list of case names, a blank
// analysis form, a vocabulary sheet) is complete at 40 words. Declining those loses
// real sources: the decline is recorded, so a batch re-run skips them silently, and
// the material never reaches the vault at all.
//
// `--allow-short` is the human saying they opened the file and it is short on purpose.
// It is opt-in per clip rather than a lower global floor, so the safety net keeps
// doing its real job on every clip that did not ask.
export function shouldDeclineAsThin(wordCount, { allowShort = false } = {}) {
  if (allowShort) return false;
  return wordCount < THIN_WORD_FLOOR;
}

export function parseAllowShort(argv = []) {
  return argv.includes('--allow-short');
}

// The exact reason string this module records when the floor refuses a document.
// Named so the override below can recognize its own decline and nothing else.
export const THIN_DECLINE_REASON = 'thin text (empty/near-empty docx)';

// A decline is checked before extraction, so without this the flag would be
// unreachable in the only situation that produces it: you discover a document
// needs `--allow-short` because a first pass already declined it and wrote the
// decline down. `--allow-short` therefore clears THIS module's own automated
// thin decline — and only that one. A human `--decline="reason"` outranks the
// flag, because it means "I decided not to keep this", which word count never did.
export function overridesDecline(entry, { allowShort = false } = {}) {
  if (!allowShort || !entry) return false;
  return entry.reason === THIN_DECLINE_REASON;
}

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// A Word document has no HTML <title>; derive a human title from the filename.
// Handles both .docx (modern) and .doc (legacy) extensions. Split on both
// separators, not node:path basename — basename only honors `\` on Windows, so a
// Windows-style path handled on a POSIX runner keeps its `C:\dir\` prefix and
// leaks it into the title (same fix as titleFromXlsx).
export function titleFromDocx(docxPath) {
  const base = docxPath.split(/[\\/]/).pop();
  return base.replace(/\.docx?$/i, '').replace(/[_]+/g, ' ').trim() || 'untitled';
}

// Build the clipping note. Pure: no IO, no pandoc — the testable core. The
// extracted TEXT is stored as the canonical markdown representation (never the
// binary .docx), so the vault stays greppable, diffable, and answerable, and
// `[[note]]` provenance resolves to a real markdown clipping. Mirrors
// clip-pdf's pdfClipContent, minus the PDF-only concerns: a .docx has no fixed
// pages (so no running header/footer to strip) and pandoc reads its XML directly
// (so there is no math-font mangling to flag as fidelity: degraded).
export function docxClipContent({ title, source, text, quality = 'medium', created = today(), topic } = {}) {
  const md = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, topic });
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
    console.error('usage: clip-docx.mjs <file.docx> [--source="<url-or-path>"] [--quality=high|medium|low]');
    console.error('                           [--topic="<research topic>"] [--decline="reason"]');
    console.error('                           [--allow-short]');
    console.error('');
    console.error('  --topic  the research run this clip belongs to. Recorded going forward only:');
    console.error('           without it, /wiki-triage can never group this clipping by run.');
    process.exit(2);
  }
  const srcArg = argv.find((a) => a.startsWith('--source='));
  const source = srcArg ? srcArg.split('=').slice(1).join('=') : docxPath;
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';
  // Attribution is recorded at clip time or never: /wiki-triage can only group a
  // clipping under its research run if the run stamped one in. There is no
  // retro-fit, so a missing --topic is a permanent Unattributed row.
  const topic = parseTopicArg(argv);
  const allowShort = parseAllowShort(argv);

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
    if (overridesDecline(e, { allowShort })) {
      // Clear it rather than clipping around it, so the vault stops carrying a
      // decline that no longer reflects a decision anyone holds.
      removeDecline(vaultPath, source, e.reason);
      console.log(`clearing prior thin decline (--allow-short): ${source}`);
    } else {
      console.log(`declined previously (${e.date}: ${e.reason}): ${source}`);
      return { status: 'declined' };
    }
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
  const clip = docxClipContent({ title, source, text, quality, topic });

  if (shouldDeclineAsThin(clip.wordCount, { allowShort })) {
    recordDecline(vaultPath, source, THIN_DECLINE_REASON);
    console.log(`thin content (decline recorded; pass --allow-short if it is short on purpose): ${docxPath}`);
    return { status: 'thin' };
  }

  const dir = join(vaultPath, 'raw', 'clippings');

  // isDuplicateUrl only catches a re-clip of the same PATH; a moved or renamed
  // binary slips past it and the slug disambiguation below then mints a second
  // file for content the vault already holds. Identity is the extracted body's
  // hash, which does not care where the binary lives.
  const already = existingClippingWithHash(readClippingHashes(dir), clip.hash);
  if (already) {
    console.log(`exists (same content): ${already}`);
    return { status: 'duplicate', file: already };
  }

  // A slug collision that is NOT a hash match is a DIFFERENT document sharing a
  // title (or a case-variant). Disambiguate rather than drop — silently losing a
  // distinct source is worse than a suffixed slug. Case-insensitive to match the
  // filesystem and Obsidian's wikilink resolution.
  const taken = new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3).toLowerCase()));
  const slug = disambiguateSlug(slugify(title), clip.hash, (s) => taken.has(s.toLowerCase()));
  const file = join(dir, `${slug}.md`);

  writeFileSync(file, clip.body);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality}, docx)`);
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
