# Maintain project catalogs

Generated fences are derived, never hand-edited. Preserve manual framing outside
them. Read [operation completion](../../wiki-maintainer/references/operations.md)
before writes and [validation](../../wiki-setup/references/validation.md) before close.

## Refresh affected catalogs

 For project authoring run `node "<absolute-plugin-root>/scripts/refresh-catalogs.mjs" --project <slug> --apply` instead of three separate generators. It builds one vault graph, updates only that project's backlog and MOC, then the global index; unchanged files are not rewritten. Leave out `--apply` for a dry run: it writes nothing and its `changed` list is the list an apply would change, and `--diff` prints each changed file's removed and added lines to stderr. With concurrent writers, pass `--paths-file <JSON ownership ledger>` so another writer's uncommitted pages stay out: a page is listed when it is in the last commit or the ledger names it, and a page another writer has only staged is not. A line the catalog already has for such a page, put there by that writer's own run, is kept. Inspect the returned `changed` paths; with `--since <token>`, an `--apply` records them in the operation's ledger (a dry run records nothing). Without a project selector it refreshes all projects. Standalone generators remain available and the project generators accept `--project`. A global scan is still needed for cross-project ambiguous names.

## Foreign catalog edits

A global `index.md` already dirty from another writer remains theirs. In the
corrected source, use the combined helper's project-only route for clean, owned
project catalogs:

```sh
node "<absolute-plugin-root>/scripts/refresh-catalogs.mjs" --project <slug> --project-only --paths-file <JSON ownership ledger> --since <token> --diff
```

Inspect the dry run, then add `--apply`. `--project-only` requires an explicit
valid project and omits global-index generation entirely, in both modes. The
result includes `projectOnly: true` and a notice that the global index was not
refreshed. Only the selected project's roadmap, optional `roadmap-shipped.md`
companion and authored MOC can be generated; unchanged files are not rewritten.
The single vault-wide graph still detects ambiguous names, and `staleCatalogs`
reports affected catalogs elsewhere without writing them. With `--since`, only
actual changed generated paths enter the operation ledger. Without `--project-only`,
the existing global-index refresh remains the default.

This is a generation boundary, not a lock or a safe merge of another writer's
edits. Check that the selected roadmap, companion and MOC are clean and owned
before applying. `--paths-file` filters page visibility; it does not isolate
concurrent edits to the same file or hide modifications to already-committed
pages. Coordinate overlapping targets, preserve foreign catalogs, and report
the deferred global refresh. Do not automatically run a global follow-up.

This describes the corrected source, not an installed-release update. Installed
0.89.0 and earlier do not accept `--project-only`; check the installed helper's
`--help` before using it. Those versions still need a separately scoped project
generator/API workflow and an exact ledger when the global index is foreign-dirty.
Standalone `backlog-gen.mjs` and `moc-authored-gen.mjs` do not accept the new flag or the combined helper's
ownership-ledger options; using them unfiltered can include foreign uncommitted
pages. Do not substitute an unscoped standalone apply for this owned-page route.

## Finish the catalog change

Inspect returned changed paths and `staleCatalogs`. A new ambiguous name may
require refreshing another project's catalog; coordinate ownership first. Refresh
once after the content edits, rebuild the operation ledger, and rerun scoped
validation if the path set grew. Log and publish through the same owned operation.
