# Completion for vault mutations

Use this contract for every ordinary vault write, including standalone clipping,
authoring and applying triage decisions. Read-only search, query, health, freshness
and preview work do not open operations, log, commit or refresh indexes.

1. **Resolve scope and authorization.** Read the vault's instructions. Existing
   session authorization counts: do not ask again to do already requested work or
   sync when the user or vault instructions already authorize it. A request to
   answer/search does not authorize filing a new page. Purge requires its specific
   reviewed plan and publication approval; do not replace those with this rule.
2. **Open before the first write.** Run `op-begin.mjs --op <op>` and save its token.
   It snapshots already-dirty paths; `op-commit` excludes them. It does not isolate
   simultaneous edits to the same file. Coordinate overlapping targets; preserve
   pre-existing changes and report exclusions instead of sweeping them into a commit.
   An existing enclosing operation may own delegated clips and triage bookkeeping;
   record who closes it rather than opening a second operation unnecessarily.
3. **Edit and validate.** Check the requested behavior/content, valid frontmatter,
   canonical placement and exact citation/link targets. Preserve raw bodies and
   unrelated changes. `reviewed` advances only for factual verification. On uncertain
   write timeouts inspect the target before retrying; do not make a duplicate page.
4. **Refresh affected catalogs.** Use `index-gen.mjs` for catalog changes;
   `moc-authored-gen.mjs --apply` for project authored hubs and
   `backlog-gen.mjs --apply` for changed backlog items. These generators may inspect
   multiple projects: inspect the diff and avoid unrelated edits. Never hand-edit
   generated fences. Check links and requested retrieval after substantive changes.
5. **Log once.** Pipe a concise narrative into `log-entry.mjs --op <op> --title
   "<title>"`. It writes one uniquely named `log/YYYY-MM-DD-HHmmss-<op>-<slug>.md`,
   with date/op/title frontmatter and a grep-friendly heading. Use the existing
   operation vocabulary (ingest, discover, query, lint, relink); authoring uses
   relink. Never append to a shared aggregate log; browse through `log.base`.
6. **Commit and inspect.** Run `op-commit.mjs --op <op> --title "<title>" --since
   <token>`. Verify its result and the actual changed paths. Never `git add -A`.
   The helper attempts a semantic index refresh after committing; inspect notices
   for missing backends, skipped work or partial builds. A commit does not establish
   index freshness. Report a non-git vault as local-only; do not claim a commit.
7. **Sync when already authorized.** `op-commit` itself never pushes. If session or
   vault instructions authorize sync, run `git -C <vault> push` and verify the result
   and upstream state. Otherwise report the unpushed commit and ask only if publishing
   is needed. A rejected push is a real stop for sync: do not force or claim success.

**Done only when** the requested change is validated, applicable catalogs and one
operation log are recorded, the operation commit is verified (or its precise
limitation reported), and authorized sync is verified. If blocked partway, retain
the token and identify pending writes/validation; do not start over blindly.

## Exceptions with their own transaction

- `purge.mjs --apply`, `--restore` and `--reconcile` own their manifests, logs and
  commits. Do not wrap their transaction in a competing commit. Collateral Markdown
  repairs use an ordinary operation after the purge commit. Keep every seed/plan,
  blocking-source and publication safeguard in the purge skill.
- Fresh `wiki-init` can open an operation before scaffolding: the helper can create
  its state directory before the other folders exist. Without Git, explicitly report
  local-only initialization; do not manufacture a repository or publish it.
- Starting triage UI only creates machine-local session state; it is not a content
  edit and does not need a commit. Applying dispositions that change tracked vault
  content or pipeline state uses an enclosing or new ordinary operation.

## Executable lifecycle templates

Replace absolute path placeholders, title and narrative with the real task. The
comment marks where the already-authorized edits and checks occur; do not run the
close step after a failed edit/check. These templates do not auto-push: step 7 is
conditional on the actual authorization and upstream configuration.

```powershell
$wikiPriorVault = $env:WIKI_MASTER_VAULT
try {
  $env:WIKI_MASTER_VAULT = 'C:/absolute/path/to/vault'
  $wikiOpToken = node 'C:/absolute/installed/plugin/scripts/op-begin.mjs' --op relink
  if ($LASTEXITCODE -ne 0) { throw 'Could not open wiki operation' }
  # Perform authorized edits, validate, and refresh affected catalogs here.
  'Validated task narrative' | node 'C:/absolute/installed/plugin/scripts/log-entry.mjs' --op relink --title 'Task title'
  if ($LASTEXITCODE -ne 0) { throw 'Could not log wiki operation' }
  node 'C:/absolute/installed/plugin/scripts/op-commit.mjs' --op relink --title 'Task title' --since $wikiOpToken
  if ($LASTEXITCODE -ne 0) { throw 'Could not commit wiki operation' }
} finally {
  $env:WIKI_MASTER_VAULT = $wikiPriorVault
}
```

```sh
(
  export WIKI_MASTER_VAULT='/absolute/path/to/vault'
  wiki_op_token=$(node '/absolute/installed/plugin/scripts/op-begin.mjs' --op relink) || exit
  # Perform authorized edits, validate, and refresh affected catalogs here.
  printf '%s\n' 'Validated task narrative' | node '/absolute/installed/plugin/scripts/log-entry.mjs' --op relink --title 'Task title' || exit
  node '/absolute/installed/plugin/scripts/op-commit.mjs' --op relink --title 'Task title' --since "$wiki_op_token" || exit
)
```
