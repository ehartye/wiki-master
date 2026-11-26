# Completion for vault writes

Obsidian Git handles all git operations. Authorized vault writes finish here.
Read-only search, answers, checks and previews write no log and refresh nothing.

Resolve the originating role and read its selected vault's instructions before edits.
Retain [request binding](access.md#request-binding) through maintenance completion;
it cannot redirect capture or documentation. Keep ledgers, logs and refresh results
per vault; report each written/refreshed/blocked state without combining provenance.

## Every authoring task ends the same way

1. **Write the pages.** Keep your edits to what your task needs; read current content
   and preserve other writers' changes. Raw bodies stay immutable. Advance `reviewed`
   only after factual verification. Inspect an uncertain write's target before retrying.
2. **Validate them.** Run `validate-authored.mjs --paths-file <ledger>`, a JSON array of
   the paths you wrote, by [scoped validation](../../wiki-setup/references/validation.md)
   plus relevant [checks](../../wiki-setup/references/checks.md). Resolve failures within scope.
3. **Log once.** Pipe a short narrative to `log-entry.mjs --op <op> --title "<title>"`. It
   writes under `log/`: project docs use `relink`, filed answers `query`; other roles use their own.
   Use letters, digits, hyphens or underscores; start with a letter or digit. Invalid names and escaping paths exit 2.
4. **Run `refresh-index.mjs`,** once per task, not per page. It regenerates the catalogs
   and search index for that vault; never hand-edit a generated fence. A delegated worker writes and validates,
   then reports the paths it wrote; the enclosing task logs once and runs the refresh.

```powershell
node '<absolute-plugin-root>/scripts/validate-authored.mjs' --paths-file '<ledger>'
'Validated task narrative' | node '<absolute-plugin-root>/scripts/log-entry.mjs' --op relink --title 'Task title'
node '<absolute-plugin-root>/scripts/refresh-index.mjs'
```

```sh
node '<absolute-plugin-root>/scripts/validate-authored.mjs' --paths-file '<ledger>'
printf '%s\n' 'Validated task narrative' | node '<absolute-plugin-root>/scripts/log-entry.mjs' --op relink --title 'Task title'
node '<absolute-plugin-root>/scripts/refresh-index.mjs'
```

Stop at a step that fails. For a vault other than the default, name it on every command,
as in [name the vault](../../wiki-setup/references/initialization.md#name-the-vault).

**Report** that the work is on disk and that Obsidian Git publishes it on its next run.

**If the refresh exits 1,** it names the failure and the fix. Offer that fix to the user,
don't apply it unasked, and report the task as
[written but not refreshed](../../wiki-setup/references/operation-recovery.md#written-but-not-refreshed).

## Tasks with their own steps

- **Capture only.** A capture that wrote no wiki page verifies its paths, logs once and needs
  no refresh, because clippings and log entries enter neither the catalogs nor the search index.
  See [finish the capture](../../wiki-researcher/references/capture.md#finish-capture-and-report).
- **Purge and transfer.** `purge.mjs` writes its own log entry and `transfer.mjs` one in each vault; [purge](../../wiki-purge/SKILL.md)
  and [transfer](transfer.md) keep the plan and approval, and each written vault still ends with its own refresh.
- **Re-clipping.** `apply-reclips.mjs` takes an exact target list and returns the paths it
  changed. A verified repair, a pending table verification and a quarantine are distinct
  outcomes, and a quarantine can close triage without making evidence citable. See
  [re-clipping and quarantine](../../../docs/reclipping.md).
- **Initialization** follows [its own order](../../wiki-setup/references/initialization.md#initialize-and-verify).
- **Triage.** Starting the triage UI only creates machine-local session state, so it needs no
  log or refresh. Applying dispositions that change vault content finishes as above.
