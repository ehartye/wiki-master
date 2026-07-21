# Changelog

## Unreleased

### The vault holds only `.md` and the images those `.md` files reference

Binaries (`.pdf`, `.docx`, `.xlsx`, `.zip`) are **never** in the vault, and the tooling
**never moves them**. They stay wherever you keep them. `clip-pdf` / `clip-docx` read a
binary **in place** and write only the resulting `.md` into `raw/clippings/`, recording the
binary's own path in the clipping's `source:`. Download a PDF → "clip that" → the PDF does
not move; a `.md` appears in the vault.

### OCR escalation now triggers on quality, not just quantity

`clip-pdf` previously escalated to OCR only when the text layer was *thin*
(`wordCount < 100`). A broken or symbol-font PDF yields **plenty** of words — just corrupted
ones — so those were never escalated and landed as `fidelity: degraded` with OCR untried.
Escalation now also fires when the extraction assesses as degraded, and keeps whichever pass
reads measurably better (`shouldTryOcr` / `preferBetterExtraction`), so OCR can never make a
clipping worse.

### Repairing a vault that has binaries in it

An older vault may contain binaries that summaries cite directly (`sources: ["[[X.pdf]]"]`).
Those citations have no readable provenance and no `source-hash` to join on. To repair:

1. **Move the binaries out of the vault** to any location you choose (this is a one-time
   cleanup — the tooling neither knows nor manages that location).
2. **Clip and repoint**, pointing the pass at wherever you put them:

   ```
   node scripts/clip-and-repoint.mjs --from=<dir>            # dry run
   node scripts/clip-and-repoint.mjs --from=<dir> --apply
   ```

   For each dangling citation it clips the binary in place, writes the `.md` to
   `raw/clippings/`, repoints every citing summary, and stamps `source-hashes`. Re-running is
   safe: a binary already clipped is reused, not re-clipped. Degraded extractions are still
   repointed (their `fidelity:` records the caveat) and filed to `/wiki-triage`.
3. **Stamp any hash-less clippings.** Clippings written before `source-hash` existed
   carry none, so they can never be hash-joined and their summaries stay stuck at
   `backfillPending`:

   ```
   node scripts/repair-missing-hash.mjs --apply
   node scripts/backfill-source-hashes.mjs --apply   # record the new hashes on the summaries
   ```

4. **Verify** with a health run. `provenanceGaps`, `backlog`, `missingHash`, and
   `backfillPending` should all reach 0; any remainder is a source with no text
   extractor (e.g. a spreadsheet), which is reference data rather than a prose source.

### Extraction prerequisites — and a Windows gotcha that will bite you

- **poppler** (`pdftotext`, `pdftoppm`) — PDF text + rasterizing. Required.
- **tesseract** — OCR fallback for scanned/degraded PDFs. Optional but strongly recommended.
- **pandoc** — `.docx` extraction. Required only for Word sources.

**On Windows, run extraction from PowerShell, not Git Bash.** Invoked from Git Bash,
`pdftotext` can emit Latin-1 bytes that Node then decodes as UTF-8, turning every non-ASCII
glyph into `U+FFFD`. The symptom is deceptive: ASCII prose extracts perfectly while every
equation, accent, and symbol becomes `░░░░`, so the clipping looks like a font/OCR problem when
it is purely an encoding artifact of the shell. The same PDF extracts cleanly under PowerShell.
If a clipping shows a high replacement-character count, re-extract from PowerShell before
concluding the source is bad. (See also `CLAUDE.md` §6.)

Also note a freshly-installed tool may be registered on the user PATH but absent from an
already-running shell's environment — verify with `Get-Command <tool>` from a new shell rather
than assuming it is missing.

## 0.4.0 — 2026-07-21

### Ingest-state tracking moves to a content-hash join

The ingest backlog is now computed by matching each clipping's `source-hash`
against the `source-hashes` recorded on `wiki/sources/` pages, instead of testing
whether a `[[wikilink]]` resolves. This fixes two false-positives that inflated the
backlog (172 phantom items on the reference vault, ~0 real):

- **Hash-suffix mismatch** — a summary citing `[[Title]]` never resolved to the
  clipping file `Title-<hash7>.md`. Hash equality is immune to the suffix.
- **Binaries counted as sources** — `.pdf/.xlsx/.zip` originals can never be a
  summary target; only `.md` clippings are now in the backlog universe.

It also delivers **re-ingest-on-change** for free (a re-clipped source gets a new
hash and reappears in the backlog) and adds two health metrics: `missingHash`
(clippings lacking a `source-hash`) and `backfillPending` (migration progress).

New frontmatter: `wiki/sources/` pages carry `source-hashes: [<sha256>, …]`. The
`sources: [[…]]` wikilink is retained for navigation. See
`docs/superpowers/specs/2026-07-21-hash-ingest-state-design.md`.

### Migrating existing vaults — run once per vault

A vault written before this release has source pages without `source-hashes`. A
transitional fallback keeps them credited (nothing regresses), but the backlog will
show phantom items again until the vault is migrated. **Agents: repair the vault by
running the one-time backfill.** From the plugin root:

```
node scripts/backfill-source-hashes.mjs            # dry-run: prints the plan + review queue
node scripts/backfill-source-hashes.mjs --apply    # writes source-hashes into wiki/sources/*.md
```

(The script resolves the vault via `WIKI_MASTER_VAULT`, default `~/.wiki-master-vault`.)

It is **idempotent** (only fills pages still missing the key) and **guesses
nothing**: ambiguous or unresolved citations are reported for human review, never
written. Expected benign residual — citations to binary originals (`unresolved`) and
clippings with no `source-hash` (`nohash`).

- **If your vault is git-synced across machines:** run the backfill on one machine
  and commit the vault. Every other machine is then already repaired — the
  `source-hashes` live in the vault's markdown, not in the plugin — so no per-machine
  action is needed beyond pulling the vault.
- **If machines hold independent (unsynced) vaults:** run it once on each machine.
- **Verify:** a health run should show `backfillPending` approaching 0 and the ingest
  backlog dropping to its true residual.

A follow-up release will remove the transitional link-resolution fallback once
vaults are expected to be migrated (track readiness via `backfillPending`).
