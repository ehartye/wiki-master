import { existsSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { existingClippingWithHash, readClippingHashes } from './lib/dedupe.mjs';
import { slugify, buildFrontmatter, knownSourceUrls, disambiguateSlug } from './clip.mjs';
import { pdftotextCapabilities, pdftotextPresent, tabularity, chooseExtraction, parseMode, dependencyReport, SAMPLE_PAGES } from './lib/pdf-extract.mjs';

const THIN_WORD_FLOOR = 100;

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// A PDF has no HTML <title>; derive a human title from the filename. Split on
// both separators, not node:path basename — basename only honors `\` on Windows,
// so a Windows-style path handled on a POSIX runner keeps its `C:\dir\` prefix
// and leaks it into the title (same fix as titleFromXlsx).
export function titleFromPdf(pdfPath) {
  const base = pdfPath.split(/[\\/]/).pop();
  return base.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || 'untitled';
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
//
// This must NOT trip on ordinary sentence- or heading-ending question marks
// ("What is a graph database ?" / "...changing data schema? Graph databases").
// Real prose question marks are followed (after optional whitespace, including
// a line break for headings) by the capital letter starting the next sentence
// or heading; mangled-math manglings are followed by the next term of the
// expression, which is a digit or lowercase variable ("2 ? 1", not "? Graph").
// The negative lookahead excludes only the capital-letter case, so a genuine
// FAQ/TOC full of real "?"s stays clean while dense runs of "<digit> ? <digit>"
// still trip the threshold below.
export function assessFidelity(text) {
  const words = (text.match(/\S+/g) || []).length || 1;
  const mangledMath = (text.match(/[A-Za-z0-9)\]]\s?\?\s?(?![A-Z])[A-Za-z0-9(]/g) || []).length;
  const replacement = (text.match(/�/g) || []).length;
  const cid = (text.match(/\(cid:\d+\)/g) || []).length;
  // Broken-font mojibake: a text layer that decodes to mostly non-letters —
  // digits, punctuation, and symbols instead of words ("345689 9 9 #$%&'()6*&+").
  // This failure mode dumps gibberish that trips none of the checks above (no
  // math '?', no (cid:NN), no replacement char), so it needs its own signal:
  // alphabetic density over non-space characters. Clean prose sits ~0.75-0.85;
  // symbol/number-dominated gibberish is far lower. Gated on a minimum length so
  // short snippets and legitimately number-dense captions do not trip it, and it
  // is measured over the WHOLE extraction — a single garbled cover page in an
  // otherwise-clean document is correctly not flagged.
  const nonSpace = (text.match(/\S/g) || []).length || 1;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const letterRatio = letters / nonSpace;
  // Calibrated against real content, not intuition. A legitimately numeric
  // document — a DOT unit-price table or fuel index — is letter-sparse because
  // the content IS numbers, and still measures 0.35-0.40 (column headers, item
  // descriptions, dates). Broken-font mojibake measures 0.00-0.05. The old 0.5
  // gate sat above real data and flagged every price sheet as gibberish.
  const gibberish = nonSpace >= 200 && letterRatio < 0.2;
  // Degraded means "don't trust verbatim spans, paraphrase math". Calibrated so
  // math-heavy prose (many '?'-for-operator manglings), glyph-dump PDFs
  // ((cid:NN) tokens, high replacement-char density), and broken-font gibberish
  // trip it, while a handful of stray glyphs in figure captions of otherwise-clean
  // prose does not.
  // mangledMath is rate-gated, not just counted: an absolute floor alone meant
  // length decided the verdict, so any long document accumulated 8 ordinary
  // question marks and read as math-mangled forever. Keep the floor so a short
  // snippet is not condemned by one or two hits, but require real density too.
  const degraded =
    (mangledMath >= 8 && mangledMath / words > 0.005) ||
    cid > 5 ||
    replacement / words > 0.015 ||
    gibberish;
  return { degraded, mangledMath, replacement, cid, letterRatio, gibberish };
}

// Build the clipping note. Pure: no IO, no pdftotext — the testable core.
// We store the extracted TEXT as the canonical markdown representation; the
// binary PDF is never the source-of-truth note, so the vault stays greppable,
// diffable, and answerable, and `[[note]]` provenance resolves to real markdown.
// `fidelityFloor` carries what the EXTRACTION knows and the text cannot show.
// assessFidelity reads characters, and a column-flattened table has perfect
// characters -- clean prose by every check we run -- while its rows are mispaired
// beyond recovery. Only the code that chose the extraction mode knows that, so it
// passes a floor down and the stamp can never come out better than the truth.
// Precedence lives here, not at the call site: a degraded ASSESSMENT (mangled
// glyphs) always outranks a floor, because wrong characters are the worse defect.
export function pdfClipContent({ title, source, text, quality = 'medium', created = today(), extraction, fidelityFloor } = {}) {
  const cleaned = stripRunningHeadersFooters(text || '');
  const md = cleaned.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const assessed = assessFidelity(md).degraded ? 'degraded' : 'high';
  const fidelity = assessed === 'degraded' ? 'degraded' : (fidelityFloor || 'high');
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, fidelity, extraction });
  return { md, wordCount: wordCount(md), fidelity, assessed, extraction, hash, body: `${fm}\n\n${md}\n` };
}

// Extract text via pdftotext (Xpdf or poppler). execFileSync (not a shell)
// resolves the Windows .exe correctly; '-' writes to stdout.
//
// `args` carries the reading mode, chosen per document by planExtraction rather
// than fixed here. Default (no args) is reading-order: it reads each column
// top-to-bottom and de-hyphenates line breaks, which is what makes a two-column
// paper quotable -- and what silently destroys a table, since it emits one
// column-block at a time. Both modes still emit form-feeds between pages, so
// header/footer stripping applies either way.
export function pdfToText(pdfPath, args = []) {
  // -enc UTF-8 is mandatory: pdftotext defaults to Latin-1 on some poppler builds,
  // and Node then decodes those bytes as UTF-8, turning every accent/bullet/© into
  // U+FFFD ("Béthune" → "B�thune"). Forcing UTF-8 output makes the decode correct.
  return execFileSync('pdftotext', ['-q', '-enc', 'UTF-8', ...args, pdfPath, '-'], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  });
}

// Decide how to read THIS document, and what the resulting clipping may claim.
// Split from main() so the poppler case -- no `-table`, therefore no faithful
// reading available -- can be exercised on a machine that does have `-table`.
export function planExtraction(pdfPath, { caps = pdftotextCapabilities(), detect = detectTabular, override = 'auto' } = {}) {
  const tab = detect(pdfPath, { canTable: caps.table });
  const mode = chooseExtraction({ tabular: Boolean(tab && tab.tabular), canTable: caps.table, override });
  return { tab, mode, caps };
}

// Is this PDF laid out as a TABLE? Read a sample of it both ways and ask whether
// aligned mode RE-ATTACHES anything (see tabularity). Sampling, not the whole
// document: two extra full passes over a 250-page PDF just to decide how to read
// it is pure waste, and the first pages track the whole-document score closely
// (measured 0.508 vs 0.481 on the reported source PDF).
//
// Without `-table` we compare against `-layout` instead. That is a DETECTOR only
// -- `-layout` mispairs rows and is never used to produce a clipping (see
// chooseExtraction) -- but it answers "do these short lines re-attach to
// something?", and that answer is what decides whether the user gets warned.
//
// Returns null when the probe cannot run at all, which is NOT the same as
// "prose": the caller must not read a failed probe as a clean bill of health.
export function detectTabular(pdfPath, { canTable = pdftotextCapabilities().table } = {}) {
  const pages = ['-f', '1', '-l', String(SAMPLE_PAGES)];
  try {
    return tabularity(
      pdfToText(pdfPath, pages),
      pdfToText(pdfPath, [canTable ? '-table' : '-layout', ...pages]),
    );
  } catch { return null; }
}

// Probe each OCR tool separately. ocrReachable() collapses both into one boolean,
// which is all the extraction path needs but is useless to a human: "OCR is off"
// does not say which of two packages to install.
export function ocrToolPresence() {
  const present = (cmd, args) => {
    try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; }
    catch (e) { return e.code !== 'ENOENT'; }   // a nonzero -v exit still means installed
  };
  return { pdftoppm: present('pdftoppm', ['-v']), tesseract: present('tesseract', ['--version']) };
}

// The whole external-toolchain picture, in the shape dependencyReport wants.
export function toolchainReport() {
  const caps = pdftotextCapabilities();
  const ocr = ocrToolPresence();
  return dependencyReport({
    pdftotext: pdftotextPresent(), table: caps.table, pdftoppm: ocr.pdftoppm, tesseract: ocr.tesseract,
  });
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

// Escalate to OCR on QUALITY as well as quantity. A broken/symbol-font text layer
// yields plenty of words — just corrupted ones — so gating only on "thin" let
// equation-heavy PDFs through as `degraded` with OCR never attempted (a
// 34k-word thesis whose every equation decoded to U+FFFD).
// Gate on the ASSESSED fidelity, never the floored one. OCR's job is a broken
// FONT, which it can genuinely repair. A table we merely could not align has
// perfect glyphs, so rasterizing 250 pages would burn hours to reach the same
// answer -- and preferBetterExtraction, which compares glyph-level problem
// rates, cannot see row damage and would keep the flattened text regardless.
export function shouldTryOcr(clip, { thinFloor = THIN_WORD_FLOOR } = {}) {
  return clip.wordCount < thinFloor || (clip.assessed ?? clip.fidelity) === 'degraded';
}

// Problems per word — replacement chars, glyph-dump (cid:NN) tokens, and mangled
// math — normalized by length so a long document is not penalized for being long.
function problemRate(clip) {
  const a = assessFidelity(clip.md);
  return (a.replacement + a.cid + a.mangledMath) / Math.max(1, clip.wordCount);
}

// Keep whichever pass actually reads better. OCR has its own error modes, so it
// only wins when it is both usable (not thin) and measurably cleaner — otherwise
// escalation could trade good text for worse.
export function preferBetterExtraction(textClip, ocrClip, { thinFloor = THIN_WORD_FLOOR } = {}) {
  if (!ocrClip || ocrClip.wordCount < thinFloor) return textClip;
  if (textClip.wordCount < thinFloor) return ocrClip;
  // A clean pass beats a degraded one outright. Rate alone is not enough: a
  // broken-encoding text layer is punctuation soup carrying no replacement chars,
  // no (cid:NN) and no mangled math, so it rates 0 — tying with a perfect OCR pass
  // and winning by fallthrough. letterRatio is the only signal that sees it.
  const t = assessFidelity(textClip.md);
  const o = assessFidelity(ocrClip.md);
  if (t.degraded !== o.degraded) return o.degraded ? textClip : ocrClip;
  return problemRate(ocrClip) < problemRate(textClip) ? ocrClip : textClip;
}

// A thin extraction has two very different causes and they must not share a fate.
//
// If OCR ran and still could not read the document, the PDF really is scanned or
// encrypted beyond us: a decline is the right record, and its 180-day TTL stops
// us retrying a document that cannot change.
//
// If OCR was never reachable, we learned NOTHING about the PDF -- only about this
// machine. Recording a decline there buries a recoverable source behind a
// judgement nobody made, on a machine that may be the only one missing the tool
// ("transient failures are not declines"). One such casualty is already in the
// wild: army.mil's AFT_Scoring_Scales PDF, declined 2026-08-10 by a run that had
// no Tesseract installed.
export function thinOutcome({ ocrAvailable } = {}) {
  if (ocrAvailable) {
    return {
      decline: true,
      status: 'thin',
      reason: 'thin text (scanned/encrypted; OCR ran and also failed)',
      message: 'thin content after OCR (decline recorded)',
    };
  }
  return {
    decline: false,
    status: 'ocr-unavailable',
    reason: null,
    message:
      'thin text layer AND no OCR toolchain on this machine -- so nothing was learned '
      + 'about this PDF, only about this install. NOT recorded as a decline. Install '
      + 'tesseract + pdftoppm and re-clip:\n'
      + '  winget install UB-Mannheim.TesseractOCR\n'
      + '  winget install oschwartz10612.Poppler',
  };
}

export function main(argv) {
  const pdfPath = argv[0];
  if (!pdfPath) {
    console.error('usage: clip-pdf.mjs <file.pdf> [--source="<url-or-path>"] [--quality=high|medium|low]');
    console.error('                          [--mode=auto|reading-order|table] [--ocr] [--ocr-lang=eng]');
    console.error('                          [--decline="reason"] [--doctor]');
    console.error('');
    console.error('  --mode   reading mode. auto (default) lets the tabular detector choose;');
    console.error('           reading-order and table override it when it gets a document wrong.');
    console.error('  --doctor report which external tools are installed, then exit.');
    process.exit(2);
  }
  let readingMode;
  try { readingMode = parseMode(argv); }
  catch (e) { console.error(`ERROR: ${e.message}`); process.exit(2); }

  // Yell about the toolchain BEFORE doing any work, on every run. A missing tool
  // silently downgrades what a clipping can ever be, and the downgrade is
  // invisible in the output -- so it has to be loud at the top, not inferred
  // later from a clipping that merely looks thin.
  const deps = toolchainReport();
  if (argv.includes('--doctor')) {
    console.log(deps.ok ? 'clip-pdf toolchain: OK (pdftotext +table, pdftoppm, tesseract)' : deps.lines.join('\n'));
    return { status: 'doctor', ok: deps.ok, missing: deps.missing };
  }
  if (!deps.ok) {
    console.error('');
    console.error('=========================== clip-pdf toolchain ===========================');
    for (const l of deps.lines) console.error(l);
    console.error('  (run `clip-pdf.mjs --doctor` to re-check)');
    console.error('=========================================================================');
    console.error('');
  }
  if (deps.fatal) process.exit(1);

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
    // Choose the reading mode for THIS document before reading it in full.
    // Reading-order mode flattens a table column-block-wise and the damage is
    // invisible downstream, so the choice cannot be a global default (#66).
    const { tab, mode } = planExtraction(pdfPath, { override: readingMode });
    // A mode we cannot honor is refused outright: producing a clipping in the
    // OTHER mode while the operator believes they forced this one is exactly the
    // silent-wrongness this module refuses everywhere else.
    if (mode.error) { console.error(`ERROR: ${mode.error}`); process.exit(1); }
    if (mode.warning) console.error(`WARNING: ${mode.warning}`);
    else if (mode.overrode) {
      console.log(`--mode=${readingMode}: overriding the detector for this document`);
    } else if (mode.extraction === 'table-aware') {
      console.log(`tabular layout detected (${tab.promoted}/${tab.keys} key cells re-attach) — reading with -table`);
    }

    let text;
    try { text = pdfToText(pdfPath, mode.args); }
    catch {
      if (!pdftotextPresent()) {
        console.error('pdftotext not found. Install the Xpdf command-line tools (https://www.xpdfreader.com/download.html) or poppler (https://poppler.freedesktop.org/). Xpdf is preferred: only it provides the -table mode that reads tabular PDFs without destroying row pairings.');
        process.exit(1);
      }
      text = ''; // per-URL extraction failure — fall through to the OCR fallback below
    }
    clip = pdfClipContent({ title, source, text, quality, extraction: mode.extraction, fidelityFloor: mode.fidelityFloor });
    // Auto-fallback on quantity OR quality: a thin layer means a scanned/image
    // PDF; an abundant-but-degraded layer means a broken/symbol font (equations
    // decoding to U+FFFD). Both are exactly OCR's job. Keep whichever pass reads
    // better so escalation can never make the clipping worse.
    if (shouldTryOcr(clip) && ocrReachable()) {
      console.log(`${clip.wordCount < THIN_WORD_FLOOR ? 'thin' : 'degraded'} text layer — trying OCR (slow)…`);
      const oclip = pdfClipContent({ title, source, text: pdfToTextOcr(pdfPath, { lang }), quality, extraction: 'ocr', fidelityFloor: mode.fidelityFloor });
      clip = preferBetterExtraction(clip, oclip);
    }
  }

  if (clip.wordCount < THIN_WORD_FLOOR) {
    const outcome = thinOutcome({ ocrAvailable: ocrReachable() });
    if (outcome.decline) recordDecline(vaultPath, source, outcome.reason);
    console.log(`thin text layer: ${pdfPath}`);
    console.log(outcome.message);
    return { status: outcome.status };
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

  // A slug collision that is NOT a hash match is a DIFFERENT paper that happens
  // to share a title (or a case-variant of one). Disambiguate instead of dropping
  // it — silently losing a distinct source is worse than a suffixed slug.
  // Case-insensitive to match the filesystem and Obsidian's wikilink resolution.
  const taken = new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3).toLowerCase()));
  const slug = disambiguateSlug(slugify(title), clip.hash, (s) => taken.has(s.toLowerCase()));
  const file = join(dir, `${slug}.md`);

  writeFileSync(file, clip.body);
  const how = clip.extraction === 'ocr' ? 'OCR'
    : clip.extraction === 'table-aware' ? 'text, table-aware'
    : clip.extraction === 'reading-order-forced' ? 'text, reading-order (forced)'
    : 'text';
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality}, ${how}${clip.fidelity !== 'high' ? `, fidelity=${clip.fidelity}` : ''})`);
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
