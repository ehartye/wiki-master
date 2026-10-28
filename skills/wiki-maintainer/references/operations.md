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
   Let the writers keep it: give `--since <token>` to every clipper, to `log-entry.mjs`,
   to `index-gen.mjs` and to `refresh-catalogs.mjs --apply`, each of which records the
   exact path it writes (unquoted UTF-8, so a name with an em dash survives), and record
   a page you wrote with your own file tools using `op-ledger.mjs add --since <token>
   <path>...`. `op-ledger.mjs show --since <token> --out <file>` writes the JSON array
   `--paths-file` takes and lists on stderr what the close would get wrong: recorded
   paths that were already dirty before `op-begin`, recorded paths that are not dirty
   now, and changed paths nobody recorded (another writer's, or one you forgot; it
   never claims them). Do not rebuild the set from `git show` or `git status`: git
   prints a non-ASCII name in quotes with octal escapes unless told otherwise, and a
   name lost that way is lost without an error.
   Pass a JSON array of those paths using `op-commit.mjs --paths-file <file>`;
   keep the manifest under `.wiki-master/` or outside the vault. This narrows the
   newly dirty delta and reports other new paths as outside scope. A ledger path that
   was already dirty when you ran `op-begin` is refused, not skipped: `op-commit` exits 1,
   names it and keeps the token. If this operation wrote it, run the same `op-commit`
   again with `--include <path>` for each (or `--include-from <file>`); if another writer
   owns it, take it out of the ledger. **Create new files only after `op-begin`**: a page
   written first counts as already dirty. It does not isolate simultaneous edits to the
   same file.
   **The guard.** `op-commit` without `--paths-file` commits everything that became
   dirty since `op-begin`, which cannot tell this operation's new files from another
   open operation's. So while any other operation token exists, of any age (age cannot
   show that an operation was abandoned), such a close is refused: `op-commit: this
   close has no --paths-file and another operation is open: <token> (<op>), ...`. It
   exits 1, commits nothing, keeps the token, and prints the way out: `op-ledger.mjs
   show --since <token> --out <ledger>`, then the same `op-commit` with `--paths-file
   <ledger>`. There is no override flag. A close with `--paths-file` is unchanged, and
   with no other token open an unscoped close behaves as before. Every refused close
   (this one, a pre-dirty ledger path, an evidence mismatch) appends a counts-only
   line to `.wiki-master/op-refusals.jsonl`; see "Refusal record" below.
   When the ledger carries a receipt that records its own byte length and SHA-256
   (captured JSON or log evidence), also pass `--evidence-map <file>`: a JSON object
   of ledger path to `{ "bytes": N, "sha256": "<64 lower-case hex>" }`, kept beside
   the ledger. After staging and before committing, `op-commit` compares each staged
   blob with its declaration. On a mismatch it commits nothing, unstages, keeps the
   token, and names the file, the declared and stored size and hash, and the exact
   `.gitattributes` line (`<path> -text`) that keeps the bytes. Add that one line,
   list `.gitattributes` in the ledger and rerun. It never edits an attribute itself,
   and ordinary Markdown keeps the vault's text policy. A pass is reported as its own
   `evidence:` line, separate from the index notice.
   An existing enclosing operation may own delegated clips and triage bookkeeping;
   record who closes it rather than opening a second operation unnecessarily.
3. **Edit and validate.** Check the requested behavior/content, valid frontmatter,
   canonical placement and exact citation/link targets. Preserve raw bodies and
   unrelated changes. `reviewed` advances only for factual verification. On uncertain
   write timeouts inspect the target before retrying; do not make a duplicate page.
4. **Refresh affected catalogs once.** For project authoring run `node "<absolute-plugin-root>/scripts/refresh-catalogs.mjs" --project <slug> --apply` instead of three separate generators. It builds one vault graph, updates only that project's backlog and MOC, then the global index; unchanged files are not rewritten. Leave out `--apply` for a dry run: it writes nothing and its `changed` list is the list an apply would change, and `--diff` prints each changed file's removed and added lines to stderr. With concurrent writers, pass `--paths-file <JSON ownership ledger>` so another writer's uncommitted pages stay out: a page is listed when it is in the last commit or the ledger names it, and a page another writer has only staged is not. A line the catalog already has for such a page, put there by that writer's own run, is kept. Inspect the returned `changed` paths; with `--since <token>`, an `--apply` records them in the operation's ledger (a dry run records nothing). Without a project selector it refreshes all projects. Standalone generators remain available and the project generators accept `--project`. A global scan is still needed for cross-project ambiguous names.
5. **Log once.** Pipe a concise narrative into `log-entry.mjs --op <op> --title
   "<title>"`. It writes one uniquely named `log/YYYY-MM-DD-HHmmss-<op>-<slug>.md`,
   with date/op/title frontmatter and a grep-friendly heading. Use the existing
   operation vocabulary (ingest, discover, query, lint, relink); authoring uses
   relink. Never append to a shared aggregate log; browse through `log.base`. Pass
   `--since <token>`: the entry's name carries a timestamp known only now, and the
   ledger is how it reaches the close.
6. **Commit and inspect.** Run `op-ledger.mjs show --since <token> --out <ledger>`,
   read what it lists as unclaimed, then `op-commit.mjs --op <op> --title "<title>"
   --since <token> --paths-file <ledger>`. Without `--paths-file` the close is refused
   while any other operation is open (the guard, step 2). Verify its result and the actual changed paths. Never `git add -A`.
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
   `rebase-failed` is different: the rebase never started (usually a held `.git/index.lock`),
   so no files are named and nothing changed. Wait for the other git process, never delete
   a lock, and run `wiki-sync` again. The line gives the lock's age; git records no holder,
   so a lock that stays old with no git process running is for the owner to judge.
   Older versions printed a held lock as a conflict in "unknown files": an empty file list
   means it was not a content conflict. Any sync, yours or another writer's, stashes and
   restores every uncommitted tracked file, so their modification times change and a CRLF
   file can come back LF with git's content unchanged; check line endings and content
   just before `op-commit`, not before an earlier sync.
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

   **Close and publish in one command.** `wiki-sync.mjs --op <token>` closes that one
   operation through the same close `op-commit` makes, then runs the normal sync and
   verifies against a fresh fetch. The scope is `--paths-file <ledger>` when given;
   otherwise the paths the operation's writers recorded (`op-ledger.mjs`), when it has
   any; otherwise an unscoped close, which the guard refuses while another operation
   is open. `--title "<title>"` is the commit message (default `published with
   wiki-sync --op`; the subject is `<op>: <title>`). It never closes a token it was not
   given, and it cannot be combined with `--commit-local` (a usage error, exit 1).
   Success prints `closed operation <token>: committed <sha7> (<n> file(s))`, then the
   normal sync lines, exit 0. After a landed close it prints the same hard-wrapped
   wikilink warning `op-commit` does and refreshes the semantic index. A refused or
   failed close (token not open, unreadable `--paths-file`, the guard, a pre-dirty
   path, a git failure) prints a line starting `not committed:` to stderr, exits 1,
   pushes nothing and keeps the token. A close that landed whose sync then failed
   prints a line starting `committed, not published:` with the short sha, exits 1, and
   the token is gone because the commit exists; run `wiki-sync.mjs` again once the
   cause is fixed. Pass `--paths-file` instead of relying on the recorded paths when
   you have also written pages with tools that do not record them.

   Without `--op`, `wiki-sync` also prints, for each open operation that has recorded
   paths still uncommitted, `operation <token> (<op>) has <n> recorded path(s) not
   committed; if it is yours, close and publish it with: node scripts/wiki-sync.mjs
   --op <token>`. It is a line, not a failure: a sync cannot know whose operation it
   is, so the exit code is unchanged and already-committed work is still pushed. It
   follows the once-per-set, once-a-day rule of the open-operations note, keyed by
   token and recorded count, so it is said again when an operation records more. An
   open operation with no recorded paths gets only the existing note.

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
  owner rather than closing the parent's token. The hand-off is the ledger: the brief
  gives the worker the parent's token; the worker records each path it writes with
  `op-ledger.mjs add --since <parent token> <path>...` (a clipper it runs takes
  `--since` too) and reports its validation; it never runs `op-commit` or `op-abort`.
  The owner runs `op-ledger.mjs show --since <parent token>`, resolves whatever it
  lists as unclaimed, and closes once. That owner remains responsible for
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
The paths an operation's writers recorded sit in `<token>.paths.jsonl` beside the
token. `op-commit` (when the close lands), `op-abort` and a stale token removed by
`op-cleanup` take it with them; `op-cleanup` also lists a ledger whose token is
already gone and removes it only with `--apply --token <that id>`.

**Stopping early.** A session that opened an operation and will not finish it, or whose work landed another way, drops its own token with `node "<absolute-plugin-root>/scripts/op-abort.mjs" --since <token>`. It removes that one token whatever its age and nothing else: the files the operation wrote stay in the working tree, uncommitted, for a later operation to commit. Do not use it on a token another session holds. Open operations are visible without running a sync: `health` and `session-brief` print a line when any are open, and `wiki-sync` mentions other writers' operations once for a given set of tokens, again when the set changes, and once a day while it stays true.

**Refusal record.** Each `op-commit` close that is refused and keeps its token appends
one JSON line to `.wiki-master/op-refusals.jsonl` (local, Git-ignored): `at` (ISO
time), `op`, `kind` and `paths`. `paths` is a number and never a path name. `kind` is
`pre-dirty` (a ledger path already dirty before `op-begin` and not adopted; `paths` is
how many), `evidence` (a declared size or hash that does not match what git would store;
`paths` is the size of the evidence map) or `unscoped` (the guard; `paths` is how many
delta paths the close would have committed). A close that lands appends nothing, and a
failed append (a directory in the file's place, a read-only disk) changes neither the
message nor the exit code. `health` prints `Recorded op-commit refusals: N (pre-dirty a,
evidence b, unscoped c).` only when N is above zero, and `health --json` always carries
`opRefusals` as `{ total, preDirty, evidence, unscoped }`. Like the open-operations line it
sits outside the defect count. The file is never trimmed by the plugin and a line that is
not a record of a known kind counts as nothing.

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
request, omit that step and report the unpushed commit. The close is scoped with
`--paths-file`; to close and publish in one command, replace the `op-commit` and
`wiki-sync` lines with `wiki-sync.mjs --op <token> --title 'Task title'` (add
`--paths-file <ledger>` to scope it explicitly).

```powershell
$wikiPriorVault = $env:WIKI_MASTER_VAULT
try {
  $env:WIKI_MASTER_VAULT = 'C:/absolute/path/to/vault'
  $wikiOpToken = node 'C:/absolute/installed/plugin/scripts/op-begin.mjs' --op relink
  if ($LASTEXITCODE -ne 0) { throw 'Could not open wiki operation' }
  # Perform authorized edits, validate, and refresh affected catalogs here.
  # Record each page written with your own file tools: op-ledger.mjs add --since $wikiOpToken <path>...
  'Validated task narrative' | node 'C:/absolute/installed/plugin/scripts/log-entry.mjs' --op relink --title 'Task title' --since $wikiOpToken
  if ($LASTEXITCODE -ne 0) { throw 'Could not log wiki operation' }
  $wikiLedger = Join-Path ([System.IO.Path]::GetTempPath()) "wiki-ledger-$wikiOpToken.json"
  node 'C:/absolute/installed/plugin/scripts/op-ledger.mjs' show --since $wikiOpToken --out $wikiLedger
  if ($LASTEXITCODE -ne 0) { throw 'Could not build the wiki operation ledger' }
  # Read what show listed as unclaimed before closing. An unscoped close is refused while another operation is open.
  node 'C:/absolute/installed/plugin/scripts/op-commit.mjs' --op relink --title 'Task title' --since $wikiOpToken --paths-file $wikiLedger
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
  # Record each page written with your own file tools: op-ledger.mjs add --since "$wiki_op_token" <path>...
  printf '%s\n' 'Validated task narrative' | node '/absolute/installed/plugin/scripts/log-entry.mjs' --op relink --title 'Task title' --since "$wiki_op_token" || exit
  wiki_ledger="${TMPDIR:-/tmp}/wiki-ledger-$wiki_op_token.json"
  node '/absolute/installed/plugin/scripts/op-ledger.mjs' show --since "$wiki_op_token" --out "$wiki_ledger" || exit
  # Read what show listed as unclaimed before closing. An unscoped close is refused while another operation is open.
  node '/absolute/installed/plugin/scripts/op-commit.mjs' --op relink --title 'Task title' --since "$wiki_op_token" --paths-file "$wiki_ledger" || exit
  node '/absolute/installed/plugin/scripts/wiki-sync.mjs' || exit
)
```
