# Extract-and-repoint: make the raw evidence layer uniform — Design Spec

**Date:** 2026-07-21
**Status:** Draft → awaiting confirmation of §8 decisions, then implementation.
**Author:** Design conversation (follow-up to `2026-07-21-hash-ingest-state-design.md`)

---

## 1. Summary

~92 `wiki/sources/` pages cite a **binary original directly** — `sources: ["[[X.pdf]]"]` —
because a bulk import (the construction-bidding corpus) dropped PDFs/xlsx/docx into `raw/`
and summarized them without ever running the clip pipeline. Confirmed: **0 of the 92 have a
`.md` clipping twin.** This violates the clip contract (*"store the MD representation, never the
binary document, so provenance resolves to real notes"*) and is why they have no `source-hash` to
join on — their provenance points at an unreadable blob.

This pass makes the raw layer **uniform**: for each such binary, **mechanically extract** its text
to a `.md` clipping (with a `source-hash`), then **repoint** the citing summary from the binary to
the new clipping. No re-summarization — the summary already exists; it just gains a real, hashable
evidence artifact to cite. After this pass, every prose source is a hashed `.md` clipping, so
`backfillPending`, `missingHash`, and the backlog can all reach a true 0 without any terminal-marker
machinery for these pages.

**Two layers, and only one must be uniform:**
- `raw/clippings/*.md` — mechanical **text extraction** (the evidence), carries `source-hash`. **Uniform.**
- `wiki/sources/*.md` — the LLM's **semantic summary** (compiled knowledge), *cites* the clipping. Untouched here except the one citation it repoints.

---

## 2. Scope

- **In:** binaries under `raw/` that a `wiki/sources/` page cites via a `[[…]]` wikilink and that have
  **no `.md` twin** — `.pdf` → `clip-pdf`, `.docx` → `clip-docx`.
- **Terminal remainder (not forced uniform):** `.xlsx` (≈3) and any binary that fails extraction or
  extracts to poor fidelity. A spreadsheet of unit prices is reference *data*, not a prose source; a
  scanned PDF that won't OCR is genuinely unextractable. These are **not** repointed — they are queued
  to triage and become candidates for the empty-inbox marker (`source-hashes: []`, per the hash-ingest
  spec's follow-up), the honest terminal state for the small irreducible set.
- **Exempt — images stay.** The vault rule is "no binary **source documents**," not "no binaries."
  Display images (`.png/.jpg/.jpeg/.gif/.svg/.webp`) are rendered content a note embeds, not sources to
  read — they live in the vault and are retained. The enforcement guard (§7) whitelists image extensions;
  it flags/evicts only source-document binaries (`.pdf/.docx/.xlsx/.zip`). (The vault has 0 images today,
  so this is a forward-looking exemption, not a migration.)
- **Out:** the 17 `missingHash` `.md` clippings (already `.md`; a separate trivial "stamp the hash"
  pass, see §9); re-summarizing; fidelity-diffing a summary against its extraction.

---

## 3. Principles

- **Reuse the existing extractors** — `scripts/clip-pdf.mjs` (`pdfToText`, `pdfToTextOcr`,
  `pdfClipContent`, `assessFidelity`) and `scripts/clip-docx.mjs`. No new extraction logic; this pass
  is orchestration over battle-tested clippers.
- **The `.md` extract becomes the in-vault source of truth; the binary is moved OUT, not deleted.**
  The pass adds the `raw/clippings/*.md` extraction, repoints the summary's one citation, and — **only
  after the extract passes the sanity check** — **moves** the binary from the vault to the originals
  working dir (`WIKI_MASTER_ORIGINALS`, default `~/.wiki-master-original-binaries`), preserving its
  relative subpath. The clipping's `source:` records the new location, so the original stays available
  for reprocessing but is never in the vault or its git sync. Content (`.md` + images) is what syncs.
- **Sanity-check gates the move (the one hard guard).** Clean extraction → repoint + move the binary out.
  Degraded/failed/no-extractor → **leave the binary in place**, do **not** repoint, queue to triage.
  We never strand a source's content by evicting a binary we couldn't capture.
- **Going forward: binaries never persist in the vault.** New ingests extract to `.md` in place, then the
  original binary lands in the originals working dir — the clip pipeline never leaves a doc binary under
  `raw/`. Images are the sole exception (`raw/attachments/`, kept).
- **Dry-run by default, idempotent.** `--apply` to write; re-runnable (skips binaries that already have
  a twin). Git-tracked vault → reversible.

---

## 4. Mechanics

For each in-scope binary `B` cited by summary page(s) `P`:

1. **Skip if already uniform** — a `raw/clippings/*.md` whose `source:` frontmatter is `B` already
   exists (idempotency). 
2. **Extract** — `.pdf`: `pdfToText(B)`; if `assessFidelity` reports degraded and OCR is reachable,
   escalate to `pdfToTextOcr(B)` (mirrors `clip-pdf.mjs main`). `.docx`: the `clip-docx` extractor.
   Build the clipping via `pdfClipContent({ title: titleFromPdf(B), source: <vault-rel path of B>, text })`
   → `{ body, hash, fidelity, slug }`.
3. **Write the clipping** — `raw/clippings/<slug>-<hash7>.md` (disambiguated as the clippers already do).
   The clipping's `source:` records `B`, so provenance chains summary → clipping → original.
4. **Gate on fidelity:**
   - `fidelity === 'high'` → **repoint** every citing page `P`: in `P`, replace the exact `[[<B-target>]]`
     token in `sources:` with `[[raw/clippings/<slug>-<hash7>.md]]`, and add `source-hashes: [<hash>]`
     (reuse `insertSourceHashes`). Other citations on `P` are untouched.
   - `fidelity === 'degraded'` (or extraction threw) → **do not repoint.** Keep the clipping for review,
     leave `P` citing `B`, and `recordIssue(vault, { url: B, kind: 'fidelity', reason })` so it surfaces
     in `/wiki-triage`.
5. **Report** — `{ extracted, repointed, degraded, skipped-existing, terminal-xlsx, failed }` with paths.

A binary cited by multiple pages is extracted once and every citing page is repointed. A page citing
multiple binaries has each citation handled independently.

---

## 5. New code

- `scripts/lib/repoint.mjs` (pure, unit-tested):
  - `repointCitation(pageText, fromTarget, toTarget)` — replace the exact `[[fromTarget]]` wikilink with
    `[[toTarget]]` inside the `sources:` line only; returns unchanged text if not present.
  - reuses `insertSourceHashes` from `lib/backfill.mjs`.
  - `planExtractRepoint({ pages })` → the in-scope binary → citing-pages map, by extension, excluding
    binaries that already have a twin. Pure over the graph (I/O-free) for testing.
- `scripts/extract-repoint.mjs` — CLI orchestrator: `buildGraph` → `planExtractRepoint` → per binary
  extract (clip-pdf/clip-docx) → gate → write clipping + repoint (only under `--apply`) → JSON report.
  Dry-run prints the plan and the extension/fidelity tally without extracting.

---

## 6. Test plan (TDD — write first)

Pure-function tests (`test/repoint.test.mjs`):
1. `repointCitation` swaps `[[X.pdf]]` → `[[raw/clippings/X-abc1234.md]]` in the `sources:` line, leaving
   body and other frontmatter intact.
2. `repointCitation` leaves a page unchanged when the target isn't present (idempotent / not-a-match).
3. A multi-source `sources:` list repoints only the matching entry, preserves the others.
4. `planExtractRepoint` selects only binaries with a citing `wiki/sources` page and **no** `.md` twin;
   excludes `.pdf` that already has a twin; buckets `.xlsx` as terminal.
5. Combined with `insertSourceHashes`: a repointed page ends with the new wikilink **and**
   `source-hashes: [<hash>]`.

Extraction itself is already covered by `test/clip-pdf.test.mjs` / `test/clip-docx.test.mjs`; this pass
adds an integration test that a high-fidelity fixture PDF yields a clipping and a repointed page, while a
degraded fixture yields a clipping + a triage issue and **no** repoint.

---

## 7. Metric interaction

- After a fully-applied pass, the 82 binary-only pending pages become migrated (`source-hashes` present) →
  `backfillPending` drops toward the terminal remainder (xlsx + degraded), and combined with the §9
  missing-hash pass reaches **0**.
- **Decision (D3):** the binary is **moved out** of the vault after its content is captured, so it never
  lingers as an uncited `raw/` file and `unparsedSources` is unaffected — the vault stays text-only. A
  `binariesInVault` guard (whitelisting images) flags any doc binary still under `raw/` (the un-captured
  remainder), so the invariant is visible and enforced rather than assumed.

---

## 8. Decisions to confirm

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| **D1** | `.xlsx` (≈3) + unextractable | **Terminal remainder** — queue to triage, mark `source-hashes: []` later | Force a lossy table→markdown extraction |
| **D2** | Degraded-fidelity extractions | **Write clipping, don't repoint, queue to triage** (human confirms) | Auto-repoint anyway (risks citing gibberish) |
| **D3** | The original binary, post-capture | **Move it out to `~/.wiki-master-original-binaries` once content is captured** (clean extract or `.md` twin) — preserved for reprocessing, never in vault/sync | Delete (lossy, irreplaceable) / keep in vault (not text-only) |
| **D4** | Repoint citation form | **Hash-qualified path `[[raw/clippings/…-hash7.md]]` + `source-hashes`** | Bare basename wikilink + `source-hashes` |

---

## 9. Companion (separate, trivial) — the 17 `missingHash` clippings

Out of this spec's scope but needed for a true 0: the 17 `.md` clippings lacking a `source-hash` are
already uniform in *format* — they only need the field stamped. A `--repair-missing-hash` pass computes
`sha256` of each clipping's markdown body and writes `source-hash:` into its frontmatter (legitimate — raw
frontmatter is pipeline state), then the backfill migrates their pages. Can be folded into
`extract-repoint.mjs` or shipped as its own tiny script.

---

## 10. Acceptance

- Every in-scope `.pdf`/`.docx` either has a high-fidelity `.md` twin with its citing page repointed, or a
  written clipping + a triage issue (degraded).
- `backfillPending` and `missingHash` reach the terminal remainder only (xlsx + genuinely-degraded), and
  0 after the §9 pass + triage dispositions.
- Backlog stays 0; every prose source resolves to a readable `.md` clipping, not a binary.
- Full test suite green; the pass is dry-run-first and reversible via git.

---

## 11. Out of scope

- Re-summarizing (summaries already exist and are untouched but for the one repointed citation).
- Diffing each summary against its fresh extraction for fidelity (a separate quality pass worth doing later).
- Deleting binaries — they are moved to the originals working dir, never deleted (D3).
- The transitional-fallback removal in the hash-ingest spec (gated on all vaults migrating).
