# Completion for vault writes

Obsidian Git handles all git operations. This page is how an authorized vault write
finishes: capture, ingestion, original authoring, content repair, synthesis filing and
applied triage dispositions. Read-only search, answers, checks and previews write no
log and refresh nothing.

## Every authoring task ends the same way

1. **Write the pages.** Keep your edits to what your task needs: nothing isolates two
   writers on the same file, so read a page just before changing it and leave other
   writers' changes alone. Raw bodies stay immutable. Advance `reviewed` only after
   factual verification. Inspect an uncertain write's target before retrying it.
2. **Validate them.** Run `validate-authored.mjs --paths-file <ledger>`, a JSON array of
   the paths you wrote, by [scoped validation](../../wiki-setup/references/validation.md),
   plus any relevant [check](../../wiki-setup/references/checks.md). A failed check stops
   completion until its cause is resolved within scope.
3. **Log once.** Pipe a short narrative to `log-entry.mjs --op <op> --title "<title>"`. It
   writes one uniquely named file under `log/`. Original project documentation uses
   `relink`, a filed answer `query`; discovery, ingestion, lint and relink use their own.
4. **Run `refresh-index.mjs`,** once per task, not per page. It regenerates the catalogs
   and the search index for the whole vault; never hand-edit a generated fence. A delegated
   worker doesn't run it: it reports the paths it wrote, and the enclosing task runs it.

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

- **Purge.** `purge.mjs` writes its own log entry; [its skill](../../wiki-purge/SKILL.md) keeps
  the plan and approval, and still ends with the refresh.
- **Re-clipping.** `apply-reclips.mjs` takes an exact target list and returns the paths it
  changed. A verified repair, a pending table verification and a quarantine are distinct
  outcomes, and a quarantine can close triage without making evidence citable. See
  [re-clipping and quarantine](../../../docs/reclipping.md).
- **Initialization** follows [its own order](../../wiki-setup/references/initialization.md#initialize-and-verify).
- **Triage.** Starting the triage UI only creates machine-local session state, so it needs no
  log or refresh. Applying dispositions that change vault content finishes as above.
