# Maintain project catalogs

Generated fences are derived, never hand-edited. Preserve manual framing outside
them. Read [operation completion](../../wiki-maintainer/references/operations.md)
before writes and [validation](../../wiki-setup/references/validation.md) before close.

## Refresh affected catalogs

 For project authoring run `node "<absolute-plugin-root>/scripts/refresh-catalogs.mjs" --project <slug> --apply` instead of three separate generators. It builds one vault graph, updates only that project's backlog and MOC, then the global index; unchanged files are not rewritten. Leave out `--apply` for a dry run: it writes nothing and its `changed` list is the list an apply would change, and `--diff` prints each changed file's removed and added lines to stderr. With concurrent writers, pass `--paths-file <JSON ownership ledger>` so another writer's uncommitted pages stay out: a page is listed when it is in the last commit or the ledger names it, and a page another writer has only staged is not. A line the catalog already has for such a page, put there by that writer's own run, is kept. Inspect the returned `changed` paths; with `--since <token>`, an `--apply` records them in the operation's ledger (a dry run records nothing). Without a project selector it refreshes all projects. Standalone generators remain available and the project generators accept `--project`. A global scan is still needed for cross-project ambiguous names.

## Foreign catalog edits

A global `index.md` already dirty from another writer remains theirs. Do not run
the combined apply in that state: it also writes the global index. Use the
standalone project generators `backlog-gen.mjs --project <slug> --apply` and
`moc-gen.mjs --project <slug> --apply` only for clean, owned targets, record their
actual changed paths in the ledger, and report deferred global refresh. Do not
adopt a foreign catalog to finish your operation. Check each helper's supported
ledger/operation options before using them; do not invent a project-only flag
for the combined helper. Coordinate any overlapping generated target.

## Finish the catalog change

Inspect returned changed paths and `staleCatalogs`. A new ambiguous name may
require refreshing another project's catalog; coordinate ownership first. Refresh
once after the content edits, rebuild the operation ledger, and rerun scoped
validation if the path set grew. Log and publish through the same owned operation.
