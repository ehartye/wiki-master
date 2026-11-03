When a vault's global index contains another writer's edits, the combined
catalog helper currently cannot refresh only an owned project's navigation.
Add `--project-only` with a required explicit project to omit global-index
generation in both dry runs and applies. The API exposes `projectOnly: false`
by default; default generation, one-graph scoping, ambiguity reporting, diffs
and operation-ledger recording remain intact.

Guidance now uses the supported project-only route and retains clean-owned-target
requirements. This does not add locking or same-file isolation. Installed 0.89.0
and earlier still require their older scoped workflow; no release or cache update
is included.

Validation:

- Meaningful red regressions: WP1 7 failures; WP2 isolated baseline 2 failures.
- Focused catalog suite: 118 passed, no failures or skips.
- Skill suite: 46 passed, no failures or skips.
- Full repository suite: 2,355 passed, no failures, 4 skips (table-mode native
  dependency, two file-symlink permissions, and unset private-term dictionary).
- Real Git/bare-remote integration inspects exact local/remote commit membership,
  publication ancestry, preserved foreign staged/untracked state and index/catalog
  bytes and times. Repeated apply adds no writes or ledger bytes.
- Help and whitespace checks passed. Independent package reviews are retained in
  `eval/project-only-catalog/`; final delivery review and CI follow before merge.
