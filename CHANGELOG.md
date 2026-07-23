# Changelog

## 0.7.1 — 2026-07-22

### Oversized pages become searchable (truncate-on-failure) + drift run survives them

0.7.0 shipped "skip and log" for a page exceeding the embedding model's context window. Against
the live vault that had grown to 23 pages (~2% of the corpus) that were invisible to the semantic
channel and re-failed on every single search (23 doomed Ollama calls per run, forever, because a
failure is never cached).

- `semanticSearch` now retries a failing oversized body truncated to its first 4000 chars — the
  page's most representative slice (title, frontmatter, opening) — and caches the vector under the
  **full**-body hash, the same key `drift.mjs` shares. The page becomes semantically searchable and
  no later run re-fails it. A *short* failing body gets no retry: an identical input would fail
  identically (e.g. Ollama is down). Verified live: all 23 pages embedded, two of them immediately
  surfaced in a real query's results.
- `computeDrift` gets the per-page guard `semanticSearch` already had (it was never backported):
  one un-embeddable page or raw source — raw sources run longest, so they're likeliest to trip the
  context limit — no longer crashes the entire drift run. Failures are returned as `failed` and
  reported, never silent.

Full chunking was considered and deliberately deferred: it breaks the one-vector-per-page cache
contract shared with `drift.mjs` and starts re-implementing what the qmd tier already does
properly. If semantic recall on long pages matters, install qmd (tier 1).

## 0.7.0 — 2026-07-22

### `/wiki-query` gets real semantic search — tiered, never a hard dependency

`/wiki-query`'s entire retrieval step was one `obsidian search` keyword call. The source pattern
wiki-master implements explicitly anticipates this gap and explicitly names a tool for it (`qmd`),
while explicitly licensing a simpler home-built alternative in the same breath. Measured directly,
this vault (357 sources, 563 wiki pages) is already past the range the source pattern says
index-only navigation covers comfortably.

New `scripts/search.mjs`: three tiers, each degrading to the next.
1. `qmd`, if detected on `PATH` (never a package.json dependency — shelled out to exactly like
   `obsidian`/`defuddle` already are).
2. Ollama embedding + brute-force cosine, reusing the *existing* `embed.mjs` client and
   `.wiki-master/embeddings.json` cache `drift.mjs` already populates (extracted into a shared
   `lib/embed-cache.mjs` so the two features can never drift apart) — merged with the keyword
   channel by Reciprocal Rank Fusion.
3. `obsidian search` keyword-only — the pre-existing baseline, always available.

Two real bugs surfaced only by testing against the live vault, both fixed:
- The `obsidian` CLI's `search` command prints the plain-text `"No matches found."` even with
  `format=json` requested, which broke JSON parsing on any zero-hit query.
- One real wiki page exceeded the embedding model's context window; Ollama returned HTTP 500.
  A single oversized page now degrades to "skip and log," not "crash the whole search."

`qmd`, if used, is invoked via its lightweight `search` subcommand specifically — its `vsearch`/
`query` commands were confirmed, live, to each pull an additional 1.28GB+ model on first use, a
surprise this integration deliberately avoids triggering.

Full design: `docs/superpowers/specs/2026-07-22-semantic-search-design.md`. Implementation plan
+ real findings: `docs/superpowers/plans/2026-07-22-semantic-search.md`. Prior art:
`docs/superpowers/research/2026-07-22-semantic-search-prior-art.md`.

## 0.6.0 — 2026-07-22

### A fifth page type for content that never had a `raw/` source

Everything under `wiki/` was, until now, a summary or analysis derived from a
captured `raw/` source, and the vault contract enforced that: every wiki page
cites its provenance, scored as a defect when it doesn't. That left nowhere to
put a genuinely original document — advisory documentation, policy, house
style — written directly into the wiki rather than derived from anything.

New `wiki/authored/` (`type: authored`): original, primary content that
declares its exception explicitly via the vault's existing `sources: []`
disclosure (unchanged mechanism — a page stating it rests on no external
artifact was already excluded from provenance scoring; this just gives it a
first-class folder, catalog section, template, and a full narrative license
like `wiki/syntheses/`). It is a living page like any other under `wiki/`:
revised in place over time, never requiring a `raw/` counterpart.

Bundled fix: `checkQuotes` (quote-lint) did not consult the `sources: []`
disclosure at all, so any quotation on a declared-no-provenance page was
flagged as unverifiable against zero evidence — 100% false-positive by
construction. It now skips those pages entirely, the same way it already skips
sentences that declare themselves unsourced.

See `docs/superpowers/specs/2026-07-22-authored-pages-design.md` for the full
design and the decisions behind the naming and licensing choices.

## 0.5.4 — 2026-07-22

### The skill asserted a scale bound its source never stated

`wiki-maintainer` told agents that "index-only navigation **is bounded**" at ~100
sources and that "**past that**" entry shifts to search. The source pattern says no
such thing. It reports that index-first navigation "works surprisingly well at
moderate scale (~100 sources, ~hundreds of pages)" — a positive claim about a range,
with no threshold and no failure mode. Six lines later, under a heading marked
*Optional*, it separately says "as the wiki grows you want proper search" and
suggests `qmd`, attaching no number. The two passages are not joined in the source.

Welding them turned "works well at X" into "fails past X" and manufactured a
threshold agents would cite as the source's own. The section now states the range,
says explicitly that ~100 is **not** a ceiling and must not be presented as the
trigger for adopting search tooling, and gives what is fair to assert instead: a
vault far past that figure is outside the range the source reports, and nobody has
measured what that costs.

**Why nothing caught it.** Every quotation in the chain was verbatim. The drift lived
entirely in the unquoted framing around an accurate quote — `bounds`, `explicitly`,
`stated ceiling`, `anticipates this`. Quote-lint compares quoted spans against
clippings and has no way to see that a correct quote has been mischaracterised by the
sentence introducing it. Worth recording as a limit of the verification tier rather
than a bug to fix: guardrail #5 covers fidelity of *quotation*; nothing yet covers
fidelity of *characterisation*.

## 0.5.3 — 2026-07-21

### Health now audits provenance outside `wiki/sources/`

`provenanceGaps` was gated on `isSourcePage()`, so roughly 90% of a vault — every
concept, entity and synthesis — was never checked for provenance at all. A concept
resting on nothing could score a clean 100.

New `unreachableProvenance` metric: a `wiki/` page that cannot be **walked back to
`raw/`** by any route, following frontmatter `sources:` and body wikilinks alike.
Scored 3 each (capped 20), below a source-page gap because it measures reachability
rather than direct citation.

It deliberately does **not** require a `sources:` field. Obsidian indexes frontmatter
and body wikilinks as the same edge — `backlinks` and `links` return both
identically — so demanding a particular channel would enforce house style, not
provenance. What it measures is the property that makes information findable: is
there a trail back to evidence.

Rules that keep it honest:

- **Sideways is not provenance.** A chain of concepts citing each other never reaches
  evidence, however long.
- **Source pages keep the stricter rule.** A summary must cite its own clipping, not
  borrow reachability from a neighbour it links.
- **`moc/` is exempt** — Maps of Content are navigational hubs by the vault contract.
- **`sources: []` is a declaration, not a defect.** The existing disclosure mechanism
  now applies to every page type, reported and not scored.

The evidence walk moved from `lint.mjs` into `lib/graph.mjs` so lint and health share
one definition of "can this be walked back to raw/" rather than drifting into two.

## 0.5.2 — 2026-07-21

### Quote verification was under-reading the evidence trail

Two faults in `/wiki-lint` were manufacturing unverifiable-quote reports.

**The walk was depth-first.** Provenance was followed depth-first with one shared `seen`
set and a depth cap, so a source page reached late down a long chain was marked seen at
the limit — and the page's *direct* citation of that same source, one hop from its own
clipping, then bailed on `seen` and was never expanded. Which evidence counted depended
on the order of a page's links. It is breadth-first now, reaching every page by its
shortest route. Traversal is exported as `evidencePaths` so it is testable without IO.

**Findings carried a truncated quote.** `checkQuotes` clipped each finding to 80
characters, so any tool re-checking a finding verified only the prefix — a long quote
whose opening matches a source and whose tail diverges read as miscited rather than
unsupported. Findings now carry the full quote; truncation moved to the printer.

Together these cut the reference vault's flagged quotes 485 → 454 with no page content
changed, and cut quotes that are verbatim-present-but-unreachable from 104 to 27. The
difference was never drift: those are real quotes whose clipping is interrupted
mid-sentence by extraction furniture (running heads, figure captions).

### Vault repair: `repair-quote-provenance`

`node scripts/repair-quote-provenance.mjs` (dry-run; `--apply`) records the source a
page already rests on, where it quotes a clipping verbatim but cannot reach it. It never
alters a quote, and refuses to attribute on anything short of a 40-character verbatim
run — `quoteFragments` splits on bracketed insertions, so `"what comes after [[Some
Page]]"` reduces to "what comes after", which matches unrelated prose and would write a
fabricated citation. Reachability is tested against the *clipping*, not the link, since
a cover page reachable only at the depth limit leaves its clipping one hop too far.

Quotes that match nothing, or carry no distinctive run, are reported and left for a
human. Nothing gets a citation invented for it.

## 0.5.1 — 2026-07-21

### Re-clip identity is content, not location

A clipper's duplicate check matched on the **binary's path**. Move the binaries — as the
0.5.0 vault rule requires — and every lookup misses, so a re-clip pass writes a second
copy of content the vault already holds, beside the original as `<slug>-<hash7>.md`.
Slug disambiguation was working correctly; it was being asked the wrong question.

`clip-pdf`, `clip-docx` and `clip-xlsx` now check the extracted body's **content hash**
before writing and report `exists (same content): <path>` instead of creating a second
file; `clip-and-repoint` reads that as a reuse, not a failure. Disambiguation is
unchanged, so a genuinely different document sharing a title still gets its own file.

### Vault repair: `dedupe-clippings`

`node scripts/dedupe-clippings.mjs` (dry-run; `--apply` to delete) removes clippings that
duplicate another's content-hash, keeping the copy the vault cites. It **refuses** any
group where every copy is cited or none is — the first case is a deliberate duplicate
(one paper bookmarked twice, documented in the summary's dedup note), the second has no
keeper it can prove correct. Idempotent and convergent.

Vaults synced from another machine should run it once and commit. A vault that ran the
0.5.0 clip-and-repoint pass will also have duplicate `wiki/sources/` pages recording the
same `source-hashes`; those need a judgment call and are reported by `/wiki-lint`, not
auto-merged — the newer page can hold specifics the older one lacks.

## 0.5.0 — 2026-07-21

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

### Triage dispositions now do the work they name

A `reclip` disposition used to close the issue without performing the re-clip, so
requests piled up unnoticed (30 sources on the reference vault, one dispositioned
three times because it kept resurfacing). `apply-reclips.mjs` closes the loop:

```
node scripts/apply-reclips.mjs            # dry run
node scripts/apply-reclips.mjs --apply
```

It folds the log for what was asked (latest disposition wins, so changing your mind
is honoured), **derives** from the vault what is still needed — a source whose
clipping now reads clean needs nothing — re-extracts through the right clipper with
OCR escalation, and carries the content hash forward to every citing summary so the
re-clipped source is not orphaned. A re-extraction that is still degraded is
reported and discarded rather than swapped in.

Related: triage no longer *logs* fidelity issues. A degraded clipping leaves its own
artifact (`fidelity:` frontmatter), so it is derived and self-corrects; only problems
that leave no trace (a 403, a blocked domain) belong in the append-only log.
Dispositions now suppress derived flags too — previously "acceptable" never stuck.

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
