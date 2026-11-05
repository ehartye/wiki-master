# Validate exactly the task paths

Before the log entry, check exactly the pages the task wrote:
`node "<absolute-plugin-root>/scripts/validate-authored.mjs" --paths-file <ledger>`,
with the vault set through [access](../../wiki-maintainer/references/access.md).
This procedure is read-only. A validation-only request makes no edits, logs or catalog
refreshes. For supplied paths, place the ledger outside the vault.

**The ledger** is a non-empty JSON array of vault-relative paths with `/` separators
(no drive prefix, backslash, empty segment, `.` or `..`), for example
`["wiki/authored/demo/guides/user.md","wiki/authored/demo/roadmap.md"]`. Write it by hand
with your file tool, listing each page you wrote, and keep it under `.wiki-master/` or
outside the vault. A path with no file at that exact spelling is reported as `missing-file`: a page that
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
  and the two statuses use the [project metadata vocabularies](../../wiki-project/references/authoring.md#canonical-placement-for-original-project-documentation) (the message lists them). The page
  `status` is checked for presence only, so `status: wip` passes: check its value
  yourself against `stub`, `draft` and `maintained`.
- `kind-folder-mismatch`, `project-folder-mismatch`: `kind` agrees with the folder
  or file in the [project placement table](../../wiki-project/references/authoring.md#canonical-placement-for-original-project-documentation), `project` with the project folder (case ignored). The
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
read because of a stray carriage return or an unclosed fence), `missing-evidence`,
`cites-retired-page` (the cited page is marked `citation-status: retired`, so it is not support)
and `unresolved-link`, which is
stricter than health (it keeps such links as unscored forward links): a task must
not leave a dead link. Code spans and fences are not scanned. An absent file is
`missing-file`; raw, log, template, root catalog, non-Markdown and dot-prefixed paths
are skipped and counted.

Report exactly which paths were checked or skipped from the actual result. Generated
authored roadmaps are checked; they are not skipped just because they were generated.
A clean structural result is not a factual review. Repair requires authorization
from the owning project or maintainer workflow, followed by a fresh scoped check.
