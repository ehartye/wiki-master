# Original project documentation

- **`wiki/authored/`** is where original, primary content lives — advisory
  documentation, policy, house style, or any other work you're writing directly
  into the vault rather than deriving from a captured source. It is not a
  special case of the pipeline: it declares `sources: []` (the vault's existing
  disclosure for "rests on no external artifact," extended here as the default
  for the whole category) and is otherwise a wiki page like any other — living,
  revisable, never needing a `raw/` counterpart.

  **When this page belongs to a multi-doc project**, it lives at
  `wiki/authored/<project>/[<subproject>/]<file>.md` — a real folder, not just a
  frontmatter tag, so the file actually stops being a sibling of 30+ unrelated
  pages. Every doc-kind has one canonical location, so the same request always
  resolves the same way, for every project, without re-deriving convention from
  whatever a prior session happened to name things:

  | You hear | It lives at |
  |---|---|
  | "update the product documentation" / "the overview" | `<project>/overview.md` |
  | "document the architecture" | `<project>/architecture.md` |
  | "add/update the roadmap" | `<project>/roadmap.md` — **mostly generated**, see below |
  | "write a user guide" | `<project>/guides/user.md` |
  | "write a developer guide" | `<project>/guides/developer.md` |
  | "write an administrator guide" | `<project>/guides/administrator.md` |
  | "get me a diagram [for X]" | `<project>/diagrams/<x-slug>.md` |
  | "write up a reference doc on X" | `<project>/reference/<x-slug>.md` |
  | "record a decision about X" (ADR) | `<project>/decisions/<x-slug>-adr.md` |
  | "make a note about X" | `<project>/notes/<x-slug>.md` |
  | "add an item to the backlog" | `<project>/backlog/<item-slug>.md` — see below |

  Set `project:` (a slug, one `/` deep at most for a sub-project, e.g.
  `sparta-suite/migrator`) and `kind:` — one of `overview | architecture |
  reference | guide | diagram | decision | roadmap | note | backlog-item` —
  matching the folder you placed it in; both are optional and can be omitted
  for a genuinely standalone, project-less note. Use `_templates/authored-note.md`
  to start a page (`_templates/authored-decision.md` for an ADR,
  `_templates/authored-backlog-item.md` for a backlog item — see below).
  `kind: decision` additionally carries `decision-status: proposed | accepted |
  superseded | deprecated` (Nygard's ADR vocabulary) — keep it in sync with
  whatever the page's own `## Status` section says in prose. **Existing files
  are not renamed to fit this table** — only new ones follow it going forward;
  a bare canonical leaf name (`overview.md`) repeated across every project would
  be a guaranteed cross-project wikilink collision (this vault has already been
  bitten by exactly that bare-name-collision class twice — see `graph.mjs`'s own
  changelog history), so existing filenames stay as they are, just moved into
  their project's folder.

  Because `overview.md` / `architecture.md` / `roadmap.md` are deliberately
  reused bare names across projects (each project gets its own), a bare
  `[[roadmap]]` link is ambiguous the moment a **second** project acquires one —
  it resolves to whichever one Obsidian's name index happens to pick, silently,
  with no error. **Any reference to one of these files from *outside* its own
  project must use the piped form naming the full path** —
  `[[wiki/authored/<project>/roadmap.md|<project> roadmap]]` — the same
  convention this vault already uses for other ambiguous bare titles (e.g.
  citing `21 CFR Part 11`'s source page). A link from *within* the same
  project's own pages can stay bare.

  **The backlog is a folder of small items, never one growing document.** A
  tracked item is its own file, `<project>/backlog/<item-slug>.md`
  (`kind: backlog-item`, `backlog-status: planned | in-progress | shipped |
  blocked | dropped`). "Add an item" = create exactly one new small file.
  "Update an item" = edit exactly that one file's `backlog-status:` and body —
  **never append a new dated "Update (date): ..." paragraph on top of the old
  ones; edit the item's own text in place.** `git log`/`git blame` is the
  changelog now, not a stack of callouts inside the body. `<project>/roadmap.md`
  itself becomes a thin, mostly-generated index over `backlog/*.md` (run
  `node "<absolute-plugin-root>/scripts/backlog-gen.mjs" --apply` after adding/updating an item) —
  the same fenced-region contract `index.md` already uses: hand-written framing
  prose stays outside the fence, the itemized, always-current list lives inside
  it. This is a direct instruction, not a hope: appending one more update is
  always the lowest-friction move available in the moment for whatever task
  brought you to the file, and nothing else reliably stops it — a monolithic
  roadmap this vault actually had (`sparta-migrator-roadmap.md`, 1,261 lines
  before this pattern existed) is the concrete proof this format is meant to
  prevent recurring.

  `node "<absolute-plugin-root>/scripts/health.mjs"`'s `monolith candidates` line (a `wiki/authored/`
  page over ~3,000 words with several stacked dated-update callouts) is a
  secondary safety net for anything that still grows despite the format above —
  report it, don't silently keep appending.

## Keeping project documentation honest

The table above settles *where* a document goes. These settle whether it is still
worth reading a month later — each one is a failure that actually happens, not a
style preference.

- **`architecture.md` is as-built, not as-planned.** The moment it describes
  something that does not exist, a reader cannot tell which half is true. Anything
  intended rather than shipped belongs in `roadmap.md` or a backlog item.
- **`roadmap.md` records state, not history.** It is the page most likely to be
  silently stale, and the failure is specific: it keeps listing as "next" three
  things that shipped a fortnight ago. **Update it in the same operation as the
  work** — a roadmap updated later is a roadmap updated never.
- **An ADR states context, decision, consequences — good AND bad — and status.**
  *A consequences section that lists only benefits is a sales pitch, not a record.*
  The reason to revisit a decision is always in the half that gets left out, so an
  ADR without costs has thrown away the only part that will matter.
- **Label a retrospective ADR as reconstructed.** Most projects start by writing up
  decisions already taken; that is legitimate and lossy. Reasoning recovered from
  code and commit history is not the reasoning that was used, and saying so is the
  difference between a record and a plausible story.
- **Record the failures.** Stalls, refuted hypotheses, and measurements that
  contradicted a confident diagnosis are the highest-value content in a project
  set, because they are precisely what nobody remembers and everybody repeats. If a
  fix was wrong twice before it was right, all three attempts belong on the page.
- **Distinguish "not built" from "built and broken".** From outside they look
  identical and only one of them is a bug. A reader who cannot tell will either
  re-implement something that exists or file a bug against something that does not.
- **The wiki owns intent; the repo owns behaviour.** When they disagree, the code
  wins on what happens and the wiki wins on what was meant — and the disagreement
  itself is worth writing down, because it is usually where the next defect is.
