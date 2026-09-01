---
name: clip-docx
description: Clip a Word document (.docx/.doc, local file or downloaded paper) into the wiki as a Markdown clipping — extract its text with pandoc and store the MD representation, never the binary document, so provenance resolves to real notes. Use when a source is a Word file that /wiki-discover's HTML clipper (Defuddle) cannot handle and clip-pdf does not apply.
argument-hint: "<path/to/file.docx> [--source=\"<url>\"] [--quality=high|medium|low] [--topic=\"<topic>\"]"
---

> **Host portability (Claude Code, Copilot CLI, Codex):** Resolve bundled
> `scripts/` and `templates/` paths from this skill's installed directory:
> `../../` is the plugin root. Use quoted absolute paths when running helpers;
> do not resolve them from the current workspace or depend on plugin-root shell
> variables. For sibling skills, read `../<skill-name>/SKILL.md` if the host has
> no skill-loading tool. References such as `/wiki-health` mean that skill's
> workflow; in Codex, select the skill or ask for it by name. Treat `$ARGUMENTS`
> as the user's request when the host does not substitute it.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location and the provenance/`raw/`-immutability
> and clipping guardrails these steps assume. Skip the load if you arrived here mid-run
> from a wiki-master skill that already pulled it in.

# Clipping a Word document into the wiki

`/wiki-discover`'s clipper (`clip.mjs` → Defuddle) handles **HTML** pages only, and
`clip-pdf` handles **PDFs**. A `.docx`/`.doc` — e.g. an Academia.edu paper served
as Word rather than PDF — falls to neither, and clicking its "Download" is often
the *only* way to get the source. This skill is the Word path. **The canonical
stored artifact is the extracted Markdown, never the binary document** — that keeps
the vault greppable, diffable, and answerable, and makes `[[note]]` provenance
resolve to a real Markdown clipping rather than to an opaque attachment.

## How it works

`clip-docx.mjs` extracts text with **pandoc** (invoked via Node's `execFileSync`,
which resolves the Windows `.exe` correctly — do **not** shell out to `pandoc` from
a Bash tool per the PATHEXT hazard), then writes `raw/clippings/<slug>.md` with the
standard clipping frontmatter (`source`, `created`, `tags:[clippings]`, `quality`,
`source-hash`). It skips duplicates and prior declines, and records a decline for a
**thin** extraction (empty or near-empty document) so it is not retried blindly.
Pass **`--allow-short`** to clip a document that is genuinely brief — see step 2.

It deliberately mirrors `clip-pdf` but **omits the PDF-only machinery**:
- **No running header/footer stripping.** A `.docx` has no fixed pages, so pandoc
  emits no page-boundary chrome to strip (unlike `pdftotext`'s form-feeds).
- **No `fidelity: degraded` / OCR.** pandoc reads the document's XML directly, so
  there is no symbol-font mangling to flag and no scanned-image case to OCR — the
  extraction is clean Unicode prose. (A genuinely corrupt or password-protected
  file fails fast and is reported for manual handling, not invented.)
- **`--wrap=none`.** Prevents pandoc from hard-wrapping paragraphs at 72 columns,
  which would break verbatim spans across synthetic line breaks; `-t plain` strips
  markup to quotable prose in reading order.

## Steps

1. **Preflight** (once): confirm pandoc is installed — `pandoc -v`. If missing,
   tell the user to install pandoc (https://pandoc.org/installing.html) and stop;
   do not fabricate content.
2. **Clip** (this is the only writer to `raw/` for Word docs):
   `node ../../scripts/clip-docx.mjs "<path/to/file.docx>" --source="<canonical-url-if-any>" --quality=<tier> --topic="<topic>"`
   - `--source` is the citable origin (the paper's DOI/URL). Omit for a purely
     local file and the file path is recorded as the source.
   - **`--topic` whenever this clip belongs to a research run** — pass the topic
     string `/wiki-discover` was given, identical across every clip in the run,
     so `/wiki-triage` can group the run's leftovers together. **Topic is recorded
     going forward only and no tool can retro-fit it**, so a clip made without it
     is an *Unattributed* triage row permanently. Omit it only when there is no
     research run behind the clip; never invent one.
   - A `thin` or `failed` result means the document is empty/corrupt/protected —
     report it for manual handling; do not invent the text.
   - **`--allow-short` when the document is short on purpose.** The thin floor is
     100 words, and word count cannot tell a failed extraction apart from a
     complete one-page handout — a bare list, a blank worksheet, a vocabulary
     sheet. Open the file, confirm the extraction is whole, then re-clip with the
     flag. It is opt-in per clip precisely so every other clip keeps the safety
     net: never reach for it to push past a document you have not looked at, and
     never use it on one whose text pandoc actually failed to read.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and sanity-check
   that the extracted text is real prose. pandoc output is plain text — light and
   lossy on tables/figures.
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping — summarize
   into `wiki/sources/`, cross-reference, index, log. The ingest is gated by the
   user as usual.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped text is immutable
  source-of-truth (guardrail #1). Frontmatter is pipeline state, tooling-only.
- `clip-docx.mjs` is the **sole writer** to `raw/` for Word documents — the model
  never writes the clipping by hand (that would bypass dedup, decline, and hashing).
- **Fidelity, not truth**: a faithful extraction of a wrong paper is still wrong;
  pandoc can also drop table/figure structure — verify quotes against the document
  before they land on a wiki page (guardrail #5).
