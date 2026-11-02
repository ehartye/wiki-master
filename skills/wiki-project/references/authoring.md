# Author original wiki documentation

Read directly for this operation: [access](../../wiki-maintainer/references/access.md), [evidence](../../wiki-maintainer/references/evidence.md), [operations](../../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

For: $ARGUMENTS

Steps:
1. Identify the project and document kind using the canonical placement table below. Locate the existing page first; preserve its established filename.
   For a new project, create its `overview.md` before its other documents.
2. Read the existing page and relevant project behavior. Before writing that the
   vault holds no source or page on a topic, run two bounded `search.mjs` queries
   (the topic, and the key terms of the claim) and report "not found by these queries",
   naming them; when a query returns a source page, cite it. Open before writing:
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op relink`.
   Save the token using the PowerShell or POSIX example in the operations reference. Create new files only after opening, never before: a page written first counts as already dirty, and `op-commit` refuses it until you pass `--include`.
3. Use `_templates/authored-note.md`, `_templates/authored-decision.md`, or
   `_templates/authored-backlog-item.md` as appropriate. Set `type: authored`,
   `sources: []`, honest `ai-generated`, and matching `project:`/`kind:` metadata.
   Write ordinary Markdown through exact-path filesystem edits, even when the
   Obsidian app is healthy; never send a whole note body through CLI `content=`.
   A stopped app does not prevent authoring. After an uncertain
   CLI write, inspect the target before retrying.
4. Revise living content in place; never stack dated update paragraphs. Keep
   architecture as-built, roadmaps current, ADR consequences balanced and
   reconstructed decisions labeled. Set `updated`; preserve `reviewed` unless
   factual content or project behavior was actually verified.
5. Validate frontmatter, placement and links of exactly the pages this task wrote.
   Use full-path links when crossing project boundaries:
   `[[wiki/authored/<project>/roadmap.md|<project> roadmap]]`. Record each page you
   created or edited with `node "<absolute-plugin-root>/scripts/op-ledger.mjs" add --since <saved-token> <path>...`,
   then write the ledger, a JSON array file of those vault-relative paths (kept under
   `.wiki-master/` or outside the vault), with
   `op-ledger.mjs show --since <saved-token> --out <ledger>`, and run
   `node "<absolute-plugin-root>/scripts/validate-authored.mjs" --paths-file <ledger>`
   with the vault set as in the access reference. Exit 1 means defects: fix, rerun,
   then continue. The ledger format, exit codes, rules and limits are in the
   [scoped validation](../../wiki-setup/references/validation.md).
6. Refresh affected owned catalogs using [catalog updates](catalogs.md), record
   generated paths and rerun [scoped validation](../../wiki-setup/references/validation.md)
   when the ledger grows. Preserve foreign catalog edits.
7. Complete the shared operations contract: one relink log entry (with `--since <saved-token>`),
   then `op-ledger.mjs show --since <saved-token> --out <ledger>` once more and read what it
   lists as unclaimed, then
   `node "<absolute-plugin-root>/scripts/op-commit.mjs" --op relink --title "<summary>" --since <saved-token> --paths-file <ledger>`.
   A close with no `--paths-file` is refused while another operation is open. Verify the commit and index-refresh notices, push with `wiki-sync.mjs`
   (or close and push in one command with `wiki-sync.mjs --op <saved-token> --paths-file <ledger> --title "<summary>"`), and
   verify that the update reached the configured upstream. The authoring request
   includes this completion step unless the user explicitly holds publication;
   do not ask another routine permission question or leave the push to the user.
   If the sync is refused because uncommitted edits overlap incoming changes (exit 3), read [refused sync](../../wiki-setup/references/operation-recovery.md#refused-sync): never reset, check out, stash or delete a file you did not write.

**Done only when** the requested documentation and affected catalogs are
validated, its log and operation commit are recorded, and remote publication is
verified. Report explicit holds, local-only results and failed sync precisely;
do not call a local commit published.

## Canonical placement for original project documentation

- **`wiki/authored/`** is where original, primary content lives — advisory
  documentation, policy, house style, or any other work you're writing directly
  into the vault rather than deriving from a captured source. It is not a
  special case of the pipeline: it declares `sources: []` (the vault's existing
  disclosure for "rests on no external artifact," extended here as the default
  for the whole category) and is otherwise a wiki page like any other — living,
  revisable, never needing a `raw/` counterpart.

  **When this page belongs to a multi-doc project**, it lives at
  `wiki/authored/<project>/[<subproject>/]<file>.md` — a real folder, not just a
  frontmatter tag, so related documents stay together. Every doc-kind has one canonical location, so the same request always
  resolves the same way, for every project, without re-deriving convention from
  whatever a prior session happened to name things:

  | You hear | It lives at |
  |---|---|
  | "update the product documentation" / "the overview" | `<project>/overview.md` |
  | "document the architecture" | `<project>/architecture.md` |
  | "add/update the roadmap" | `<project>/roadmap.md` — **mostly generated**, see [catalogs](catalogs.md) |
  | "write a user guide" | `<project>/guides/user.md` |
  | "write a developer guide" | `<project>/guides/developer.md` |
  | "write an administrator guide" | `<project>/guides/administrator.md` |
  | "get me a diagram [for X]" | `<project>/diagrams/<x-slug>.md` |
  | "write up a reference doc on X" | `<project>/reference/<x-slug>.md` |
  | "record a decision about X" (ADR) | `<project>/decisions/<x-slug>-adr.md` |
  | "make a note about X" | `<project>/notes/<x-slug>.md` |
  | "add an item to the backlog" | `<project>/backlog/<item-slug>.md` — see [backlog](backlog.md) |

  Set `project:` (a slug, one `/` deep at most for a sub-project, e.g.
  `acme-suite/migrator`) and `kind:` — one of `overview | architecture |
  reference | guide | diagram | decision | roadmap | note | backlog-item` —
  matching the folder you placed it in; both are optional and can be omitted
  for a genuinely standalone, project-less note. Use `_templates/authored-note.md`
  to start a page (`_templates/authored-decision.md` for an ADR,
  `_templates/authored-backlog-item.md` for a backlog item — see [backlog](backlog.md)).
  A project's `overview.md` may carry `repo:` (a git remote URL, `owner/name`, or a
  repository folder name; a list is allowed). `node "<absolute-plugin-root>/scripts/session-brief.mjs"`, run in
  a repository, uses it to find the project that repository belongs to and print its
  state page; the repository itself needs no change, and holds no project name.
  `kind: decision` additionally carries `decision-status: proposed | accepted |
  superseded | deprecated` (Nygard's ADR vocabulary) — keep it in sync with
  whatever the page's own `## Status` section says in prose. **Existing files
  are not renamed to fit this table** — only new ones follow it going forward;
  a bare canonical leaf name (`overview.md`) repeated across every project would
  be a guaranteed cross-project wikilink collision (see the identity rules below), so existing filenames stay as they are, just moved into
  their project's folder.

  Because `overview.md` / `architecture.md` / `roadmap.md` are deliberately
  reused bare names across projects (each project gets its own), a bare
  `[[roadmap]]` link is ambiguous the moment a **second** project acquires one —
  it resolves to whichever one Obsidian's name index happens to pick, silently,
  with no error. **Any reference to one of these files from *outside* its own
  project must use the piped form naming the full path** —
  `[[wiki/authored/<project>/roadmap.md|<project> roadmap]]` — the same
  convention this vault already uses for other ambiguous bare titles (e.g.
  citing two source pages with the same title). A link from *within* the same
  project's own pages can stay bare.

  Use the shared [identity rules](../../wiki-maintainer/references/efficacy.md#concept-identity)
  for filename/title/alias precedence. [Backlog lifecycle](backlog.md) owns item
  states, dependency declarations and roadmap settings.

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
