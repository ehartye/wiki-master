---
name: clip-pptx
description: Clip a PowerPoint deck (.pptx, local file) into the wiki as a Markdown clipping — extract its slide text, tables, and speaker notes with a bundled python-pptx helper and store the MD representation, never the binary deck, so provenance resolves to real notes. Use when a source is a slide deck that /wiki-discover's HTML clipper (Defuddle) cannot handle and clip-docx/clip-xlsx do not apply.
argument-hint: "<path/to/file.pptx> [--source=\"<url-or-path>\"] [--quality=high|medium|low] [--topic=\"<topic>\"]"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/clip-pptx.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location and the provenance/`raw/`-immutability
> and clipping guardrails these steps assume. Skip the load if you arrived here mid-run
> from a wiki-master skill that already pulled it in.

# Clipping a PowerPoint deck into the wiki

`/wiki-discover`'s clipper (`clip.mjs` → Defuddle) handles **HTML** pages only,
`clip-pdf` handles **PDFs**, and `clip-docx`/`clip-xlsx` handle Word documents and
spreadsheets. A `.pptx` slide deck — bullets and tables per slide, plus speaker
notes, not flowing paragraphs — falls to none of those. This skill is the
PowerPoint path. **The canonical stored artifact is the extracted Markdown, never
the binary deck** — that keeps the vault greppable, diffable, and answerable, and
makes `[[note]]` provenance resolve to a real Markdown clipping rather than to an
opaque attachment.

## How it works

`clip-pptx.mjs` extracts each slide's text, tables, and speaker notes with a
bundled Python helper (`scripts/lib/pptx-extract.py`) built on **python-pptx** —
**not** pandoc (pandoc has no `.pptx` input format at all) and **not**
LibreOffice (avoids a heavyweight dependency for this one format). The helper is
invoked via Node's `execFileSync('python3', [...])`. This is a brand-new,
self-contained implementation shipped inside wiki-master — it does **not** shell
out to, or otherwise depend on, any other installed Copilot plugin's copy of
python-pptx glue, so wiki-master stays portable across machines regardless of
what else is installed.

Output is one `## Slide N` heading per slide (emitted even for a slide with no
extractable text, so slide numbering matches the real deck — useful for citing
"slide 7 says X"), followed by bullet/paragraph text, any table rendered as a
markdown table, and a `**Speaker notes:**` line when present. Then
`clip-pptx.mjs` writes `raw/clippings/<slug>.md` with the standard clipping
frontmatter (`source`, `created`, `tags:[clippings]`, `quality`, `source-hash`).
It skips duplicates and prior declines, and records a decline for a **thin**
extraction (empty or near-empty deck) so it is not retried blindly.

**Legacy `.ppt` (binary PowerPoint 97-2003) is explicitly unsupported** —
python-pptx cannot read that format at all. `clip-pptx.mjs` detects the `.ppt`
extension and fails clearly, telling you to convert to `.pptx` first, rather than
attempting extraction and reporting a confusing downstream error.

## Steps

1. **Preflight** (once): confirm python-pptx is installed —
   `python3 -c "import pptx"`. If it fails, tell the user to run
   `pip3 install python-pptx` and stop; do not fabricate content.
2. **Clip** (this is the only writer to `raw/` for PowerPoint decks):
   `node ../../scripts/clip-pptx.mjs "<path/to/file.pptx>" --source="<canonical-url-if-any>" --quality=<tier> --topic="<topic>"`
   - `--source` is the citable origin. Omit for a purely local file and the file
     path is recorded as the source.
   - **`--topic` whenever this clip belongs to a research run** — pass the topic
     string `/wiki-discover` was given, identical across every clip in the run,
     so `/wiki-triage` can group the run's leftovers together. **Topic is recorded
     going forward only and no tool can retro-fit it**, so a clip made without it
     is an *Unattributed* triage row permanently. Omit it only when there is no
     research run behind the clip; never invent one.
   - A `thin` or `failed` result means the deck is empty/corrupt/protected, or is
     a legacy `.ppt` — report it for manual handling; do not invent the text.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and sanity-check
   the slide text and any tables against the deck. Extraction drops slide design,
   layout, images, and chart *rendering* — table cell text is preserved, but a
   chart's visual is not.
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping — summarize
   into `wiki/sources/`, cross-reference, index, log. The ingest is gated by the
   user as usual.

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
