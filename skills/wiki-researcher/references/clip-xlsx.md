Read [access and host commands](../../wiki-maintainer/references/access.md) before touching the vault. Also read for this operation: [operations](../../wiki-maintainer/references/operations.md).
Load the rest only when this run reaches it — [evidence](../../wiki-maintainer/references/evidence.md) before a quote or figure from this capture lands on a wiki page, or when reporting a fidelity limit.
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

# Clipping a spreadsheet into the wiki

The HTML clipper (`clip.mjs` → Defuddle) handles **HTML** pages only,
`clip-pdf` handles **PDFs**, and `clip-docx` handles **Word** documents. A
workbook — sheets of cells, where meaning lives in which value sits against
which label — falls to none of those. This reference covers the spreadsheet path.
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

Converter invocation and failed/tiny-workbook diagnosis are in the direct
[spreadsheet prerequisites](../../wiki-setup/references/capture-prerequisites.md#spreadsheets).

- **Duplicates are caught by content hash**, not just by path, so a renamed or
  moved workbook whose contents the vault already holds is recognized rather than
  clipped twice under a second slug.

## Steps

1. **Preflight:** run the direct [prerequisite and diagnostic procedure](../../wiki-setup/references/capture-prerequisites.md#spreadsheets) for this format. Missing tools or access never authorize invented evidence or automatic installation.
2. **Clip** (this is the only writer to `raw/` for workbooks):
   `node "<absolute-plugin-root>/scripts/clip-xlsx.mjs" "<path/to/file.xlsx>" --source="<canonical-url-if-any>" --quality=<tier> --topic="<topic>" --since <token>`
   - `--source` is the citable origin. Omit it for a purely local file and the
     file path is recorded as the source; never invent a URL to fill the field.
   - **`--topic` whenever this clip belongs to a research run** — pass the topic
     string researcher discovery was given, identical across every clip in the run,
     so maintainer triage can group the run's leftovers together. **Topic is recorded
     going forward only and no tool can retro-fit it**, so a clip made without it
     is an *Unattributed* triage row permanently. Omit it only when there is no
     research run behind the clip; never invent one.
   - `--quality` is your credibility judgment of the workbook as a source, which
     is separate from how cleanly it extracted.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and confirm the
   sheets came through as real tables with their labels still attached to their
   values. Conversion is lossy on formulas, merged cells, charts and multi-row
   headers — it captures rendered values, not the model behind them.
   - A `thin` result is not a successful capture. This route has no `--allow-short`; follow [spreadsheet diagnosis](../../wiki-setup/references/capture-prerequisites.md#spreadsheets) and never fabricate cells.
4. **Only when ingestion is authorized, follow [ingestion](ingest.md)** for this exact clipping — summarize
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
its returned paths and extraction diagnostics, [validate affected derived paths](../../wiki-setup/references/validation.md) when any were written, log once, commit, push and verify
remote publication through the shared operations contract. During discovery,
use the enclosing operation and report the results to its owner for completion.
Pass `--since <saved-token>` to the clipping helper so every written path enters
that operation's ledger. Capture-only requests end after this completion and
create no derived source or concept pages.
Capturing evidence does not by itself authorize ingestion; reuse explicit
discover-and-ingest authorization when it is already present.
