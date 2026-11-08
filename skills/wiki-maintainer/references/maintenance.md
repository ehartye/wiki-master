# Maintenance contracts and content repairs

Use [checks](../../wiki-setup/references/checks.md) for read-only health, metrics,
freshness and lint reporting. Apply repairs only within authorized content scope,
with [completion](operations.md), [evidence](evidence.md) and direct
[scoped validation](../../wiki-setup/references/validation.md). The [script index](../../../docs/scripts.md)
lists every repair, backfill and rename script with its purpose.

## "Has this been ingested?" — a content-hash join, not a guess
A raw clipping is **ingested iff its `source-hash` is recorded in some
`wiki/sources/` page's `source-hashes`**. Hash equality is the contract — immune to
the `-<hash7>` filename suffix and the citation-format drift that made
link-resolution manufacture phantom backlog. Only Markdown clippings are ingestable units; binary originals are not summary
targets. Use the direct [backlog check](../../wiki-setup/references/checks.md#health-and-ingest-backlog)
to obtain counts. Never derive eligibility from filename, title, a fuzzy citation
match or filesystem movement.

**Migrating a vault (agents, any machine).** A vault written before this scheme has
source pages without `source-hashes`; a transitional fallback keeps them credited by
link resolution so nothing regresses, but `backfillPending > 0` means the migration
has not run here. Repair it from the plugin root: `node "<absolute-plugin-root>/scripts/backfill-source-hashes.mjs"`
(dry-run) then `--apply`. It is idempotent and guesses nothing — ambiguous/unresolved
citations are logged for review. Run it on one machine: other machines get the repair
once Obsidian Git publishes it.

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
path. A written reminder alone is not the safeguard: `validate-authored.mjs` reports a
wrapped link in the pages it checks as `malformed-link`, and
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

**Repairing ambiguous bare links.** A bare `[[architecture]]` is an `ambiguous-link` defect when two pages
share the name. From the plugin root: `node "<absolute-plugin-root>/scripts/repair-ambiguous-links.mjs"` (dry
run, with the plan and the report) then `--apply`; `--project=<slug>` bounds it. On its own it applies one rule:
the page lives in a project's folder (`wiki/authored/<project>/`) and exactly one candidate does too, so the
link is rewritten to that path with the displayed text kept (`[[wiki/authored/<project>/architecture.md|architecture]]`;
`\|` inside a table row; an existing alias or `#heading` kept; a `sources:` entry takes the full path with no
alias). Links in code, comments and a generated catalog fence stay. Every other class is reported with its
reason, not guessed: a page outside every project folder (`shared-page`), several candidates or none in the
page's project (`needs-reading`), a title shared by two clippings (`title-citation`, repaired by retitling the
clippings, not from the citing page), an occurrence only inside a generated catalog (`catalog-line`, repaired by
`refresh-index.mjs`). A reviewed `--mapping=<file>` of `{ "target", "path", "page"? }` settles the ones that need a
reading, and only with a path that is a candidate. A page an application reads by title, where a path in a
citation would break it, is left alone with `--exclude=<path-prefix>` (repeatable). It sets `updated` to the run
date, leaves `reviewed`, and checks line by line that only wikilinks changed.

**Removing duplicate clippings.** Two clippings with the same `source-hash` hold the same
text, and the uncited copy reads as permanent ingest backlog. From the plugin root:
`node "<absolute-plugin-root>/scripts/dedupe-clippings.mjs"` (dry run) then `--apply`, which
deletes the uncited copies in a group where some copy is cited. A group where every copy is
cited (an intentional duplicate) or none is (no keeper to prove) is reported and left alone.
Deleting a raw file needs the owner's authorization like any other `raw/` change.

**Recording the source of a verbatim quote.** A page that quotes a clipping word for word but
declares no path to it reads as unverifiable. From the plugin root:
`node "<absolute-plugin-root>/scripts/repair-quote-provenance.mjs"` (dry run) then `--apply`
adds the clipping, or the source page that covers it, to the page's `sources:`; the quote is
never changed. Only a quote with a verbatim run of at least 40 characters found in a clipping
is repaired; the counts of unmatched and too-generic quotes it prints are for human review.

**Renaming clippings that Obsidian hides or a wikilink cannot carry.** Obsidian does
not index a dot-prefixed file, and `graph.mjs` skips the same names, so a clipping
filed as `.github-workflows-build.yml.md` is invisible: every citation of it is an
`unresolved-citation`, and an uncited one never reaches the ingest backlog. A backtick
in a filename is the same trap in another form (a backtick pair inside a wikilink reads
as a code span). The clippers now write `dot-github-workflows-build.yml.md` and drop
backticks (`scripts/lib/clip-names.mjs`); a re-clip of `clip-gh` adopts a file written
under its old name instead of copying it or, in digest mode, pruning it. Rename the
existing ones from the plugin root:
`node "<absolute-plugin-root>/scripts/rename-unsafe-clippings.mjs"` (dry-run), then
`--apply --list-out <review.tsv>`; the listing names the old names, the new names and
the pages rewritten, and those pages go in the [validation](../../wiki-setup/references/validation.md)
ledger. It renames only `.md` files under `raw/` (a state file such as
`raw/book-nom/.booknom-state.json` is hidden on purpose), leaves clipping content and
therefore `source-hash` alone, repoints full-path wikilinks in every page except `raw/`,
`log/` and `_templates/` (a link in a code block is an example and stays), reports other
mentions of an old path without rewriting them, and refuses a rename whose target exists.
Pages are rewritten before files are renamed, so an interrupted run is finished by running
it again.

**Renaming clippings whose names double the extension.** Before 0.58.0 a clipping of
`README.md` was filed `README.md.md`, and a title-less raw document `SKILL.md.md`; new clippings
no longer end `.md.md`. Rename the existing ones from the plugin root with
`node "<absolute-plugin-root>/scripts/rename-doubled-extension-clippings.mjs" --list-out <review.tsv>`
(dry run, writes nothing to the vault), review the listing, then `--apply`. A `clip-gh` file
under `raw/clippings/gh/<owner>/<repo>/` loses its second `.md`; a top-level clipping with an empty
title is renamed from its source URL, nearest folder first, as new clips are. The contract is
the one above (bytes and `source-hash` untouched, full-path wikilinks only, `raw/` and `log/`
never rewritten, a rename onto an existing name refused), plus three more. A link to the
extension-stripped path is repointed only when no existing file has exactly that path (a vault
may hold both `Build.md` and `build.md.md`; a link to `Build.md` means the real file). The apply
refuses to start when any file it would change has edits still waiting for Obsidian Git's next run,
because another writer may be editing it, and changes nothing: rerun after that run. `--flag=<prefix>` lists the pages under a prefix
for review and `--exclude=<prefix>` reports them without rewriting (both repeatable): use them for pages
whose citations an app reads by title. A bare-name link such as `[[README.md]]` is not rewritten.

**A `wiki/authored/` page missing `project:` or `kind:`** is reported by `validate-authored.mjs`;
add the keys by hand.

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
  specifies no verification tier — that is what content lint, quote-lint, and the
  clipping-wins guardrail exist to supply.
- **Frictionless collection is not free.** Automated discovery plus automated
  ingest removes the cost that used to limit what got kept. Volume is not
  progress; prefer fewer, better-corroborated sources over a larger pile.

## Verification obligation

Validate actual repairs and inspect changed or high-use claims during substantive
maintenance. Use the direct [bounded checks](../../wiki-setup/references/checks.md#bounded-maintenance-evaluation)
for reporting procedures and coverage. A clean graph does not establish factual
correctness; do not change factual review dates for mechanical repairs.
