# Initialize a new vault safely

Read [access](../../wiki-maintainer/references/access.md) and
[completion](../../wiki-maintainer/references/operations.md) before
initializing. Resolve the explicit intended root. Never
initialize a guessed directory or create a Git repository or remote: the owner sets up
the git repository and upstream. Obsidian Git handles all git operations from there.

For a vault other than the default, every command in this flow names it, as written below.
A command that loses it acts on the default vault, and a refresh writes catalogs there. In
PowerShell the form is `$env:WIKI_MASTER_VAULT='<root>'; node ...`. If the app knows the vault by a
name other than its folder's, set `WIKI_MASTER_VAULT_NAME` the same way on every command. Only
the default vault can leave these off. `init.mjs` prints its next steps in this form.

## Preflight existing files

Inspect the intended root's existing `AGENTS.md`, schema, index and `_templates/`.
The initializer creates missing ordinary files exclusively,
including nested `_templates/` files and root starter documents. Existing
customized, identical and user-only files keep their bytes and modification
times. A competing ordinary file created at the destination is also preserved.
It reports sorted `created:`, `preserved:` and `differing:` paths without printing
contents. A differing ordinary file is a successful skip, not an error. An existing
`vault-schema.md` or `.gitattributes` is kept like any other file, so an older vault's
schema can still describe the old git policy; report that as a difference, do not rewrite it.

Linked source/destination roots or descendants and file/directory conflicts are
obstructions. The initializer does not follow or replace them. An I/O failure or
obstruction exits nonzero and reports blocked paths and any partial creation.
Successful new files remain. An `incomplete:` file may contain partial data;
inspect it before any further authorized recovery. A retry adds missing files
but preserves that existing partial file too. There is no reset, migration or
overwrite mode.

## Initialize and verify

1. State the prerequisites before changing anything: Obsidian with its command line
   interface on, Obsidian Git, Ollama with the embedding model, and a git repository
   with an upstream.
   `WIKI_MASTER_VAULT='<root>' node "<absolute-plugin-root>/scripts/doctor.mjs" refresh-index`
   reports the programs, Ollama with its model, and Obsidian Git's plugin and timer. It does
   not check the repository, the upstream, a running Obsidian or restricted mode.
   `setup-obsidian-git.mjs --check` adds each required setting, and `refresh-index.mjs --status`
   reports only how fresh the index is. Only `refresh-index.mjs` itself checks the rest, before it
   writes anything. Reading and searching need none of them; authoring needs them all.
2. Run `WIKI_MASTER_VAULT='<root>' node "<absolute-plugin-root>/scripts/init.mjs"` and inspect
   the exit status and path report: a failure is not a completed scaffold. Account for retained new and
   incomplete files before retrying. Inspect the expected `raw/clippings`, wiki content
   folders, `moc`, `log`, `_templates`, schema, index, bases and `.gitattributes`, and
   confirm prior content bytes are unchanged. Run the direct
   [health check](checks.md#health-and-ingest-backlog): empty content is expected in a new
   vault, so report scan scope instead of claiming factual health. Validate any authored
   pages this task also created using [scoped validation](validation.md), then write one
   log entry, with its body on stdin:
   `WIKI_MASTER_VAULT='<root>' node "<absolute-plugin-root>/scripts/log-entry.mjs" --op relink --title "Initialize vault"`.
3. The owner sets up the git repository and upstream. This skill does not create either,
   and a vault without them cannot complete a refresh. Ask them to, and wait for the answer.
4. Have the owner open the vault in Obsidian: "Open folder as vault". The CLI cannot do this
   for a folder Obsidian has not registered. Ask them, at this step, to trust the vault and turn
   off restricted mode under Settings > Community plugins: every new vault starts with
   restricted mode on, and the install in the next step stops until it is off. Verify with
   `WIKI_MASTER_VAULT='<root>' node "<absolute-plugin-root>/scripts/obsidian.mjs" vaults`, and use
   [app access](app-access.md) if that fails. Filesystem health does not prove the native
   CLI reaches the app. Relay the optional step of importing
   `templates/webclipper-template.json` into Web Clipper.
5. Offer to install, enable and configure Obsidian Git, as [below](#install-obsidian-git).
   If the owner declines, follow [the declined path](#if-the-owner-declines) and stop here.
6. Run `WIKI_MASTER_VAULT='<root>' node "<absolute-plugin-root>/scripts/refresh-index.mjs"` last.
   Its first run builds the search index. If it stops, read [written but not refreshed](operation-recovery.md#written-but-not-refreshed).

**Done:** expected files exist, prior content is preserved, one log entry is written, Obsidian
Git is enabled and the refresh exited 0. Say that the work is on disk and that Obsidian Git
publishes it on its next run. If an obstruction, a partial write or a failed prerequisite
prevents completion, report the affected paths, the retained creations and who clears the
block; preserve existing content.

## If the owner declines

Setup stops. A decline given up front counts too: run `init.mjs` with its log entry, and skip
the rest. Report that the vault can be read and searched (keyword search, until a refresh
builds the semantic index), that authoring cannot complete because the last step of every
authoring task needs Obsidian Git, and to rerun setup later. `refresh-index.mjs` is not run.
There is no other mode to fall back to.

## Install Obsidian Git

`--check` reads files and needs no app, so it cannot see restricted mode, which lives in the
app. A clean result does not prove the plugin is running:

```sh
WIKI_MASTER_VAULT='<root>' node "<absolute-plugin-root>/scripts/setup-obsidian-git.mjs" --check
```

It reports the plugin's state and each required setting as `met`, `missing` or `differs`. It
exits 0 only when the plugin is enabled and every setting matches. The required settings are
`autoSaveInterval: 10`, `syncMethod: rebase`, `mergeStrategy: theirs`, `autoPullOnBoot: true`,
`autoPushInterval: 0` and `autoPullInterval: 0`. Every machine sharing the vault needs them.

Offer `--apply` when something is missing. The owner's yes is the permission, and there is no
further gate. It needs the vault open in Obsidian in this session:

```sh
WIKI_MASTER_VAULT='<root>' node "<absolute-plugin-root>/scripts/setup-obsidian-git.mjs" --apply
```

It installs the plugin without enabling it, writes the settings only if the plugin has none,
then enables it, so the plugin's first load already sees them. Reinstalling is never part of it,
and it runs only the steps still needed. An existing settings file stays byte-identical: report
the differences it prints, and leave changing them to the owner in Obsidian Git's settings.
`autoSaveInterval` at 0 matters most, because `refresh-index.mjs` refuses to run until it is
above 0. If restricted mode or anything else blocks a step, it stops and prints the manual
steps; relay them and see [setup did not finish](operation-recovery.md#setup-did-not-finish).
