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
   output is plain text — light and lossy on tables/figures; note that on the
   resulting source page so a reader knows the fidelity ceiling.
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping — summarize
   into `wiki/sources/`, cross-reference, index, log. The ingest is gated by the
   user as usual.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped text is immutable
  source-of-truth (guardrail #1). Frontmatter is pipeline state, tooling-only.
- `clip-pdf.mjs` is the **sole writer** to `raw/` for PDFs — the model never writes
  the clipping by hand (that would bypass dedup, decline, and hashing).
- **Fidelity, not truth**: a faithful extraction of a wrong paper is still wrong;
  `pdftotext` can also mangle multi-column layouts — verify quotes against the PDF
  before they land on a wiki page (guardrail #5).
