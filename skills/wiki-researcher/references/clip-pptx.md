Read [access and host commands](../../wiki-maintainer/references/access.md) before touching the vault. Also read for this task: [completion](../../wiki-maintainer/references/operations.md).
Load the rest only when this run reaches it — [evidence](../../wiki-maintainer/references/evidence.md) before a quote or figure from this capture lands on a wiki page, or when reporting a fidelity limit.
Reuse existing session authorization for the first write.

# Clipping a PowerPoint deck into the wiki

The HTML clipper (`clip.mjs` → Defuddle) handles **HTML** pages only,
`clip-pdf` handles **PDFs**, and `clip-docx`/`clip-xlsx` handle Word documents and
spreadsheets. A `.pptx` slide deck — bullets and tables per slide, plus speaker
notes, not flowing paragraphs — falls to none of those. This reference covers the
PowerPoint path. **The canonical stored artifact is the extracted Markdown, never
the binary deck** — that keeps the vault greppable, diffable, and answerable, and
makes `[[note]]` provenance resolve to a real Markdown clipping rather than to an
opaque attachment.

## How it works

`clip-pptx.mjs` extracts each slide's text, tables, and speaker notes with a
bundled Python helper (`scripts/lib/pptx-extract.py`) built on **python-pptx** —
**not** pandoc (pandoc has no `.pptx` input format at all) and **not**
LibreOffice (avoids a heavyweight dependency for this one format). The helper is
invoked by the bundled Node clipper. Interpreter selection and missing-library
diagnosis are in the direct [PowerPoint prerequisites](../../wiki-setup/references/capture-prerequisites.md#powerpoint).

Output is one `## Slide N` heading per slide (emitted even for a slide with no
extractable text, so slide numbering matches the real deck — useful for citing
"slide 7 says X"), followed by bullet/paragraph text, any table rendered as a
markdown table, and a `**Speaker notes:**` line when present. Then
`clip-pptx.mjs` writes `raw/clippings/<slug>.md` with the standard clipping
frontmatter (`source`, `created`, `tags:[clippings]`, `quality`, `source-hash`).
It skips duplicates and prior declines, and records a decline for a **thin**
extraction (empty or near-empty deck) so it is not retried blindly.

**Legacy `.ppt` is unsupported.** Use a supported `.pptx`; the
[PowerPoint prerequisites](../../wiki-setup/references/capture-prerequisites.md#powerpoint) cover format failures.

## Steps

1. **Preflight:** run the direct [prerequisite and diagnostic procedure](../../wiki-setup/references/capture-prerequisites.md#powerpoint) for this format. Missing tools or access never authorize invented evidence or automatic installation.
2. **Clip** (this is the only writer to `raw/` for PowerPoint decks):
   `node "<absolute-plugin-root>/scripts/clip-pptx.mjs" "<path/to/file.pptx>" --source="<canonical-url-if-any>" --quality=<tier> --topic="<topic>"`
   - `--source` is the citable origin. Omit for a purely local file and the file
     path is recorded as the source.
   - **`--topic` whenever this clip belongs to a research run** — pass the topic
     string researcher discovery was given, identical across every clip in the run,
     so maintainer triage can group the run's leftovers together. **Topic is recorded
     going forward only and no tool can retro-fit it**, so a clip made without it
     is an *Unattributed* triage row permanently. Omit it only when there is no
     research run behind the clip; never invent one.
   - Report `thin` or `failed` honestly and follow [PowerPoint diagnosis](../../wiki-setup/references/capture-prerequisites.md#powerpoint); do not invent slide text.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and sanity-check
   the slide text and any tables against the deck. Extraction drops slide design,
   layout, images, and chart *rendering* — table cell text is preserved, but a
   chart's visual is not.
4. **Only when ingestion is authorized, follow [ingestion](ingest.md)** for this exact clipping — summarize
   into `wiki/sources/`, cross-reference, index, log. Ingestion requires authorization for this scope; reuse explicit session authorization.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped text is immutable
  source-of-truth (guardrail #1). Frontmatter is pipeline state, tooling-only.
- `clip-pptx.mjs` is the **sole writer** to `raw/` for PowerPoint decks — the
  model never writes the clipping by hand (that would bypass dedup, decline, and
  hashing).
- **Fidelity, not truth**: a faithful extraction of the wrong deck is still
  wrong; extraction also drops slide design/layout/images and chart rendering —
  verify quotes against the deck before they land on a wiki page (guardrail #5).
- Legacy `.ppt` is unsupported — convert to `.pptx` first; do not attempt a
  workaround extraction.

## Completion

Verify the paths the clipper printed and its extraction diagnostics, then
[finish the capture](capture.md#finish-capture-and-report). During discovery, report the
results to the enclosing task, which logs once. Capture-only requests create no derived
source or concept pages.
Capturing evidence does not by itself authorize ingestion; reuse explicit
discover-and-ingest authorization when it is already present.
