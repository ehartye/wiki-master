# Recover a failed setup or an unfinished refresh

Obsidian Git handles all git operations, so nothing here runs a git command that changes
the repository. Read-only commands such as `git status` and `git log` are fine. A diagnostic
request inspects state only, and every fix below is offered, not applied unasked. Keep the
exact failure text; do not redo work that is already on disk.

Read [completion](../../wiki-maintainer/references/operations.md) before any authorized recovery.

## Written but not refreshed

The pages are on disk and `refresh-index.mjs` stopped. Nothing is lost: Obsidian Git still
publishes the pages on its next run, and the catalogs and search index catch up at the next
refresh. Validate and log first if that has not happened yet, then report the task as written
but not refreshed. Rerun the refresh once the cause is fixed; do not rewrite the pages or log again.

It checks everything first and reports every failure at once, having written nothing.
`node "<absolute-plugin-root>/scripts/refresh-index.mjs" --status` shows how fresh the index
is, checks nothing and always exits 0.

| It reports | Fix to offer |
|---|---|
| Ollama is not reachable | Start the Ollama app. |
| The embedding model is not pulled | Pull it: `ollama pull <model>`. |
| Obsidian is not running for this user | Start Obsidian with this vault open. |
| The CLI gate is busy or failing (`CLI_BUSY`, `CLI_LOCK`) | Rerun. Treat a repeat as the CLI being down, and offer to restart Obsidian. |
| The Obsidian CLI did not answer | Start Obsidian with this vault open and its command line interface on. |
| Obsidian's active vault is another one | Open this vault in Obsidian or bring its window to the front, then rerun. |
| The process list could not be read | Rerun; if it repeats, check by hand that Obsidian is running. |
| Obsidian Git is not installed or not enabled | Install it through [initialization](initialization.md#install-obsidian-git). |
| Obsidian Git's timer is off (`autoSaveInterval` is 0 or unset) | Change it in Obsidian Git's settings. Setup never overwrites existing settings. |
| Not a git repository, or no upstream | The owner sets these up; ask them to. |
| A rebase or merge is in progress | Rerun shortly. Tell the owner if it stays stopped or the conflict file exists. |
| A detached HEAD | Tell the owner; they put it back on its branch. |

**Another active vault.** The Obsidian check asks about the active vault: it calls the CLI
with no `vault=`, from a folder outside any vault, so that the question cannot open or
switch anything. If another vault is active, `refresh-index.mjs` stops and says which one.
When Obsidian runs only in another session, as over SSH, the check passes with a note and
the CLI is not called.

**After the checks.** The catalogs are written first, then the search index. Failed chunks
exit 1 with their count and the catalogs stay, so rerun the same command. A damaged index
is replaced by `refresh-index.mjs --rebuild`, which reuses every stored vector that still
passes inspection.

## Setup did not finish

`setup-obsidian-git.mjs --apply` stops at the first block, says what it was and prints the
manual steps. Rerun `--apply` once the cause is gone: it skips what is already done, and it
never rewrites an existing settings file.

- **Restricted mode is on.** The owner turns it off under Settings > Community plugins.
  Do not switch it from the command line.
- **Obsidian has not opened this vault.** The owner opens the folder as a vault in Obsidian.
  The CLI cannot do this, and it exits 0 while answering `Vault not found.`
- **The vault name reaches a different folder.** The CLI matches a vault by folder name,
  so two vaults can share one. Set `WIKI_MASTER_VAULT_NAME`, or have the owner rename a folder.
- **Obsidian is in another session.** Run setup from the desktop session, or follow the
  manual steps there.

An interrupted `init.mjs` keeps what it created and retries safely; see
[initialization](initialization.md#preflight-existing-files).

## Obsidian Git reports an error

Tell the owner what it said. It shows the error as a notice inside Obsidian. Do not work
around it with git commands, and do not retry anything on its behalf: its next run tries
again by itself. Work already on disk stays on disk, and it publishes once the owner has
cleared the cause.

## `conflict-files-obsidian-git.md`

Obsidian Git writes this file at the vault root when a rebase stops. With
`mergeStrategy: theirs`, conflicts on the same lines complete by themselves. A file changed
on one machine and deleted on another stops the rebase, and the plugin then publishes
nothing until the conflict is resolved.

Tell the owner that the file exists and what it lists, adding what `git status` and `git log`
show about each side. Do not edit or delete it, resolve the conflict, or guess at which side
wins, even when asked to fix it: that choice is the owner's. They finish it in Obsidian Git's
source control view or their own git client. Until they do, `refresh-index.mjs` can stop on a
rebase in progress, so a task with pages waiting is reported as written but not refreshed.

## Interrupted write

A timeout or a dead process does not prove what happened. Read the exact target, compare it
with the intended effect and continue from the next unfinished step. Do not start over: edits
from another writer may be in the same file, and nothing isolates two writers of one file.

## Interrupted purge

The [purge workflow](../../wiki-purge/references/purge.md) owns approval, seeds and the
manifest. Recovery never widens an approved plan.

`--apply` reports the files it could not move, usually because another program has them open:
antivirus mid-scan, the search indexer, a client holding a read-only handle. What moved stays
on disk and its log entry stands.

Close whatever holds them open, then run
`node "<absolute-plugin-root>/scripts/purge.mjs" --reconcile`. It finishes this purge in place,
into the same bin folder. Then run `refresh-index.mjs`.

**Do not re-run `--apply`.** It starts a *second* purge under a new id and fragments this one
across two manifests, so neither restores correctly.

**Done only when** the requested change is validated and logged and `refresh-index.mjs` exits 0,
or the report names exactly what is blocked and who clears it. When nothing blocks, say that the
work is on disk and that Obsidian Git publishes it on its next run.
