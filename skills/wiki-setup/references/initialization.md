# Initialize a new vault safely

Read [access](../../wiki-maintainer/references/access.md) and
[operation completion](../../wiki-maintainer/references/operations.md) before
initializing. Resolve the explicit intended root and scoped environment. Never
initialize a guessed directory or create a Git repository/remote just to publish.

## Preflight existing files

Inspect the intended root's existing `AGENTS.md`, schema, index and `_templates/`.
`init.mjs` preserves existing root index/schema/base files, but its recursive
template copy can overwrite same-named files under `_templates/`. Its generic
“existing files are kept” help is not a guarantee for customized templates.

For a new root or one with no template collisions, continue. If templates already
exist, compare them against the installed `templates/_templates/` before running
init. Identical collisions are safe; differing/customized collisions require a
non-overwriting plan. Do not run init over those templates or temporarily move
them out of the way merely to restore them later. Report the exact collisions
and preserve them; if the request authorizes completing the partial scaffold,
create only missing folders/files from the bundled templates under the same
operation, leaving every existing file unchanged. Record those exact new paths.
Do not claim that the helper provided an overwrite-safe mode; it has none.

## Initialize and verify

1. Open an operation **before** scaffolding:
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op relink`.
   The fresh-vault exception allows its state directory to exist before the other
   folders. Retain the token and owned-path ledger.
2. With no differing template collisions, run
   `node "<absolute-plugin-root>/scripts/init.mjs"`. If authorized to complete a
   partial scaffold with customized collisions, use the missing-only copy path
   described above **instead of running init**, and preserve every existing file.
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
customized template collisions prevent safe progress, report them without mutation.
