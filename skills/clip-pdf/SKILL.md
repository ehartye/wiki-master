---
name: clip-pdf
description: Clip a PDF (local file or downloaded paper) into the wiki as a Markdown clipping — extract its text and store the MD representation, never the binary PDF, so provenance resolves to real notes. Use when a source is a PDF that /wiki-discover's HTML clipper (Defuddle) cannot handle.
argument-hint: "<path/to/file.pdf> [--source=\"<url>\"] [--quality=high|medium|low]"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/clip-pdf.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

# Clipping a PDF into the wiki

`/wiki-discover`'s clipper (`clip.mjs` → Defuddle) handles **HTML** pages only; a
PDF URL or local paper extracts as thin content and is skipped. This skill is the
PDF path. **The canonical stored artifact is the extracted Markdown, never the
binary PDF** — that keeps the vault greppable, diffable, and answerable, and makes
`[[note]]` provenance resolve to a real Markdown clipping rather than to an opaque
attachment.

> Storing the `.md` is the rule for *new* clippings. It does **not** mean deleting
> PDFs that already live in `raw/` and are cited as `[[file.pdf]]` — Obsidian
> resolves those attachment links, and `health.mjs` now recognizes them too, so
> historical PDF attachments are healthy as-is. Only convert an existing PDF on
> explicit request.

## How it works

`clip-pdf.mjs` extracts text with **poppler's `pdftotext`** (invoked via Node's
`execFileSync`, which resolves the Windows `.exe` correctly — do **not** shell out
to `pdftotext` from a Bash tool per the PATHEXT hazard), then writes
`raw/clippings/<slug>.md` with the standard clipping frontmatter (`source`,
`created`, `tags:[clippings]`, `quality`, `source-hash`). It skips duplicates and
prior declines, and records a decline for **thin** extractions (scanned/image PDFs
that need OCR) so they are not retried blindly.

Extraction is tuned for academic PDFs:
- **UTF-8 output (`-enc UTF-8`).** pdftotext defaults to Latin-1 on some builds;
  Node then decodes those bytes as UTF-8 and turns every accent/bullet/© into `�`
  ("Béthune" → "B�thune"). Forcing UTF-8 fixes that at the source — no OCR needed
  for accented text.
- **Reading-order, not `-layout`.** `-layout` preserves physical layout, which on a
  **two-column** paper interleaves the columns line-by-line (no verbatim span is
  then traceable). Default mode reads each column top-to-bottom and de-hyphenates
  line breaks, so prose comes out quotable.
- **OCR fallback (Tesseract).** For a **scanned/image PDF** (no text layer) the
  clipper automatically rasterizes pages with `pdftoppm` and recognizes them with
  **Tesseract** — previously these were just declined. Pass **`--ocr`** to force
  the OCR path on any PDF whose embedded-font layer is broken beyond what UTF-8
  fixes (e.g. a math-symbol font with no Unicode mapping). OCR is slower and has
  its own error modes (superscripts, math), so it is a fallback, not the default;
  OCR'd clippings are tagged `extraction: ocr` in frontmatter. Optional
  `--ocr-lang=<code>` (default `eng`).
- **Running headers/footers stripped.** The repeated title line and page-number
  footer at each page boundary are detected (a boundary line recurring on ≥ half
  the pages, with digits masked so `5-70`/`5-71` collapse) and removed — otherwise
  they stitch into the middle of an otherwise-verbatim quote.
- **Fidelity flag.** Math/symbol fonts (especially in older PDFs) extract lossily —
  `−`→`?`, `‖`→`jj`, superscripts flatten. This **cannot** be fixed without OCR, so
  it is *flagged*: when mangling is detected, the frontmatter gets
  **`fidelity: degraded`**. Clean captures omit the field.

## Steps

1. **Preflight** (once): confirm poppler is installed — `pdftotext -v`. If missing,
   tell the user to install poppler and stop; do not fabricate content.
2. **Clip** (this is the only writer to `raw/`):
   `node ../../scripts/clip-pdf.mjs "<path/to/file.pdf>" --source="<canonical-url-if-any>" --quality=<tier>`
   - `--source` is the citable origin (the paper's DOI/URL). Omit for a purely
     local PDF and the file path is recorded as the source.
   - A `thin` or `failed` result means the PDF is scanned/encrypted — report it for
     manual OCR; do not invent the text.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and sanity-check
   that the extracted text is real prose, not garbled ligatures. `pdftotext`
   output is plain text — light and lossy on tables/figures.
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping — summarize
   into `wiki/sources/`, cross-reference, index, log. The ingest is gated by the
   user as usual. **If the clipping carries `fidelity: degraded`, do not quote its
   equations/symbols verbatim** — paraphrase them with attribution and verify every
   quoted span against the original PDF (guardrail #5). Note the fidelity ceiling
   on the resulting source page so a reader knows.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped text is immutable
  source-of-truth (guardrail #1). Frontmatter is pipeline state, tooling-only.
- `clip-pdf.mjs` is the **sole writer** to `raw/` for PDFs — the model never writes
  the clipping by hand (that would bypass dedup, decline, and hashing).
- **Fidelity, not truth**: a faithful extraction of a wrong paper is still wrong;
  `pdftotext` can also mangle multi-column layouts — verify quotes against the PDF
  before they land on a wiki page (guardrail #5).
