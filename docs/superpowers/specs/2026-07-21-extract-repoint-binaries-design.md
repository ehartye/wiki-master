# Clip-in-place: give binary-cited summaries a real `.md` source — Design Spec

**Date:** 2026-07-21
**Status:** Revised. Supersedes an earlier draft that proposed relocating binaries into a
holding directory — that idea is dropped entirely.
**Author:** Design conversation (follow-up to `2026-07-21-hash-ingest-state-design.md`)

---

## 1. The vault rule

**The vault contains only `.md` files and the images those `.md` files reference. Nothing else.**

Binaries (`.pdf`, `.docx`, `.xlsx`, `.zip`) are **never** in the vault, and tooling **never moves
them**. They live wherever you keep them — a downloads folder, a papers directory, anywhere. The
clip pipeline **reads a binary in place** and writes only the resulting `.md` into
`raw/clippings/`, recording the binary's own path in the clipping's `source:` frontmatter.

Download a PDF → "clip that" → the PDF stays exactly where it was; a `.md` appears in
`raw/clippings/`. The pipeline is non-destructive to your files and imports nothing.

`scripts/clip-pdf.mjs` already behaves this way (it takes a path to a PDF anywhere on disk and
writes only the `.md`), so **no change is needed to the forward pipeline.**

## 2. The problem this pass fixes

107 `wiki/sources/` pages cite a binary directly — `sources: ["[[X.pdf]]"]` — with no `.md`
clipping behind them, because a bulk import put binaries in the vault and summarized them without
running the clip pipeline. Those summaries' provenance resolves to an unreadable blob, and they
have no `source-hash` to join on (they are the bulk of `backfillPending`).

## 3. The pass

For each such summary's binary, wherever it now lives:

1. **Clip it in place** — extract text → `raw/clippings/<slug>-<hash7>.md`, with `source:` set to
   the binary's path and a `source-hash` computed from the extracted markdown.
2. **Repoint the summary** — swap the `[[X.pdf]]` citation for the new clipping (`repointCitation`)
   and record `source-hashes: [<hash>]` (`insertSourceHashes`).

The 84 binaries that already have a `.md` twin need **no action** — their content is captured and
their summaries already cite the clipping.

## 4. Extraction quality — surfaced, then solved

A degraded extraction is a **quality signal raised during clipping**, not a gate that blocks the
pass. `assessFidelity` earns its keep: on an equation-heavy thesis it correctly caught that the
prose extracted cleanly while every equation decoded to nothing (a symbol font pdftotext can't map).

The remedy is better extraction, not abandonment: `pdfToTextOcr` (poppler `pdftoppm` + `tesseract`,
both present) exists exactly for "dropped accents, **symbol-font math**, and scanned PDFs." The work
is to make the text-layer → OCR escalation actually fire and to prefer whichever result assesses
cleaner. A clip that still degrades after escalation is reported for a human pass — nothing is lost,
since the binary is untouched wherever it lives.

**Do not persist a clipping that fails the gate into `raw/clippings/`** — an unrepointed clipping
becomes an orphan and pollutes the ingest backlog. Assess first, write only what passes.

## 5. Enforcement

A `binariesInVault` health check flags any file in the vault that is not `.md` and not an image
referenced by a `.md`. That keeps the §1 rule true going forward instead of assumed.

## 6. Out of scope

- **Any holding/originals/archive directory for binaries.** Deliberately not a pattern; binaries
  simply are not the vault's concern.
- Re-summarizing (summaries exist; only their citation changes).
- Image localization — separate pass (download `.md`-referenced images into the vault).
