---
name: clip-pdf
description: Use when asked to save or clip a local or downloaded PDF into the wiki as Markdown evidence. For Word documents use clip-docx; for existing clippings use wiki-ingest.
argument-hint: "<path/to/file.pdf> [--source=\"<url>\"] [--quality=high|medium|low] [--topic=\"<topic>\"] [--figures[=auto|all|3,5-7]]"
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read [access and host commands](../wiki-maintainer/references/access.md) before touching the vault. Also read for this operation: [operations](../wiki-maintainer/references/operations.md).
Load the rest only when this run reaches it — [evidence](../wiki-maintainer/references/evidence.md) before a quote or figure from this capture lands on a wiki page, or when reporting a fidelity limit.
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

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

1. **Preflight** (once): `node "<absolute-plugin-root>/scripts/clip-pdf.mjs" --doctor`. It probes every
   external tool and prints what each missing one costs you; it is silent-and-OK only
   when all four are present. The clipper also prints this banner on **every** run
   when something is missing, so a degraded toolchain cannot go unnoticed. A missing
   `pdftotext` is fatal and the clipper exits — do not fabricate content. The rest are
   degradations: no `-table` loses table row pairings, and no `pdftoppm`/`tesseract`
   means scanned PDFs cannot be read at all.
2. **Clip** (this is the only writer to `raw/`):
   `node "<absolute-plugin-root>/scripts/clip-pdf.mjs" "<path/to/file.pdf>" --source="<canonical-url-if-any>" --quality=<tier> --topic="<topic>"`
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
   - `--figures[=auto|all|3,5-7]` also renders figure pages (see **Preserving figures**).
     Pass it whenever the PDF's value is in graphs, diagrams or photos.
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
   into `wiki/sources/`, cross-reference, index, log. Ingestion requires authorization for this scope; reuse explicit session authorization. **If the clipping carries `fidelity: degraded`, do not quote its
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

## Preserving figures (`--figures`)

Text extraction loses every figure, and in a PDF a graph is usually **vector
drawing**, not an embedded image, so `pdfimages` alone misses it. `--figures`
therefore renders **whole pages** with `pdftoppm -r 200 -png` and stores them in the
vault's figure convention.

```bash
node "<absolute-plugin-root>/scripts/clip-pdf.mjs" "<file.pdf>" --source="<url>" --figures            # auto
node "<absolute-plugin-root>/scripts/clip-pdf.mjs" "<file.pdf>" --figures=all | --figures=3,5-7 --figures-max=60
# figures for a clipping that already exists, from a PDF you supply:
node "<absolute-plugin-root>/scripts/clip-pdf.mjs" "<file.pdf>" --figures-only --clipping raw/clippings/<name>.md
```

- **Pages chosen.** `auto` (the bare-flag default) selects a page when either holds:
  1. **Raster:** `pdfimages -list` shows an `image` row (not `smask`/`mask`) at least
     100x100 px and 0.75 in on the page, not a logo object repeated on half the pages.
  2. **Vector:** `pdftocairo -svg` shows at least 30 drawing elements outside glyph
     definitions AND the page is text-light (no text layer, or under 80 % of the
     document's median non-space characters per page), or at least 600 drawing
     elements regardless of text. A document whose text is outlined (no text layer
     at all) selects every drawn page. Raster pages skip the slower SVG probe.

  It is deterministic and approximate: box-and-arrow diagrams on text pages are
  caught by the 30-element floor, but a ruled table can be a false positive and a
  figure drawn with very few strokes can be missed. Use `--figures=all` or a page
  list when the choice matters. `all` renders every page; a list renders exactly those.
- **Cap.** At most 40 pages per run (`--figures-max=N` to raise); a truncation is
  reported. Pages are not cropped: sidecars say `crop: full`.
- **Output.** `raw/figures/<clipping-slug>-p<N>.png` plus `<same>.md` with frontmatter
  `source`, `page`, `crop: full`, `dpi: 200`, `sha256`, `captured`,
  `clipping: "[[raw/clippings/<file>.md]]"`, `ai-generated: false`, then `# Title, page N`
  and a one-line machine description naming the candidates detected (`raster`,
  `vector`, or "none detected" for a page chosen by request).
- **Clipping frontmatter.** `figures: ["raw/figures/<slug>-p3.md", ...]` is added to the
  clipping's FRONTMATTER, after `source-hash`. The body is never edited. Only this tool
  writes it; it is pipeline state like `fidelity`.
- **Idempotent.** A page whose PNG hash already matches is left alone; a PNG identical
  to any existing figure is skipped as a duplicate; a sidecar with `crop` other than
  `full` (a hand-cropped figure) is never overwritten.
- **`--figures-only`** needs `--clipping <path>` (vault-relative, absolute or relative).
  It checks the PDF first: `source-hash` hashes the clipping's extracted text, so the
  PDF is re-extracted the way the clipping was and the hashes compared. A mismatch is
  refused (`--allow-pdf-mismatch` overrides); a clipping with no `source-hash` or one
  made by OCR cannot be checked and only warns.
- **Tools.** poppler `pdftoppm` (required), `pdfimages`, `pdftocairo`, `pdfinfo`; found
  on PATH or in the winget poppler folder. Missing tools never fail the clip: the run
  prints what is missing and how to install it (`--doctor` lists it), and `auto`
  degrades to whichever probe is available.
- **Operation bracket.** Figure PNG/sidecars and the clipping's frontmatter edit are
  ordinary vault writes inside the same `op-begin`/`op-commit` as the clip; op-commit
  commits whatever became dirty, so nothing extra is needed. `health.mjs` treats
  `raw/figures/` as assets, not clippings, so they never count toward the ingest backlog
  or as missing a `source-hash`.
- A render is a faithful page, not an interpretation. Describe what a figure shows only
  from looking at it (see wiki-ingest).

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
node "<absolute-plugin-root>/scripts/clip-pdf.mjs" "<file.pdf>" --mode=reading-order --source="<url>"
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
  source-of-truth (guardrail #1). Frontmatter is pipeline state, tooling-only
  (`fidelity`, `figures`).
- Figures are rendered pages, never crops or redrawings; do not hand-edit `raw/figures/`.
- `clip-pdf.mjs` is the **sole writer** to `raw/` for PDFs — the model never writes
  the clipping by hand (that would bypass dedup, decline, and hashing).
- **Fidelity, not truth**: a faithful extraction of a wrong paper is still wrong;
  `pdftotext` can also mangle multi-column layouts — verify quotes against the PDF
  before they land on a wiki page (guardrail #5).

## Completion

For a standalone clip, open an operation before the clipping helper writes, verify
its returned paths and extraction diagnostics, log once, commit and verify
already-authorized sync through the shared operations contract. During discovery,
use the enclosing operation and report the results to its owner for completion.
Capturing evidence does not by itself authorize ingestion; reuse explicit
discover-and-ingest authorization when it is already present.
