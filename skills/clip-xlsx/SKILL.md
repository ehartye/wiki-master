---
name: clip-xlsx
description: Use when asked to clip a spreadsheet or workbook (.xlsx, .xls, .xlsm) into the wiki as Markdown evidence. For Word documents use clip-docx and for PDFs use clip-pdf; existing clippings belong to wiki-ingest.
argument-hint: "<path/to/file.xlsx> [--source=\"<url>\"] [--quality=high|medium|low] [--topic=\"<topic>\"]"
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [evidence](../wiki-maintainer/references/evidence.md), [operations](../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

# Clipping a spreadsheet into the wiki

`/wiki-discover`'s clipper (`clip.mjs` → Defuddle) handles **HTML** pages only,
`clip-pdf` handles **PDFs**, and `clip-docx` handles **Word** documents. A
workbook — sheets of cells, where meaning lives in which value sits against
which label — falls to none of those. This skill is the spreadsheet path.
**The canonical stored artifact is the extracted Markdown, never the binary
workbook** — that keeps the vault greppable, diffable and answerable, and makes
`[[note]]` provenance resolve to a real Markdown clipping rather than to an
opaque attachment.

**Never reach a workbook by converting it to PDF and running `clip-pdf`.** That
is the exact case `clip-pdf` warns about: row/label pairings get rebuilt from
horizontal position, and a flattened table reads clean while pairing the wrong
number with the wrong label. A spreadsheet is the worst document to put through
it, because the pairing *is* the content.

## How it works

`clip-xlsx.mjs` converts with **LibreOffice** (`soffice --headless --convert-to
html`, which renders every sheet as a table), then pipes that HTML through
**pandoc** to Markdown with `--wrap=none`, and writes `raw/clippings/<slug>.md`
with the standard clipping frontmatter (`source`, `created`, `tags:[clippings]`,
`quality`, `source-hash`). The title is derived from the filename — a workbook
carries no title worth trusting.

- **`soffice` is invoked by bare name on purpose**, so PATHEXT selects the
  console shim (`soffice.com`); `soffice.exe` is the GUI build and writes nothing
  to stdout. Both converters run through Node's `execFileSync` — do **not** shell
  out to them from a Bash tool.
- **Two failures that look alike are handled differently.** A missing LibreOffice
  is fatal and stops the run with an install pointer: fix the install. A workbook
  that *itself* fails to convert (corrupt or password-protected) returns `failed`
  so a batch run continues. Report it for manual handling; never invent the cells.
- **Duplicates are caught by content hash**, not just by path, so a renamed or
  moved workbook whose contents the vault already holds is recognized rather than
  clipped twice under a second slug.

## Steps

1. **Preflight** (once): confirm both converters are installed — `soffice
   --version` and `pandoc -v`. If LibreOffice is missing, tell the user to
   install it (https://www.libreoffice.org/download/) and stop; do not fabricate
   cell values or retype the workbook by hand.
2. **Clip** (this is the only writer to `raw/` for workbooks):
   `node "<absolute-plugin-root>/scripts/clip-xlsx.mjs" "<path/to/file.xlsx>" --source="<canonical-url-if-any>" --quality=<tier> --topic="<topic>"`
   - `--source` is the citable origin. Omit it for a purely local file and the
     file path is recorded as the source; never invent a URL to fill the field.
   - **`--topic` whenever this clip belongs to a research run** — pass the topic
     string `/wiki-discover` was given, identical across every clip in the run,
     so `/wiki-triage` can group the run's leftovers together. **Topic is recorded
     going forward only and no tool can retro-fit it**, so a clip made without it
     is an *Unattributed* triage row permanently. Omit it only when there is no
     research run behind the clip; never invent one.
   - `--quality` is your credibility judgment of the workbook as a source, which
     is separate from how cleanly it extracted.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and confirm the
   sheets came through as real tables with their labels still attached to their
   values. Conversion is lossy on formulas, merged cells, charts and multi-row
   headers — it captures rendered values, not the model behind them.
   - A `thin` result (under 100 words) records a decline so it is not retried
     blindly. **Unlike `clip-docx`, this clipper has no `--allow-short`
     override** — a genuinely tiny but complete workbook needs the decline
     cleared or the content captured another way. Say so rather than pretending
     the clip succeeded.
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping — summarize
   into `wiki/sources/`, cross-reference, index, log. Ingestion requires
   authorization for this scope; reuse explicit session authorization.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped text is immutable
  source-of-truth (guardrail #1). Frontmatter is pipeline state, tooling-only.
- `clip-xlsx.mjs` is the **sole writer** to `raw/` for workbooks — the model never
  writes the clipping by hand (that would bypass dedup, decline and hashing, and
  the ingest backlog joins on exactly that hash).
- **Fidelity, not truth**: a faithful extraction of the wrong workbook is still
  wrong, and a converted sheet can silently lose the structure that gave a number
  its meaning — verify any figure against the workbook before it lands on a wiki
  page (guardrail #5).

## Completion

For a standalone clip, open an operation before the clipping helper writes, verify
its returned paths and extraction diagnostics, log once, commit and verify
already-authorized sync through the shared operations contract. During discovery,
use the enclosing operation and report the results to its owner for completion.
Capturing evidence does not by itself authorize ingestion; reuse explicit
discover-and-ingest authorization when it is already present.
