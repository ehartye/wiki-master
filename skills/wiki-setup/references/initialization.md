# Initialize a new vault safely

Read [access](../../wiki-maintainer/references/access.md) and
[operation completion](../../wiki-maintainer/references/operations.md) before
initializing. Resolve the explicit intended root and scoped environment. Never
initialize a guessed directory or create a Git repository/remote just to publish.

## Preflight existing files

Inspect the intended root's existing `AGENTS.md`, schema, index and `_templates/`.
The corrected source initializer creates missing ordinary files exclusively,
including nested `_templates/` files and root starter documents. Existing
customized, identical and user-only files keep their bytes and modification
times. A competing ordinary file created at the destination is also preserved.
It reports sorted `created:`, `preserved:` and `differing:` paths without printing
contents. A differing ordinary file is a successful skip, not an error.

Linked source/destination roots or descendants and file/directory conflicts are
obstructions. The initializer does not follow or replace them. An I/O failure or
obstruction exits nonzero and reports blocked paths and any partial creation.
Successful new files remain. An `incomplete:` file may contain partial data;
inspect it before any further authorized recovery. A retry adds missing files
but preserves that existing partial file too. There is no reset, migration or
overwrite mode.

### Older installed releases

This behavior is a source change after 0.89.0; it does not update an installed
plugin cache or establish a released version. Verify the actual installed helper
before relying on it. In 0.89.0 and earlier, the recursive template copy can
overwrite same-named files even though help says existing files are kept.

For those older helpers, compare existing templates with the installed
`templates/_templates/` before running init. With no collisions, continue;
identical collisions retain content but the old copy does not promise preserved
modification times. For differing/customized collisions, do not run old init or
temporarily move templates aside. Report the paths and preserve them. If the
request authorizes completing the partial scaffold, create only missing
folders/files with exclusive creation under the same operation, leaving every
existing file unchanged, and record the exact new paths. This is a workaround,
not an overwrite-safe option in the older helper.

## Initialize and verify

1. Open an operation **before** scaffolding:
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op relink`.
   The fresh-vault exception allows its state directory to exist before the other
   folders. Retain the token and owned-path ledger.
2. With the corrected helper, run
   `node "<absolute-plugin-root>/scripts/init.mjs"`; existing customized templates
   need no special mode. For an older installed helper, follow the preflight and
   missing-only workaround above instead. Inspect the exit status and path report;
   a failure is not a completed scaffold. Account for retained new and incomplete
   files before retrying or closing the operation.
   **`init.mjs` does not record an operation ledger.** Compare the preflight file
   list with the resulting files, then explicitly record every newly written file:

   ```sh
   node "<absolute-plugin-root>/scripts/op-ledger.mjs" add --since <token> <each-new-vault-relative-file>
   ```

   Include new root files (`index.md`, `log.md`, `.gitignore`, `vault-schema.md`,
   `stale.base`, `log.base`) and every new `_templates/` file, not just authored
   pages or the eventual log. Record actual files, not directories or files that
   were already present and unchanged. Inspect expected `raw/clippings`, wiki
   content folders, `moc`, `log`, `_templates`, schema, index and bases. Confirm
   prior content bytes are unchanged; distinguish scaffold success from app registration.
3. Run the direct [health check](checks.md#health-and-ingest-backlog). Empty content
   is expected in a new vault; report scan scope instead of claiming factual health.
   Validate any authored pages this task additionally created using
   [scoped validation](validation.md).
4. Write one relink log with `--since <token>`, then run
   `node "<absolute-plugin-root>/scripts/op-ledger.mjs" show --since <token> --out <ledger>`.
   **Inspect that ledger before closing:** every scaffold file written in step 2
   and the log must be present, including in a non-Git vault. Resolve unclaimed
   owned files with `op-ledger.mjs add`; do not assume initialization auto-recorded
   them or let a log-only ledger stand for the scaffold. Close through
   `op-commit.mjs --op relink --since <token> --paths-file <ledger> --title "Initialize vault"`.
   Without Git, report local-only initialization. With an existing configured
   upstream and no explicit hold, complete ordinary sync/remote verification.
   Do not leave a token open simply because no Git repository exists.
5. Relay one-time app setup separately: open the folder as an Obsidian vault,
   verify `node "<absolute-plugin-root>/scripts/obsidian.mjs" vaults`, and import
   `templates/webclipper-template.json` into Web Clipper. Use
   [app access](app-access.md) if requested app setup fails. Filesystem health
   does not prove the native CLI reaches the app.

**Done:** expected files exist, prior content is preserved, the initialization
operation is accounted for and publication/local-only state is explicit. If
an obstruction or partial write prevents completion, report the affected paths
and retained creations explicitly; preserve existing content.
