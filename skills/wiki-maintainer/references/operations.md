# Completion for vault mutations

Use this contract for every ordinary vault write, including standalone clipping,
authoring and applying triage decisions. Read-only search, query, health, freshness
and preview work do not open operations, log, commit or refresh indexes.

**Own the update through verified publication.** An authorized wiki edit includes
validation, the scoped operation commit, and pushing to its configured upstream
with `wiki-sync.mjs`, followed by remote verification. Finish those steps without
asking a separate routine permission question. An explicit user instruction to
hold publication or keep the work local overrides this default. A local commit
or a closed token alone does not publish the update. If a remote is absent or sync
fails, report the work as unpublished with its exact next action. Never create a
remote or repository merely to satisfy this rule. A token is not resolved merely
because its file was deleted; account for the work and verify the outcome.

1. **Resolve scope and authorization.** Read the vault's instructions. Existing
   session authorization counts: a request to make a wiki update includes its
   normal commit-and-sync completion unless an explicit hold applies. A request to
   answer/search does not authorize filing a new page. Purge requires its specific
   reviewed plan and publication approval; do not replace those with this rule.
2. **Open before the first write.** Run `op-begin.mjs --op <op>` and save its token.
   On task resumption, reconcile a saved token before opening another one. Keep
   the operation type, title, owned-path ledger, log path and last completed phase
   with it so recovery can distinguish unfinished work from an already closed step.
   It snapshots already-dirty paths; `op-commit` excludes them. It does not isolate
   simultaneous edits to the same file. Coordinate overlapping targets; preserve
   pre-existing changes and report exclusions instead of sweeping them into a commit.
   With concurrent writers, maintain an explicit ledger of the exact vault-relative
   files this operation owns, including its log and generated catalogs when safe.
   Pass a JSON array of those paths using `op-commit.mjs --paths-file <file>`;
   keep the manifest under `.wiki-master/` or outside the vault. This narrows the
   newly dirty delta and reports other new paths as outside scope. It does not
   override pre-dirty exclusions or isolate simultaneous edits to the same file.
   Without explicit scope, subtraction alone can include another writer's new edits.
   An existing enclosing operation may own delegated clips and triage bookkeeping;
   record who closes it rather than opening a second operation unnecessarily.
3. **Edit and validate.** Check the requested behavior/content, valid frontmatter,
   canonical placement and exact citation/link targets. Preserve raw bodies and
   unrelated changes. `reviewed` advances only for factual verification. On uncertain
   write timeouts inspect the target before retrying; do not make a duplicate page.
4. **Refresh affected catalogs once.** For project authoring run `node "<absolute-plugin-root>/scripts/refresh-catalogs.mjs" --project <slug> --apply` instead of three separate generators. It builds one vault graph, updates only that project's backlog and MOC, then the global index; unchanged files are not rewritten. With concurrent writers, pass `--paths-file <JSON ownership ledger>` to include only tracked pages and this operation's untracked additions in the snapshot. Add the returned `changed` paths to the operation's commit ledger after inspecting them. Tracked pages are never hidden. Without a project selector it refreshes all projects. Standalone generators remain available and the project generators accept `--project`. A global scan is still needed for cross-project ambiguous names.
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
7. **Push and verify your update.** `op-commit` itself never pushes. The plugin
   scripts own the vault's git, so sync with `node "<absolute-plugin-root>/scripts/wiki-sync.mjs"`,
   not a bare `git push`: it fetches, rebases onto the upstream (never a merge commit),
   pushes, retries once when another machine pushed first, and verifies against a fresh
   fetch. Run it after `op-commit`, never between edits; it names any operation still
   open. A conflict aborts the rebase, exits 1 and names the files; the local commits are
   intact. Report it and stop: do not force, resolve by guessing, or claim success.
   Inspect the sync result and verify the operation's resulting commit is included
   in the freshly fetched upstream. After a rebase, identify it by its unique log
   path and verify its actual changed paths rather than assuming its old SHA.
   Do not stop at a local commit, delegate publication to Obsidian Git, or ask the
   user to push work you are responsible for. Inspect outgoing commits first;
   coordinate rather than publish unrelated or explicitly held local commits.
   `--commit-local` first commits hand edits made outside any operation (the owner's
   own Obsidian edits) in one scoped `sync:` commit; it refuses while any operation is
   open, because dirty files cannot then be attributed. Use ordinary sync for your
   operation; do not use `--commit-local` to sweep another writer's unfinished work.
   When the user explicitly holds publication, retain the local commit and report
   that it is unpushed. Without an upstream, report local-only completion.

## Recovery and token ownership

- **Retry the same operation.** After a recoverable failure, inspect the token,
  exact owned files and actual commits before retrying the failed step. Resolve
  an understood cause within the authorized scope without another confirmation.
  A failed Git close keeps its token; retry that `op-commit`, not the edits or an
  already-written log. Never delete a Git lock or guess at a content conflict.
- **Reconcile uncertain completion.** A timeout may have occurred after a commit
  or token removal. Verify the actual commit's subject and path membership, owned
  content and validation state. A completed no-op or already-committed operation
  with a retained token still closes through its own scoped `op-commit`; an empty
  delta alone does not prove completion. If the token is already gone, verify
  closure and continue from the next unfinished step rather than opening a new
  token or replaying work. After a sync rebase, locate the operation through its
  unique log path and recheck the resulting commit instead of relying on its old SHA.
- **Respect holds and ownership.** Do not close a user-held operation. A delegated
  worker reports its owned paths and validation to its enclosing operation's named
  owner rather than closing the parent's token. That owner remains responsible for
  the scoped commit, push and remote verification; delegation does not drop the
  publication step. Leave other agents' tokens alone unless ownership was explicitly transferred;
  tokens contain an opening dirty-path snapshot, not proof of who owns later edits.
- **Leave actionable blockers.** If safe progress requires an unresolved conflict,
  missing authorization or another owner's action, retain the operation and record
  its token, owned paths, completed steps, pending work and exact next action. Report
  that blocker or ownership handoff; do not claim completion or silently abandon it.

**Abandoned tokens.** List retained tokens with
`node "<absolute-plugin-root>/scripts/op-cleanup.mjs"` (a dry run). Older than 24
hours means a review candidate, not proven abandonment; these tokens still block
`wiki-sync --commit-local`. For a verified-abandoned operation you own, with no
unfinished work or user hold, apply cleanup with its explicit `--apply --token <id>`
without another approval. Prefer normal `op-commit` closure when the saved operation
can be completed. `--hours <n>` changes the age filter, with a one-hour minimum;
respect that eligibility and verify removal. Never sweep tokens by age or delete
them manually. Token files are local Git-ignored state, not cross-machine locks.

**Git ownership.** The Obsidian Git plugin stays installed for its source-control view
and for pulling. Its auto-commit and auto-push must be off (auto commit-and-sync
interval 0, commit on file change off, auto push interval 0): they commit half-finished
operation edits under "vault backup" and leave `op-commit` an empty delta. `wiki-sync`
warns when they are on. Every machine sharing the vault needs the same setting.

**Done only when** the requested change is validated, applicable catalogs and one
operation log are recorded, the operation commit is verified (or its precise
limitation reported), and its push and remote publication are verified. A user-held
or local-only result must be labeled accordingly. If blocked partway, preserve the
actual operation/commit state and leave the actionable handoff above; a sync failure
after token closure does not require a replacement token. Do not start over blindly.

## Exceptions with their own transaction

**Re-clipping:** `apply-reclips.mjs` applies repairs but does not own a commit. Use an enclosing operation with an exact target list and ownership ledger; inspect its returned changed paths. A verified repair, a pending table verification and a quarantine are distinct outcomes. Quarantine may close triage without making evidence citable. See [re-clipping and quarantine](../../../docs/reclipping.md) for selectors, mode overrides and the explicit terminal-failure policy.

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
close step after a failed edit/check. These examples assume a configured upstream
and no explicit user hold, so they include the push step. For an explicit local-only
request, omit that step and report the unpushed commit.

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
  node 'C:/absolute/installed/plugin/scripts/wiki-sync.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Wiki update is committed locally but not verified published' }
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
  node '/absolute/installed/plugin/scripts/wiki-sync.mjs' || exit
)
```
