# Maintenance metrics, repairs and limits

## Integrity worklist

`health.mjs` now leads with the uncapped open integrity defect count. Use `--json`
for versioned issues with stable IDs, exact locations, evidence and verification
conditions. Intentional forward links, orphan/dead-end opportunities and stubs do
not increase that count. A required citation that fails remains a defect even on
a stub. Original authored pages may declare `sources: []`; substantive derived
pages still require evidence. Unresolved navigation, age and fuzzy suggestions
are never proof of an accidental break. The old capped score is available only
through `--legacy`, for historical/topology reporting rather than repair targets.

Use [wiki-repair](../../wiki-repair/SKILL.md) for authorized integrity repairs.
Compare resolved, remaining and new issue IDs after each batch. `--backlog` keeps
the ingest contract below. The checker is structural and reports its unchecked
areas; zero defects is not factual verification. See `docs/wiki-integrity.md` in
the plugin root for the full contract and coverage limits.

## "Has this been ingested?" — a content-hash join, not a guess
A raw clipping is **ingested iff its `source-hash` is recorded in some
`wiki/sources/` page's `source-hashes`**. Hash equality is the contract — immune to
the `-<hash7>` filename suffix and the citation-format drift that made
link-resolution manufacture phantom backlog. Facts the metric reports:

| metric | means | still owes work? |
|---|---|---|
| `unparsedSources` | nothing in the wiki cites it at all | yes |
| `unsummarizedSources` | no `wiki/sources` page records its hash | **yes — this is the backlog** |
| `missingHash` | a `.md` clipping carrying no `source-hash` | data defect — repair (re-clip) |
| `backfillPending` | source pages that cite raw but recorded no hash | migrate — see the migration guidance in this reference |
| `provenanceGaps` | a `wiki/sources` page citing no `raw/` file | yes — scored as a defect |

Report `unsummarizedSources` when asked what still needs ingesting — obtain it
with `node "<absolute-plugin-root>/scripts/health.mjs" --backlog`, which prints just these ingest lines led
by the not-ingested count (the full `health.mjs` report carries the same lines at
the bottom). Do **not** re-derive the backlog by searching `tag:clippings` and
hand-diffing `wiki/sources/` — that fuzzy link-resolution is the drift this
content-hash join exists to replace. Only `.md`
clippings are ingestable units — a binary original (`.pdf/.xlsx/.zip`) is never a
summary target and is not backlog.

**Migrating a vault (agents, any machine).** A vault written before this scheme has
source pages without `source-hashes`; a transitional fallback keeps them credited by
link resolution so nothing regresses, but `backfillPending > 0` means the migration
has not run here. Repair it from the plugin root: `node "<absolute-plugin-root>/scripts/backfill-source-hashes.mjs"`
(dry-run) then `--apply`. It is idempotent and guesses nothing — ambiguous/unresolved
citations are logged for review. If the vault is git-synced, running it once and
committing repairs every machine.

**Repairing title-shaped citations (`provenanceGaps > 0`).** A separate, older drift:
ingest wrote `sources: ["[[<the source's title>]]"]`, but the clipper had already
slugified that title into the filename (`/`, `:`, `#` → `-`, 120-char cap). Any title
carrying one of those characters or running long cites a file that does not exist —
the page is a `provenanceGap` and its clipping reads as unparsed, though the ingest
was correct. Repair from the plugin root: `node "<absolute-plugin-root>/scripts/repair-provenance-links.mjs"`
(dry-run) then `--apply`. It joins on `source-hash`, never on the title (the title is
what drifted), and reports anything it cannot pin to exactly one clipping instead of
guessing. Always cite a clipping by its **path**, `[[raw/clippings/<file>.md]]`.

**Repairing hard-wrapped wikilinks (`health.mjs` defects marked "hard-wrapped
wikilink").** Hand- or LLM-authored prose that gets word-wrapped at some column width
can break a `[[Target]]` straddling the wrap point into `[[Target\ncontinued]]` —
Obsidian wikilinks cannot span a line break, so this can never resolve and is always a
defect, never a healthy deferred forward-link (`classifyBrokenLinks` never lets a
wrapped target hide there, whether or not a suggestion resolves). **Prevention that
actually holds**: write vault content as unwrapped logical lines — never hard-wrap a
paragraph, and never let one contain a `[[wikilink]]` split across a line break — the
same discipline `clip-docx`'s `--wrap=none` already enforces mechanically on the docx
path. A written reminder alone is not the safeguard: `/wiki-relink`'s own `op-commit`
step reports any wrapped link introduced by the files it just committed, and
`node "<absolute-plugin-root>/scripts/health.mjs"` always scores one as a defect, so either catches a recurrence
even if the writing habit doesn't. Repair existing ones from the plugin root:
`node "<absolute-plugin-root>/scripts/repair-wrapped-links.mjs"` (dry-run) then `--apply`. The fix is a lossless
whitespace-collapse (undoing the wrap, never guessing content); the one shape it cannot
safely resolve alone — a hyphen glued to the word right before the break, e.g.
`[[Diagno-\nstics]]`, indistinguishable by character shape from a title that
legitimately ends a line in a trailing hyphen (`[[Wizards-\n  Definition...]]`, a real
title) — is checked against the real page index (not edit-distance guessing) and only
fixed when exactly one reading resolves; left untouched and reported otherwise. See
`scripts/lib/dewrap-links.mjs`.

**Repairing invalid `sources:`/`source-hashes:` ordering.** A now-fixed bug in
`insertSourceHashes` could insert `source-hashes:` between a block-list `sources:`
key and its own `- [[...]]` item instead of after it — invalid YAML that a real
parser rejects outright, so Obsidian reports "No frontmatter found" on the page
(every property, not just `sources`) even though wiki-master's own regex-based
scripts tolerate it and never flagged it as a defect. Repair from the plugin root:
`node "<absolute-plugin-root>/scripts/repair-sources-order.mjs"` (dry-run) then `--apply`. Pure string
surgery — it recognizes and reorders only that exact shape and is a no-op on
anything else — idempotent and safe to re-run.

**Backfilling `project:`/`kind:` onto pre-existing `wiki/authored/` pages.** A vault
whose authored pages predate this convention has none of it set. Repair from the
plugin root: `node "<absolute-plugin-root>/scripts/backfill-authored-metadata.mjs"` (dry-run) then `--apply`
— deterministic, filename- and content-shape-driven classification (never a guess:
a field it cannot resolve confidently is left unset rather than labeled wrong), and
idempotent, so it is safe to re-run as new authored pages arrive without metadata
of their own yet.

**Never move files to record ingestion state.** `raw/` immutability is the
load-bearing invariant. The hash key lives *in* the markdown — each page's
`source-hashes`, co-located with the summary that owns it — a single source of truth
that merges cleanly across machines. Derive the backlog at read time from that key,
like `index.md`; never copy ingestion state into the filesystem layout, where it can
drift and where two concurrent sessions race on the move.

## Known limits of the pattern
Stated so they are not rediscovered as surprises. The pattern this vault
implements bounds itself in ways worth tracking:
- **Index-only navigation is untested past the scale the source reports.** The
  source pattern says it "works surprisingly well at moderate scale (~100 sources,
  ~hundreds of pages)" — a claim about where it works, **not a ceiling**. It names
  no threshold and no failure mode. Separately, under an *Optional* heading, it
  says "as the wiki grows you want proper search" and suggests `qmd`, attaching no
  number; the two passages are not joined in the source, so do not present ~100 as
  the trigger for adopting search tooling. What is fair to say: a vault far past
  that figure is outside the range the source reports, entry may have shifted from
  reading `index.md` to `obsidian search` without anyone noticing, and **nobody has
  measured whether that costs anything**. Say that, and say it is untested — do not
  upgrade it into a bound the source never stated.
- **Cheap maintenance is not correct maintenance.** The pattern's justification is
  that upkeep cost approaches zero, which addresses effort, not accuracy. It
  specifies no verification tier — that is what `/wiki-lint`, quote-lint, and the
  clipping-wins guardrail exist to supply.
- **Frictionless collection is not free.** Automated discovery plus automated
  ingest removes the cost that used to limit what got kept. Volume is not
  progress; prefer fewer, better-corroborated sources over a larger pile.

## Cost discipline
Cheap structural checks (`/wiki-health`) run every session and prioritize the
expensive semantic passes. A clean graph does not establish factual correctness:
sample changed or high-use pages during requested maintenance even when structural
health is clean. Skip an empty vault; avoid a full lint on an unchanged wiki.
