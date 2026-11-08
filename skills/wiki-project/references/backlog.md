# Project backlog and roadmap lifecycle

Read-only listing writes nothing and needs no refresh. For edits follow [authoring](authoring.md),
[completion](../../wiki-maintainer/references/operations.md) and
[scoped validation](../../wiki-setup/references/validation.md).

  **The backlog is a folder of small items, never one growing document.** A
  tracked item is its own file, `<project>/backlog/<item-slug>.md`
  (`kind: backlog-item`, `backlog-status: planned | in-progress | shipped |
  blocked | dropped`). "Add an item" = create exactly one new small file.
  "Update an item" = edit exactly that one file's `backlog-status:` and body —
  **never append a new dated "Update (date): ..." paragraph on top of the old
  ones; edit the item's own text in place.** The file's history is the
  changelog now, not a stack of callouts inside the body. `<project>/roadmap.md`
  itself becomes a thin, mostly-generated index over `backlog/*.md`
  (`refresh-index.mjs`, the task's last step, regenerates it) —
  the same fenced-region contract `index.md` already uses: hand-written framing
  prose stays outside the fence, the itemized, always-current list lives inside
  it. Revise each item's current state in place so the roadmap stays a useful
  index rather than accumulating dated updates.

  **A backlog item can say what it waits on.** List its prerequisites under `depends-on` as quoted wikilinks to other backlog items of the same project, for example `depends-on: ["[[other-item]]"]` (one scalar or a block sequence also works). A prerequisite is met once its item is shipped or dropped. The relation never changes the item's own status: a `blocked` item you set by hand stays under Blocked. The generated roadmap notes "waiting on" after each open item that has an unmet prerequisite, and lists every planned item whose declared prerequisites are all met under a trailing "Ready to start" section. An item that declares nothing is startable and is not listed there. A prerequisite in another project is rejected; keep the relation inside one project and link across projects in the item's text.

  **A backlog item can say which spec covers it.** Name the spec under `specced-in` as quoted wikilinks to backlog items of the same project, for example `specced-in: ["[[spec-item|WP2]]"]`. The text after `|` is a label, by convention the work package; a `#anchor` is ignored. One scalar or a block sequence also works, and an item may name several specs. A spec is an ordinary backlog item; it counts as a spec because another item names it. The relation means "is part of": it never changes any item's status, and a spec's own status is yours to set. The generated roadmap appends a "Specced work" section after "Ready to start": each spec with "covers N items, M closed" (closed is shipped or dropped), then its items sorted by path, each with its label. An item that names the same spec twice with different labels is listed once, its labels joined with ", ". A spec whose items and own status are all closed is left out, and an entry that does not resolve adds no line. `backlog-list.mjs --specced-in <name>` lists the items of one spec. The older prose line `Specced in [[spec]] (WP1)` stays valid text, but no tool reads it.

## List by lifecycle

  **List the backlog by lifecycle, not by page status.** Every backlog file has two fields that look alike: the page `status` (`draft` or `maintained`) and the lifecycle `backlog-status`, so a search for `status:` lists no planned items. `node "<absolute-plugin-root>/scripts/backlog-list.mjs" [--project <name>] [--backlog-status planned,in-progress] [--startable] [--specced-in <name>] [--json]` is read-only, does not build the whole-vault graph, and prints one tab-separated line per item: project, lifecycle status, path, title, and `waiting on <items>` when a prerequisite is unmet. `--backlog-status` takes the five words above and `unrecognized` (the items a generated roadmap lists under "Unrecognized status"); `--startable` keeps planned items with no unmet prerequisite, whether or not they declare any. `--specced-in` keeps the items whose `specced-in` resolves to that spec (a bare name matches the file name, a path the full path); each `--json` row lists its specs under `speccedIn`. Exit 2 is bad input.

  **A mature project can shorten its generated roadmap.** Two settings in the roadmap's own frontmatter, both off until you add them, so nothing changes by default: `backlog-titles: true` shows each item's first heading as its link text, and `backlog-shipped: collapse` replaces the Shipped list with a count and a link to a generated sibling page, `roadmap-shipped.md` (kind `reference`, created on first use, with its own fenced list). A changed setting takes effect at the next [refresh](catalogs.md). A pipe or bracket in a heading is replaced by a space in the link text. Removing the collapse setting lists Shipped on the roadmap again but leaves `roadmap-shipped.md` for you to delete.

  **A friction item says what produced its observation.** When an item states a behavior as tested or observed, paste the exact call arguments (or the script name) and the exact log or error text beside the claim, and mark a fact whose reading of the source disagrees with the run as unsettled until a run decides. Without them the claim cannot be reconciled with the source later without a rerun.

  When `refresh-index.mjs` creates a roadmap that does not exist, the page starts with `type: authored`, `created`, `updated`, `status: draft`, `sources: []`, `ai-generated: true`, `project` and `kind: roadmap`. `reviewed` is omitted on purpose: nobody has reviewed a page a script just wrote. `created` and `updated` are the UTC day of the run and cannot be set from the command line. An existing roadmap is never rewritten outside the generated fence.


For generated catalogs use [catalogs](catalogs.md).
