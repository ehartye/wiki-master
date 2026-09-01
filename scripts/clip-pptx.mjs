import { existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { existingClippingWithHash, readClippingHashes } from './lib/dedupe.mjs';
import { slugify, buildFrontmatter, knownSourceUrls, disambiguateSlug } from './clip.mjs';
import { parseTopicArg } from './lib/topic.mjs';

const THIN_WORD_FLOOR = 100;

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPER = join(__dirname, 'lib', 'pptx-extract.py');

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// A slide deck has no title worth trusting; derive one from the filename, as the
// PDF/DOCX/XLSX clippers do. Split on both separators, not node:path basename —
// basename only honors `\` on Windows, so a Windows-style path handled on a POSIX
// runner (e.g. CI) keeps its `C:\dir\` prefix and leaks it into the title.
export function titleFromPptx(pptxPath) {
  const base = pptxPath.split(/[\\/]/).pop();
  return base.replace(/\.pptx?$/i, '').replace(/[_]+/g, ' ').trim() || 'untitled';
}

// Build the clipping note. Pure: no IO, no python — the testable core. Mirrors
// xlsxClipContent/docxClipContent. A deck's content is its slides — bullets,
// tables, and speaker notes — so the per-slide markdown produced by the Python
// helper is the canonical representation; the binary .pptx never enters the vault.
export function pptxClipContent({ title, source, text, quality = 'medium', created = today(), topic } = {}) {
  const md = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, topic });
  return { md, wordCount: wordCount(md), hash, body: `${fm}\n\n${md}\n` };
}

// Extract text via the bundled python-pptx helper (lib/pptx-extract.py), invoked
// as a subprocess rather than shelled out to any other installed plugin's copy —
// this keeps wiki-master self-contained and portable. python-pptx reads the OOXML
// zip directly (pandoc has no .pptx input format at all, and LibreOffice would be
// a heavyweight dependency for this alone), emitting slide headings, bullet text,
// table cells as markdown tables, and speaker notes, in deck order.
export function pptxToText(pptxPath) {
  const { cmd } = python();
  if (!cmd) throw new Error('no python interpreter');
  return execFileSync(cmd, [HELPER, pptxPath], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
}

// Candidate interpreters, in preference order: `python3` (correct on macOS/Linux,
// where a bare `python` may be absent or Python 2), then `python` (the ONLY name
// the python.org Windows installer creates — it never writes a python3.exe), then
// the `py` launcher. Hardcoding `python3` broke Windows outright: Windows ships a
// WindowsApps\python3.exe App Execution Alias that is always on PATH and exits
// nonzero with "Python was not found", so a correctly-installed python-pptx
// reported itself missing. Candidates are therefore probed by RUNNING them.
const PYTHON_CANDIDATES = ['python3', 'python', 'py'];

// Pure resolution core — `probe(cmd, args) -> boolean` says whether `cmd args` ran
// successfully. Two passes, so a working interpreter that lacks the library never
// shadows a later one that has it, and so "no Python at all" stays distinguishable
// from "Python, but no python-pptx" — the two need different fixes.
export function pickPython(candidates, probe) {
  for (const c of candidates) if (probe(c, ['-c', 'import pptx'])) return { cmd: c, pptx: true };
  for (const c of candidates) if (probe(c, ['-c', ''])) return { cmd: c, pptx: false };
  return { cmd: null, pptx: false };
}

function runs(cmd, args) {
  try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; }
}

let resolvedPython;
function python() {
  if (!resolvedPython) resolvedPython = pickPython(PYTHON_CANDIDATES, runs);
  return resolvedPython;
}

export function main(argv) {
  const pptxPath = argv[0];
  if (!pptxPath) {
    console.error('usage: clip-pptx.mjs <file.pptx> [--source="<url-or-path>"] [--quality=high|medium|low]');
    console.error('                           [--topic="<research topic>"] [--decline="reason"]');
    console.error('');
    console.error('  --topic  the research run this clip belongs to. Recorded going forward only:');
    console.error('           without it, /wiki-triage can never group this clipping by run.');
    process.exit(2);
  }
  const srcArg = argv.find((a) => a.startsWith('--source='));
  const source = srcArg ? srcArg.split('=').slice(1).join('=') : pptxPath;
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';
  // Attribution is recorded at clip time or never: /wiki-triage can only group a
  // clipping under its research run if the run stamped one in. There is no
  // retro-fit, so a missing --topic is a permanent Unattributed row.
  const topic = parseTopicArg(argv);

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

  if (!existsSync(pptxPath)) { console.error(`file not found: ${pptxPath}`); process.exit(2); }

  // Legacy binary PowerPoint 97-2003 (.ppt) is a different file format entirely;
  // python-pptx cannot read it at all. Fail clearly rather than attempting
  // extraction and reporting a confusing downstream error.
  if (/\.ppt$/i.test(pptxPath)) {
    console.log(`legacy .ppt (binary PowerPoint 97-2003) is not supported — convert to .pptx first: ${pptxPath}`);
    return { status: 'failed' };
  }

  let text;
  try { text = pptxToText(pptxPath); }
  catch {
    // Distinguish "python-pptx not installed" (fatal — fix the install) from
    // "this file failed" (skip, so batch runs continue).
    const { cmd, pptx } = python();
    if (!cmd) {
      console.error(`no Python interpreter found (tried ${PYTHON_CANDIDATES.join(', ')}). Install Python 3, then: pip install python-pptx`);
      process.exit(1);
    }
    if (!pptx) {
      // Name the resolved interpreter: installing into a DIFFERENT python than the
      // one that runs the helper is the exact way this fails silently.
      console.error(`python-pptx not found for ${cmd}. Install it: ${cmd} -m pip install python-pptx`);
      process.exit(1);
    }
    console.log(`extraction failed (corrupt/protected deck — clip manually): ${pptxPath}`);
    return { status: 'failed' };
  }

  const title = titleFromPptx(pptxPath);
  const clip = pptxClipContent({ title, source, text, quality, topic });

  if (clip.wordCount < THIN_WORD_FLOOR) {
    recordDecline(vaultPath, source, 'thin content (empty/near-empty deck)');
    console.log(`thin content (decline recorded): ${pptxPath}`);
    return { status: 'thin' };
  }

  const dir = join(vaultPath, 'raw', 'clippings');

  // isDuplicateUrl only catches a re-clip of the same PATH; a moved or renamed
  // deck slips past it and the slug disambiguation below then mints a second
  // file for content the vault already holds. Identity is the extracted body's
  // hash, which does not care where the deck lives.
  const already = existingClippingWithHash(readClippingHashes(dir), clip.hash);
  if (already) {
    console.log(`exists (same content): ${already}`);
    return { status: 'duplicate', file: already };
  }

  // A slug collision that is NOT a hash match is a DIFFERENT deck sharing a
  // title. Disambiguate rather than drop.
  const taken = new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3).toLowerCase()));
  const slug = disambiguateSlug(slugify(title), clip.hash, (s) => taken.has(s.toLowerCase()));
  const file = join(dir, `${slug}.md`);

  writeFileSync(file, clip.body);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality}, pptx)`);
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
