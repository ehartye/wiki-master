# Completion for vault mutations

This is the single shared transaction contract for ordinary authorized vault
writes: capture, ingestion, original authoring, content repair, synthesis filing
and applied triage dispositions. Read-only search, answers, checks and previews
open no operations, logs, commits or refreshes. Purge retains its separate plan
and publication approvals and owns its transaction.

## Ownership and authorization

An authorized wiki edit includes scoped validation, catalog maintenance, log,
commit, sync and verified remote publication unless the user explicitly holds it.
Finish those steps without another routine permission question. Never create a
remote/repository just to satisfy publication. Without an upstream report local-only;
a local commit or closed token alone is not publication.

Read vault instructions. Preserve foreign edits and immutable raw bodies. A token
snapshots existing dirty paths, not later ownership, and does not isolate edits to
the same file. Coordinate overlapping targets. On resumption reconcile the saved
token, owned paths, log and actual commit before opening another operation; use
[operation recovery](../../wiki-setup/references/operation-recovery.md) for details.
Never delete a token or Git lock to hide unfinished work.

An enclosing operation may own delegated work. Give the worker that token; it
records exact paths and validation, never closes or aborts the parent's operation.
The named owner remains responsible for scoped publication. Do not close user-held
or foreign tokens. If blocked, retain actual state and a durable handoff naming
the token, owned files, completed steps, unfinished work and exact next action.

## Ordinary lifecycle

1. **Open before the first write.** Run
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op <op>` and retain the token.
   Create new pages only afterward. Use the existing operation vocabulary:
   original project documentation uses `relink`; derived answer filing uses `query`;
   discovery, ingestion, lint and relink retain their task operations.
2. **Keep an exact ledger.** Pass `--since <token>` to clippers, `log-entry.mjs`,
   `index-gen.mjs` and applied `refresh-catalogs.mjs` so they record actual written
   paths. Record file-tool edits with
   `op-ledger.mjs add --since <token> <vault-relative-path>...`. Use
   `op-ledger.mjs show --since <token> --out <ledger>` to produce the JSON array for
   `--paths-file`, under `.wiki-master/` or outside the vault. Inspect its warnings:
   pre-dirty recorded paths, paths no longer dirty and changed but unrecorded paths.
   Do not rebuild the ledger from Git's quoted filename display: Unicode paths
   can be silently lost. Unclaimed files are not automatically yours.
3. **Edit and validate.** Check behavior, schema, canonical placement and exact
   citations. Follow direct [scoped validation](../../wiki-setup/references/validation.md)
   for changed pages and the relevant [checks](../../wiki-setup/references/checks.md).
   Advance `reviewed` only after factual verification; mechanical edits preserve it.
   Inspect an uncertain write's actual target before retrying. A failed check
   stops completion until its cause is resolved within scope.
4. **Refresh affected owned catalogs once.** Generated fences are derived, never
   hand-edited. `index-gen.mjs` regenerates the global index while preserving manual
   framing. Project documentation uses [project catalogs](../../wiki-project/references/catalogs.md).
   A catalog already dirty from another writer remains theirs: use safe project
   generators and report deferred global refresh. Record actual changed paths,
   rebuild the ledger and rerun validation when the owned set grows.
5. **Log once.** Pipe a concise narrative to
   `node "<absolute-plugin-root>/scripts/log-entry.mjs" --op <op> --title "<title>" --since <token>`.
   The helper creates one unique `log/YYYY-MM-DD-HHmmss-<op>-<slug>.md` with
   date/op/title metadata and records its path. Never append to an aggregate log.
6. **Commit and inspect.** Regenerate the ledger and read its warnings, then run
   `node "<absolute-plugin-root>/scripts/op-commit.mjs" --op <op> --title "<title>" --since <token> --paths-file <ledger>`.
   Never stage the whole vault. Verify actual path membership. A failed close
   retains the token. An unscoped close is refused whenever another token exists,
   of any age; there is no override. Pre-dirty paths require explicit ownership
   reconciliation; follow [close refusals](../../wiki-setup/references/operation-recovery.md#close-refusals).
   When receipts declare byte/hash integrity, pass their `--evidence-map <file>`;
   a mismatch must be resolved before completion, never ignored. The helper tries
   semantic index refresh after commit: inspect missing-backend/partial-build
   notices using [search diagnostics](../../wiki-setup/references/search-diagnostics.md).
   A non-Git vault is local-only, not a successful Git commit.
7. **Sync and verify.** `op-commit` never pushes. Run
   `node "<absolute-plugin-root>/scripts/wiki-sync.mjs"` after closing, not between
   edits. It fetches, rebases, pushes with one rejection retry and verifies against
   a fresh fetch. Inspect outgoing commits before publishing; coordinate unrelated
   or explicitly held local commits. Verify the operation's commit is included in
   upstream; after a rebase locate it through its unique log path and inspect the
   resulting path membership. Do not delegate publication to Obsidian Git or the user.
   Follow [sync recovery](../../wiki-setup/references/operation-recovery.md#refused-sync)
   on failure; never force or guess at conflicts. `--commit-local` is for owned hand
   edits outside operations, refuses with any open token, and must not sweep foreign work.

## Combined close and publication

`wiki-sync.mjs --op <token> --paths-file <ledger> --title "<title>"` performs the
same scoped close, then normal sync and remote verification. It closes only the
given token and cannot combine with `--commit-local`. Without an explicit ledger
it uses recorded paths when available, else the guarded unscoped close; prefer an
explicit ledger, especially for file-tool edits. Success distinguishes the landed
commit and publication. A refused close pushes nothing and retains its token;
`committed, not published:` means the close landed and sync still needs recovery.
Inspect state and retry the unfinished step, not the content or log.

**Done only when** the requested change and owned catalogs are validated, one log
and the scoped operation commit are recorded, and remote publication is verified.
Report holds, local-only results and blockers precisely. Detailed verification,
refusal records, uncertain completion, cleanup and Git settings belong to
[operation recovery](../../wiki-setup/references/operation-recovery.md).

## Exceptions with their own transaction

**Re-clipping:** `apply-reclips.mjs` applies repairs but does not own a commit. Use an enclosing operation with an exact target list and ownership ledger; inspect its returned changed paths. A verified repair, a pending table verification and a quarantine are distinct outcomes. Quarantine may close triage without making evidence citable. See [re-clipping and quarantine](../../../docs/reclipping.md) for selectors, mode overrides and the explicit terminal-failure policy.

- `purge.mjs --apply`, `--restore` and `--reconcile` own their manifests, logs and
  commits. Do not wrap their transaction in a competing commit. Collateral Markdown
  repairs use an ordinary operation after the purge commit. Keep every seed/plan,
  blocking-source and publication safeguard in the purge skill.
- Fresh initialization can open an operation before scaffolding: the helper can create
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
