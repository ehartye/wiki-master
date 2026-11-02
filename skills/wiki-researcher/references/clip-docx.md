Read [access and host commands](../../wiki-maintainer/references/access.md) before touching the vault. Also read for this operation: [operations](../../wiki-maintainer/references/operations.md).
Load the rest only when this run reaches it — [evidence](../../wiki-maintainer/references/evidence.md) before a quote or figure from this capture lands on a wiki page, or when reporting a fidelity limit.
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

# Clipping a Word document into the wiki

The HTML clipper (`clip.mjs` → Defuddle) handles **HTML** pages only, and
`clip-pdf` handles **PDFs**. A `.docx`/`.doc` — e.g. an Academia.edu paper served
as Word rather than PDF — falls to neither, and clicking its "Download" is often
the *only* way to get the source. This reference covers the Word path. **The canonical
stored artifact is the extracted Markdown, never the binary document** — that keeps
the vault greppable, diffable, and answerable, and makes `[[note]]` provenance
resolve to a real Markdown clipping rather than to an opaque attachment.

## How it works

`clip-docx.mjs` extracts text with **pandoc**, then writes `raw/clippings/<slug>.md` with the
standard clipping frontmatter (`source`, `created`, `tags:[clippings]`, `quality`,
`source-hash`). It skips duplicates and prior declines, and records a decline for a
**thin** extraction (empty or near-empty document) so it is not retried blindly.
Pass **`--allow-short`** to clip a document that is genuinely brief — see step 2.

It deliberately mirrors `clip-pdf` but **omits the PDF-only machinery**:
- **No running header/footer stripping.** A `.docx` has no fixed pages, so pandoc
  emits no page-boundary chrome to strip (unlike `pdftotext`'s form-feeds).
- **No `fidelity: degraded` / OCR.** pandoc reads the document's XML directly, so
  there is no symbol-font mangling to flag and no scanned-image case to OCR — the
  extraction is Unicode prose. Converter failures use the direct
  [Word diagnosis](../../wiki-setup/references/capture-prerequisites.md#word); never invent missing text.
- **`--wrap=none`.** Prevents pandoc from hard-wrapping paragraphs at 72 columns,
  which would break verbatim spans across synthetic line breaks; `-t plain` strips
  markup to quotable prose in reading order.

## Steps

1. **Preflight:** run the direct [prerequisite and diagnostic procedure](../../wiki-setup/references/capture-prerequisites.md#word) for this format. Missing tools or access never authorize invented evidence or automatic installation.
2. **Clip** (this is the only writer to `raw/` for Word docs):
   `node "<absolute-plugin-root>/scripts/clip-docx.mjs" "<path/to/file.docx>" --source="<canonical-url-if-any>" --quality=<tier> --topic="<topic>" --since <token>`
   - `--source` is the citable origin (the paper's DOI/URL). Omit for a purely
     local file and the file path is recorded as the source.
   - **`--topic` whenever this clip belongs to a research run** — pass the topic
     string researcher discovery was given, identical across every clip in the run,
     so maintainer triage can group the run's leftovers together. **Topic is recorded
     going forward only and no tool can retro-fit it**, so a clip made without it
     is an *Unattributed* triage row permanently. Omit it only when there is no
     research run behind the clip; never invent one.
   - For `thin` or `failed`, follow [Word diagnosis](../../wiki-setup/references/capture-prerequisites.md#word). `--allow-short` is opt-in for a genuinely brief, complete document only: inspect the original and extracted text first, never use it to bypass failed extraction.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and sanity-check
   that the extracted text is real prose. pandoc output is plain text — light and
   lossy on tables/figures.
4. **Only when ingestion is authorized, follow [ingestion](ingest.md)** for this exact clipping — summarize
   into `wiki/sources/`, cross-reference, index, log. Ingestion requires authorization for this scope; reuse explicit session authorization.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped text is immutable
  source-of-truth (guardrail #1). Frontmatter is pipeline state, tooling-only.
- `clip-docx.mjs` is the **sole writer** to `raw/` for Word documents — the model
  never writes the clipping by hand (that would bypass dedup, decline, and hashing).
- **Fidelity, not truth**: a faithful extraction of a wrong paper is still wrong;
  pandoc can also drop table/figure structure — verify quotes against the document
  before they land on a wiki page (guardrail #5).

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
