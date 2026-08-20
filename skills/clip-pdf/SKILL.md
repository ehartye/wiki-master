---
name: clip-pdf
description: Clip a PDF (local file or downloaded paper) into the wiki as a Markdown clipping — extract its text and store the MD representation, never the binary PDF, so provenance resolves to real notes. Use when a source is a PDF that /wiki-discover's HTML clipper (Defuddle) cannot handle.
argument-hint: "<path/to/file.pdf> [--source=\"<url>\"] [--quality=high|medium|low] [--topic=\"<topic>\"]"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/clip-pdf.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location and the provenance/`raw/`-immutability
> and clipping guardrails these steps assume. Skip the load if you arrived here mid-run
> from a wiki-master skill that already pulled it in.

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

`clip-pdf.mjs` extracts text with **`pdftotext`** — either the **Xpdf** or the
**poppler** build, probed at runtime, with Xpdf preferred because only it provides
the `-table` mode that reads a tabular PDF without destroying its rows (invoked via Node's
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
- **Reading mode chosen per document, not globally.** `pdftotext` has two
  incompatible-by-design modes and the right one depends on the layout:
  - *Reading-order* (default) follows the text stream column-by-column. Correct for a
    **two-column paper** — each column reads top-to-bottom and hyphenated breaks are
    joined, so prose comes out quotable.
  - *Aligned* (`-table`) preserves horizontal position, so a row's cells stay on one
    output line. Correct for a **table**; it interleaves a two-column paper.

  Applied globally, either one is wrong for half of all documents. Reading-order mode
  on a **table** emits it column-block-wise — the whole key column, then the whole
  value column — so every row's key is detached from its value and the pairing is
  unrecoverable from the output. So the clipper samples the first pages both ways and
  routes on the result: if short standalone lines get *re-attached* as the leading
  token of a longer line in aligned mode, the document is tabular.
- **A tabular clipping never claims plain `high` fidelity.** Recovered rows are stamped
  `extraction: table-aware` + **`fidelity: tabular`** — the pairings were *reconstructed
  from horizontal position*, not read off a structured source, so confirm a pairing
  before quoting it as verbatim.
- **`-table` is an Xpdf feature; poppler does not have it.** When the installed
  `pdftotext` cannot align a document that was detected as tabular, the clipper
  **warns on stderr and stamps `extraction: table-flattened` + `fidelity: degraded`**
  rather than writing a clean-looking clipping whose rows are silently mispaired.
  Install the [Xpdf command-line tools](https://www.xpdfreader.com/download.html) and
  re-clip to recover the rows. `-layout` is deliberately **not** used as a fallback:
  measured on a real standards PDF it stacks consecutive keys into a column while
  their values drift, which reads as fixed and is not.
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
  **`fidelity: degraded`**. Clean captures omit the field. The full set of values a
  clipping can carry is: *(absent)* = high, **`tabular`** = rows reconstructed from
  layout, **`degraded`** = do not trust verbatim spans. A degraded *assessment*
  always outranks a tabular one — wrong characters are the worse defect.
- **Re-assessment cannot clear a table flag.** `refresh-fidelity.mjs` re-derives
  fidelity from the stored text and drops flags that no longer hold, but a
  table-derived flag has no basis in the characters (a flattened table reads as
  clean prose), so clippings carrying `extraction: table-aware` or `table-flattened`
  are preserved rather than cleared.

## Steps

1. **Preflight** (once): `node ../../scripts/clip-pdf.mjs --doctor`. It probes every
   external tool and prints what each missing one costs you; it is silent-and-OK only
   when all four are present. The clipper also prints this banner on **every** run
   when something is missing, so a degraded toolchain cannot go unnoticed. A missing
   `pdftotext` is fatal and the clipper exits — do not fabricate content. The rest are
   degradations: no `-table` loses table row pairings, and no `pdftoppm`/`tesseract`
   means scanned PDFs cannot be read at all.
2. **Clip** (this is the only writer to `raw/`):
   `node ../../scripts/clip-pdf.mjs "<path/to/file.pdf>" --source="<canonical-url-if-any>" --quality=<tier> --topic="<topic>"`
   - `--source` is the citable origin (the paper's DOI/URL). Omit for a purely
     local PDF and the file path is recorded as the source.
   - **`--topic` whenever this clip belongs to a research run** — pass the topic
     string `/wiki-discover` was given, identical across every clip in the run.
     It is what lets `/wiki-triage` group the run's leftovers together. **Topic is
     recorded going forward only: there is no tool that can retro-fit it**, so a
     clip made without it is an *Unattributed* triage row permanently. Omit it
     only for a one-off clip with no research run behind it — an invented topic
     is worse than none, because it files the row under a heading the user has
     already worked through.
   - `--mode=auto|reading-order|table` overrides the reading-mode detector for a
     document it gets wrong. See **Overriding the reading mode** below.
   - A `thin` result means the PDF is scanned/encrypted and OCR also failed — a
     decline is recorded. An `ocr-unavailable` result means the OCR toolchain is
     missing, so **nothing was learned about the PDF** — no decline is recorded;
     install the tools and re-clip. Never invent the text either way.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and sanity-check
   that the extracted text is real prose, not garbled ligatures. `pdftotext`
   output is plain text — light and lossy on tables/figures.
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping — summarize
   into `wiki/sources/`, cross-reference, index, log. The ingest is gated by the
   user as usual. **If the clipping carries `fidelity: degraded`, do not quote its
   equations/symbols verbatim** — paraphrase them with attribution and verify every
   quoted span against the original PDF (guardrail #5). Note the fidelity ceiling
   on the resulting source page so a reader knows.
   - **`fidelity: tabular`** means the row pairings were reconstructed from layout.
     Cell *contents* are verbatim; which cell pairs with which is the reconstruction.
     Verify any code-to-text pairing against the PDF before a wiki page asserts it,
     and do not derive counts from it without checking.
   - **`extraction: table-flattened`** means the rows were **lost** and could not be
     recovered on this machine. Do not assert any pairing from such a clipping;
     install the Xpdf tools and re-clip instead.

## Overriding the reading mode

The detector is a heuristic on a continuum, and it has a measured false-positive
class: **a document with margin annotations beside a body column**. The CCSS
Progressions volume scores 0.30–0.37 against a 0.35 threshold along its whole
length, so it trips as tabular. Read with `-table` it splices each margin standards
note into the body line beside it and leaves hyphenated breaks unjoined — no span
of it is quotable, yet it reads as ordinary prose and is stamped only
`fidelity: tabular`, which looks like a minor caveat. **Assume neither mode is
right until you have looked at the output.**

```bash
node ../../scripts/clip-pdf.mjs "<file.pdf>" --mode=reading-order --source="<url>"
```

- `auto` (default) — the detector chooses.
- `reading-order` — force reading-order. Correct for prose, two-column papers, and
  body+margin layouts. Joins hyphenated line breaks; reads each column whole.
- `table` — force aligned reading. Correct for a real table. Always floors fidelity
  at `tabular`, because aligned output is reconstructed from horizontal position
  however you arrived at it.

An override that **diverges** from the detector is recorded, not silent: the
clipping is stamped `extraction: reading-order-forced` and the run warns on stderr.
An override that agrees with the detector is a no-op and is not annotated. An
unknown `--mode=` value is an error, and `--mode=table` on a pdftotext without
`-table` is refused rather than quietly downgraded — believing you forced a mode
that was not applied is the failure this whole module exists to prevent.

**How to tell which mode a document wants** — extract two pages both ways and look:

```bash
pdftotext -enc UTF-8 -f 40 -l 41 "<file.pdf>" -            # reading-order
pdftotext -enc UTF-8 -f 40 -l 41 -table "<file.pdf>" -     # aligned
```

If aligned mode puts *unrelated* text on the same line, it is a two-column or
margin layout — use `reading-order`. If reading-order emits a whole key column
followed by a whole value column, it is a table — use `table`.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped text is immutable
  source-of-truth (guardrail #1). Frontmatter is pipeline state, tooling-only.
- `clip-pdf.mjs` is the **sole writer** to `raw/` for PDFs — the model never writes
  the clipping by hand (that would bypass dedup, decline, and hashing).
- **Fidelity, not truth**: a faithful extraction of a wrong paper is still wrong;
  `pdftotext` can also mangle multi-column layouts — verify quotes against the PDF
  before they land on a wiki page (guardrail #5).
