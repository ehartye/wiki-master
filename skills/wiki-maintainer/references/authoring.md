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
  `acme-suite/migrator`) and `kind:` — one of `overview | architecture |
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

  Two rules decide a bare name before it counts as ambiguous. A file whose own name equals the link outranks files that only share that name as a `title:` or alias (a site that serves a case's syllabus and opinion under one title gives two clippings one title; the clipping named for the link is the one Obsidian opens). And in navigation a project's generated hub MOC (`moc/<project>.md`) yields to a page of the same name, so a bare `[[<project>]]` reaches the entity page; the MOC is still reached by `[[moc/<project>]]`. Two files with the same name stay ambiguous. After a refresh scoped to one project, the result's `staleCatalogs` names other projects' generated catalogs whose bare link your new pages made ambiguous; refresh each named project.

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
  roadmap this vault actually had (`acme-migrator-roadmap.md`, 1,261 lines
  before this pattern existed) is the concrete proof this format is meant to
  prevent recurring.

  **A backlog item can say what it waits on.** List its prerequisites under `depends-on` as quoted wikilinks to other backlog items of the same project, for example `depends-on: ["[[other-item]]"]` (one scalar or a block sequence also works). A prerequisite is met once its item is shipped or dropped. The relation never changes the item's own status: a `blocked` item you set by hand stays under Blocked. The generated roadmap notes "waiting on" after each open item that has an unmet prerequisite, and lists every planned item whose declared prerequisites are all met under a trailing "Ready to start" section. An item that declares nothing is startable and is not listed there. A prerequisite in another project is rejected; keep the relation inside one project and link across projects in the item's text.

  **List the backlog by lifecycle, not by page status.** Every backlog file has two fields that look alike: the page `status` (`draft` or `maintained`) and the lifecycle `backlog-status`, so a search for `status:` lists no planned items. `node "<absolute-plugin-root>/scripts/backlog-list.mjs" [--project <name>] [--backlog-status planned,in-progress] [--startable] [--json]` is read-only, does not build the whole-vault graph, and prints one tab-separated line per item: project, lifecycle status, path, title, and `waiting on <items>` when a prerequisite is unmet. `--backlog-status` takes the five words above and `unrecognized` (the items a generated roadmap lists under "Unrecognized status"); `--startable` keeps planned items with no unmet prerequisite, whether or not they declare any. Exit 2 is bad input.

  **A mature project can shorten its generated roadmap.** Two settings in the roadmap's own frontmatter, both off until you add them, so nothing changes by default: `backlog-titles: true` shows each item's first heading as its link text, and `backlog-shipped: collapse` replaces the Shipped list with a count and a link to a generated sibling page, `roadmap-shipped.md` (kind `reference`, created on first use, with its own fenced list). Run `backlog-gen.mjs --apply` or `refresh-catalogs.mjs` after changing a setting. A pipe or bracket in a heading is replaced by a space in the link text. Removing the collapse setting lists Shipped on the roadmap again but leaves `roadmap-shipped.md` for you to delete.

  **A friction item says what produced its observation.** When an item states a behavior as tested or observed, paste the exact call arguments (or the script name) and the exact log or error text beside the claim, and mark a fact whose reading of the source disagrees with the run as unsettled until a run decides. Without them the claim cannot be reconciled with the source later without a rerun.

  When `backlog-gen.mjs` (or `refresh-catalogs.mjs`) creates a roadmap that does not exist, the page starts with `type: authored`, `created`, `updated`, `status: draft`, `sources: []`, `ai-generated: true`, `project` and `kind: roadmap`. `reviewed` is omitted on purpose: nobody has reviewed a page a script just wrote. `created` and `updated` are the UTC day of the run and cannot be set from the command line. A dry run creates no page and no temp file. An existing roadmap is never rewritten outside the generated fence.

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

## Validating what a task wrote

Before committing, check exactly the pages the task wrote:
`node "<absolute-plugin-root>/scripts/validate-authored.mjs" --paths-file <ledger>`,
with the vault set as in the access reference.

**The ledger** is the file `op-commit.mjs --paths-file` takes: a non-empty JSON array
of vault-relative paths with `/` separators (no drive prefix, backslash, empty segment,
`.` or `..`), for example `["wiki/authored/demo/guides/user.md","wiki/authored/demo/roadmap.md"]`.
No helper builds it; write it with your file tool from the pages this task created or
edited, under `.wiki-master/` or outside the vault. A path with no file at that exact spelling is reported as `missing-file`: a page that
does not exist, or one whose letter case or Unicode form differs from the file on disk,
because a case-insensitive disk would otherwise drop that page's link checks without a word.

**The result.** The command writes nothing and reads the whole vault (ambiguity is
vault-wide), but reports only ledger pages; `health.mjs` stays the whole-vault check.
Exit 0 is clean, 1 means defects (fix and rerun), 2 means an unusable ledger, unknown
flag or missing vault. The text report is one `path:line rule message` line per defect,
sorted by path then line, then `validate-authored: N pages checked, M defects`, with
`, K skipped` appended only when K is above zero (checked plus skipped is the number of
distinct ledger paths). `--json` prints
`{"version":1,"checked":N,"skipped":K,"defects":[{"path","line","rule","message"}]}`
instead, which is exactly what `validateAuthored()` in `scripts/validate-authored.mjs` returns. An absent frontmatter key is reported at line 1; a blank key at its own line.

**Public pages.** A page written for a plugin's public repository must not name other projects or machines. `--terms-file <path>` (the owner's private list, kept outside every repository; the file `scripts/scan-private-terms.mjs` reads) adds a `private-term` defect for each ledger page whose text matches a term or a built-in machine pattern (a home-directory path, a GPU model, an invisible character), at its line, naming the rule number and never the text. `--terms-projects a,b` limits the check to pages whose `project:` (first segment) is listed, so a private project's own pages may name themselves. Without `--terms-file` the output is unchanged.

Under `wiki/authored/`:

- `missing-key`: `type`, `created`, `updated`, `status`, `ai-generated` and a
  `sources` line (`[]` is valid) must be present and not blank, so an unfilled
  template fails. A page in a project folder also needs `project` and `kind`, a
  decision `decision-status`, a backlog item `backlog-status`. `reviewed` is optional.
  A page missing one of those two statuses is judged by its declared `kind`, not its folder.
- `bad-value`: `type` is `authored`, `ai-generated` is `true` or `false`, and `kind`
  and the two statuses use the vocabularies above (the message lists them). The page
  `status` is checked for presence only, so `status: wip` passes: check its value
  yourself against `stub`, `draft` and `maintained`.
- `kind-folder-mismatch`, `project-folder-mismatch`: `kind` agrees with the folder
  or file in the table above, `project` with the project folder (case ignored). The
  project is the folder path above the first kind folder (`guides`, `diagrams`,
  `reference`, `decisions`, `notes`, `backlog`) below the top folder, so
  `notes/<topic>/x.md` is a note and `project` must equal that folder path exactly.
  With no kind folder, `project` may be the top folder or the top folder plus one
  sub-project. `overview.md`, `architecture.md` and `roadmap.md` expect their own
  kind when they sit in a project folder. A page directly under `wiki/authored/` has
  no project or kind expectation. A wrong-kind page in `backlog/` gets only
  `kind-folder-mismatch`.

- `dependency-dangling`, `dependency-cross-project`, `dependency-self`, `dependency-cycle`,
  `dependency-malformed`, `dependency-misplaced`: a `depends-on` entry must be a
  wikilink to an existing backlog item of the same project (a note in `backlog/` is
  not an item). The message names the entry; a cycle names the whole loop and is
  reported on each ledger page in it. `dependency-misplaced` is `depends-on` on a page
  that is not a backlog item, where it is ignored. Only the item's own project backlog
  folder is read, so these checks add no second whole-vault scan.

On every wiki content page: `ambiguous-link`, `malformed-link` (a hard-wrapped link
is one), `unresolved-citation`, `malformed-frontmatter` (the page's metadata is not
read because of a stray carriage return or an unclosed fence), `missing-evidence`
and `unresolved-link`, which is
stricter than health (it keeps such links as unscored forward links): a task must
not leave a dead link. Code spans and fences are not scanned. An absent file is
`missing-file`; raw, log, template, root catalog, non-Markdown and dot-prefixed paths
are skipped and counted.
