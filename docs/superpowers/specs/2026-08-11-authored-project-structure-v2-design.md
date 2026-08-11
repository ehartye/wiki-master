# `wiki/authored/` — real structure and a backlog that doesn't grow forever — Design Spec v2

**Date:** 2026-08-11
**Status:** Proposed
**Supersedes in part:** `docs/superpowers/specs/2026-08-11-authored-project-docs-design.md` (v1)
**Author:** Design conversation with @Eric-Hartye_HON

---

## 0. Why a v2, immediately after v1 shipped

v1 (merged as 0.14.0, same day) added `project:`/`kind:` frontmatter, a generated per-project MOC,
and a monolith-*detection* signal. Pushed on directly by the user afterward, and correctly:

> "if I started off the task by saying i need a pattern to fix the sprawl of files and agents
> trying to manage a backlog out of one huge monolithic file, how does what you did fix that?"

Answered honestly: it doesn't, not fully. v1 is four layers of **metadata and a compensating
index on top of unchanged files**. `ls wiki/authored/` looks identical to before — every file is
still a flat sibling. And the monolith-detection signal was scoped, in v1's own spec, to detect
only: *"this needs judgment a lint rule can't supply."* True, but it left the actual complaint —
one 9,500+ word file that agents keep appending "Update (date): ..." paragraphs to — completely
unfixed. `sparta-migrator-roadmap.md` is 1,261 lines / ~9,500 words as this spec is written,
having grown *further* in the hours since v1 shipped.

The user's own follow-up framed the real requirement precisely, and it is the brief this spec
answers:

> "I want to be able to say 'go update the product documentation' / 'go add an item to the
> backlog' / 'write a user guide' / 'get me a diagram' from the wiki and you know what I mean and
> do it the same way each time and not have to read war and peace to update the backlog."

Two concrete, separable requirements follow directly from that:
1. **A canonical, predictable file-placement rule** — a verb ("write a user guide") must resolve
   to the same location every time, for every project, without an agent re-deriving convention
   per-project from whatever the last agent happened to name things.
2. **A backlog structure where "add an item" and "update an item's status" are each a small,
   bounded operation** — never a read of the whole document, never an append to a shared file.

## 1. Decision: physical folders, not just frontmatter — reversing v1 §4

v1 §4 explicitly rejected folder nesting, reasoning that metadata was cheaper and this repo had
just solved an identically-shaped problem (triage topic-grouping) with a frontmatter filter, not
a physical reorganization. That reasoning was sound *for a filter UI inside one screen* — it does
not transfer to a *file-system-level* sprawl complaint. Confirmed directly, again, before
committing to reversing course: `ls wiki/authored/` shows every file as a top-level sibling
regardless of any frontmatter it carries; a file browser, a git diff grouped by path, and an
agent's own environment `glob`/`ls` tools all see the flat pile, not the metadata. Frontmatter
fixed *Obsidian-graph* discoverability (Layer 3's MOC); it did nothing for filesystem-level
sprawl, which is what "every single file lives as a sibling" is actually describing.

**Decision: move every `wiki/authored/` page with a `project:` value into
`wiki/authored/<project>/[<subproject>/]<file>.md`, matching that value exactly.** Verified
empirically (not assumed) before deciding this was safe: `buildGraph`, `checkStyle`,
`checkQuotes`, `renderCatalog`, and `regenerateAuthoredMocs` all already tolerate arbitrary
nesting depth under `wiki/authored/` with **zero code changes** — every one of them filters on
`path.startsWith('wiki/authored/')`, never an exact match, and every wikilink they emit is
`basename`-only, path-agnostic. This is a filesystem move, not a re-engineering effort.

A page with no `project:` (e.g. `sf-cli-local-auth-mechanics.md`, cross-cutting research
belonging to no single project) stays at `wiki/authored/`'s root, unmoved — exactly as it already
declared by carrying no `project:` value in the first place.

## 2. Decision: a canonical per-kind file-placement rule — the actual answer to "you know what I mean"

This is the mechanism that makes "write a user guide"/"get me a diagram"/"update the product
documentation" resolve identically every time, for every current and future project, without
re-deriving convention from whatever a prior agent happened to name things (a real, live example
of the drift this prevents: a concurrent session created
`sparta-migrator Salesforce OAuth Implementation.md` this session — space-separated, no
recognizable kind-suffix — which this repo's own v1 classifier could not confidently place).

**Kinds that are singular per project** (exactly one instance makes sense) get a fixed filename at
the project folder's root:

| Verb an agent hears | Canonical location |
|---|---|
| "update the product documentation" / "the overview" | `<project>/overview.md` |
| "document the architecture" | `<project>/architecture.md` |
| "add/update the roadmap" | `<project>/roadmap.md` (see §3 — this becomes **mostly generated**) |

**Kinds that are per-audience, at most 3, each independently addressable** get a fixed
subfolder + fixed leaf name:

| Verb | Canonical location |
|---|---|
| "write a user guide" | `<project>/guides/user.md` |
| "write a developer guide" | `<project>/guides/developer.md` |
| "write an administrator guide" | `<project>/guides/administrator.md` |

**Kinds that are naturally plural/unbounded per project** (a project can legitimately need many
of these, on different topics — confirmed against the real vault: `processing-agent` alone
already has 9 different `reference`-kind docs) get a fixed subfolder, with a descriptive slug
filename inside it (never a canonical single leaf name, since more than one must coexist):

| Verb | Canonical location |
|---|---|
| "get me a diagram [for X]" | `<project>/diagrams/<x-slug>.md` |
| "write up a reference doc on X" | `<project>/reference/<x-slug>.md` |
| "record a decision about X" (ADR) | `<project>/decisions/<x-slug>-adr.md` |
| "make a note about X" | `<project>/notes/<x-slug>.md` |

**Backlog items** get their own dedicated subfolder, one file per item — see §3.

This rule is mechanical and total: given (project, kind, [audience-or-topic]), there is exactly
one place a page belonging there can live, for every project, present or future. `kind:`
frontmatter (v1) still records the same fact for anything that reads metadata (health checks, the
MOC generator); the folder now makes it true on the filesystem too, so the two can never drift
apart the way "a file's stated kind" and "a file's actual name" already drifted once in this same
session (the OAuth-implementation file above).

**Existing filenames are not renamed as part of this move.** Every current filename already
carries enough of the project prefix to be globally unique (`sparta-migrator-roadmap.md`, not
`roadmap.md`) — moving it into `sparta-suite/migrator/` alongside a rename to the bare canonical
name would create the exact cross-project basename-collision class this vault has already been
bitten by twice (`graph.mjs`'s own 0.8.2 changelog entry: *"buildNameIndex decided bare-name
collisions by filesystem walk order"*). Renaming is deferred, never required, and — if ever
done — must go through the `[[path|Display]]` piped-link convention this vault already uses
elsewhere for exactly this reason, not bare wikilinks. The **rule above governs new files going
forward**; existing files are migrated in place (folder changes, filename does not), which is
strictly safer and still delivers the discoverability fix, since the folder path itself is now
predictable even where the leaf filename still carries historical redundancy.

## 3. Decision: the backlog is a folder of small items, not a document

This is the fix for the second half of the brief — "not have to read war and peace to update the
backlog" — and it is where v1's Layer 4 (detect, never split) needed a completion, not a
replacement.

**Root cause of the monolith, confirmed by reading the real file in full**: every status change
to a tracked item was recorded as a **new appended paragraph** ("**Update (2026-08-11):** ...")
rather than an edit to that item's own existing record. Read start-to-finish, the file layers:
a numbered "Now" list (8 items, all individually marked done), a "Blocked on platform" item, and
an "Explicitly future" section holding 15 items — several of which carry 100–150+ lines of
retained interview transcript, verbatim user quotes, PR numbers, and multi-phase shipping history,
because nothing about the format ever prompted removing superseded narrative once an item shipped.
This is not a one-off — a second file, `sparta-usage-tracker-roadmap.md` (created concurrently,
already 1,684 words), is visibly trending the identical way.

**Decision**: a backlog item is its own file, `<project>/backlog/<item-slug>.md`:

```
---
type: authored
created: <date>
updated: <date>
reviewed: <date>
sources: []
ai-generated: true
project: <same as parent>
kind: backlog-item
backlog-status: planned | in-progress | shipped | blocked | dropped
---
# <Title>

<Current, complete description of this ONE item. Historical detail worth keeping —
verbatim user quotes, PR numbers, what was tried and rejected — stays; the discipline
this format buys is per-ITEM isolation, not less content. What it removes is the
"append a new dated paragraph on top of the old one every time status changes" habit:
edit this file's own text and its backlog-status: field in place. git log/git blame
is the changelog now, not a stack of "Update (date):" callouts inside the body.>
```

"Add an item to the backlog" = **create exactly one new small file**, `backlog-status: planned`.
Mechanically identical every time, for every project, and bounded — the operation touches nothing
else. "Update an item's status" = **edit exactly that one file** — its `backlog-status:` field and,
if the description changed, its own body text. Never touches any other item's file. "Ship an
item" = flip `backlog-status: shipped` in place (searchable/discoverable, not deleted) — no file
move required, though archiving old-shipped items into a `backlog/shipped/` subfolder later is a
reasonable housekeeping option this format doesn't foreclose.

**`<project>/roadmap.md` becomes mostly generated** — the exact fenced-region contract `index.md`
and the v1 MOC already use, applied to a third case: hand-written framing prose (a `## Summary`,
optionally a short "this quarter's focus" note) stays outside the fence; the itemized,
always-current list — grouped by `backlog-status`, sourced fresh from `backlog/*.md` on every
run — lives inside it. This is the concrete mechanism that keeps the human/agent-facing roadmap
view honest without it ever again becoming the place status changes accumulate: the view is
regenerated, not maintained by hand.

## 4. Migrating the one real monolith — mechanical, not manual, and why

`sparta-migrator-roadmap.md` is the concrete proof this pattern needs to survive contact with.
Read in full before deciding how to migrate it (27 top-level items, several individually 100+
lines, spanning "Now" (numbered, 8 items, all individually marked "✅ done"), "In progress" (1),
"Known issues" (2), "Blocked on platform" (1), and "Explicitly future, not this initiative" (15,
ranging from a two-line idea to a 230-line item with full interview transcript and 3-phase
shipping history).

**Decision: a scripted, tested extractor — `scripts/lib/roadmap-split.mjs` — not hand
transcription.** Hand-copying 27 items across ~1,260 lines risks exactly the failure mode this
whole spec exists to prevent: a dropped PR number, an altered verbatim quote, content that reads
as faithful but silently isn't. A parser that locates each top-level list item (numbered or
bulleted) within known backlog-shaped section headings, and cuts its **exact existing text**
into its own file, cannot introduce that class of error — it moves bytes, it does not rewrite
them. This also turns a one-time chore into a **standing capability**: the next monolith found in
this vault (`sparta-usage-tracker-roadmap.md` is already trending toward one) gets the same
mechanical treatment, not another bespoke manual edit.

Status is inferred per item from its own already-present inline marker (this file already
self-annotates every item: ✅ = shipped, 🚧 = in-progress, 📐 = a completed design spec not yet
implemented — mapped to `planned`, since "planned" is what the vocabulary calls "not yet built,"
and the body text itself keeps the "design spec complete" framing so nothing is lost by the
mapping, ⚠️ FUTURE/NOT YET BUILT = `planned`), falling back to the enclosing section's own
implied status only when an item carries no inline marker of its own (`Blocked on platform` →
`blocked`). A title is derived from each item's own bolded lead-in text.

## 5. What this does not do

- **No change to `project:`/`kind:` semantics from v1** — this spec adds physical structure and a
  backlog format on top of what v1 already ships; it does not revise the frontmatter contract.
- **No renaming of existing files** — §2's canonical-name rule governs new files; existing ones
  move folders only, per §2's own collision-avoidance reasoning.
- **No taxonomy for backlog-item topics beyond a slug filename** — a backlog item is identified by
  its own title and status, nothing more structured than that.
- **No automatic archiving of shipped backlog items** — `backlog-status: shipped` is sufficient;
  physically relocating shipped items to a `backlog/shipped/` subfolder is a reasonable later
  housekeeping pass this design doesn't require or foreclose.
- **No attempt to eliminate ALL narrative/history from a backlog item's body** — the fix is
  per-item isolation and edit-in-place discipline, not compression. An item that genuinely needs
  200 words to record what was tried, rejected, and why still gets 200 words — just in its own
  file, never accreting a second file's worth on top via appended updates.
