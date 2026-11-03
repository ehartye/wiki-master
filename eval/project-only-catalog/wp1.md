# Project-only catalog refresh: WP1 evidence

Baseline: `3366ab111cb7dc76412a5cbeebd143ff4fe9ab20` (source version 0.89.0).

## TDD: red

Added seven regressions before changing implementation, then ran:

```sh
node --test --test-name-pattern=project-only test/refresh-catalogs.test.mjs test/catalog-dry-run.test.mjs
```

Result: **0 passed, 7 failed, 0 skipped**. The CLI rejected `--project-only` as
unknown; an API request without a project reached graph construction; an
obstructed `index.md` caused `EISDIR` inside `regenerateIndex`, proving the index
phase still ran. Dry-run/default result assertions and nested project output
assertions also failed. The nested fixture uses the existing two-page MOC
threshold and existing single-hyphen nested-project filename convention.

## Implementation: green

The combined helper opts into the parser's new boolean, validates the explicit
project before graph construction, and bypasses `regenerateIndex` entirely.
The API rejects non-boolean `projectOnly` values. The result always includes
`projectOnly`, defaulting to false; project-only CLI runs report the index
omission on stderr. Help explains the requirement. Standalone commands retain
their rejection of this option.

```sh
node --test test/refresh-catalogs.test.mjs test/catalog-dry-run.test.mjs
```

Result: **38 passed, 0 failed, 0 skipped**.

```sh
node --test test/refresh-catalogs.test.mjs test/catalog-dry-run.test.mjs test/catalog-scope.test.mjs test/backlog-gen.test.mjs test/moc-authored-gen.test.mjs test/op-ledger-writers.test.mjs
git diff --check
```

Result: **116 passed, 0 failed, 0 skipped**. Whitespace validation passed.

Verified: one graph build, roadmap-to-MOC snapshot propagation, cross-project
link qualification, absent/default-false output equivalence, exact nested
selection, no eligible output no-op, no global index generation, dry-run/apply
path parity, unchanged dry-run file/folder bytes and times, ownership-ledger and
operation arguments in dry runs without writes, help agreement, and standalone
option rejection. Existing fixture Git line-ending warnings did not fail tests.

WP2 owns deeper staged/untracked ownership, actual scoped publication, repeated
apply ledger assertions, guidance, and full repository/skill verification. This
receipt does not claim a merge, release, or installed-cache update.
