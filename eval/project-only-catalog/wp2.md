# Project-only catalog refresh: ownership integration and guidance

Baseline source: `3366ab111cb7dc76412a5cbeebd143ff4fe9ab20`.
WP1 implementation and its independent review preceded this package.

## TDD: baseline red, current implementation green

Added two integration regressions to `test/catalog-scope.test.mjs` and
`test/op-ledger-writers.test.mjs`. To exercise the pre-feature behavior without
reverting the reviewed worktree, copied `scripts/`, `package.json` and those two
test files into an owned temporary directory, then replaced only these source
files with `git show 3366ab1:<path>` output:

- `scripts/refresh-catalogs.mjs`
- `scripts/lib/catalog-options.mjs`
- `scripts/lib/cli-specs.mjs`

Ran in that snapshot:

```sh
node --test --test-name-pattern=project-only test/catalog-scope.test.mjs test/op-ledger-writers.test.mjs
```

Result: **0 passed, 2 failed, 0 skipped**, exit 1. The API planned an unwanted
`index.md` change alongside the three allowed project outputs. The CLI failed
with `refresh-catalogs: Unknown option '--project-only'`. The owned snapshot was
removed afterward; no feature implementation or main checkout was reverted.
An initial fixture assumed the shipped companion already existed with zero
shipped items; the snapshot helper was corrected to represent an absent file
before this retained red run.

The same tests pass against WP1 without another runtime change. Full focused
command:

```sh
node --test test/refresh-catalogs.test.mjs test/catalog-dry-run.test.mjs test/catalog-scope.test.mjs test/backlog-gen.test.mjs test/moc-authored-gen.test.mjs test/op-ledger-writers.test.mjs
```

Result: **118 passed, 0 failed, 0 skipped**, exit 0.

## What the integrations prove

The scope fixture uses real Git commits and foreign staged/untracked pages.
The global index is already dirty with foreign content. A selected roadmap and
MOC already mention excluded pages, and a second project's committed catalogs
hold links made ambiguous by new owned pages. Assertions establish:

- Dry run changes no selected or protected files; dry/apply planned paths and
  diffs agree, including the optional shipped companion.
- The global index and unrelated catalogs retain exact bytes and modification
  times through dry run, apply and repeat. Their timestamps are deliberately
  set in the past so an accidental rewrite cannot hide behind fast execution.
- Committed and owned pages remain visible, unmentioned foreign staged and
  untracked pages stay excluded, and existing excluded-page mentions survive.
- Selected duplicate-name links are qualified; `staleCatalogs` reports the
  unrelated MOC/roadmap without modifying them. The new shipped companion is
  correct, roadmap links remain visible, and repeat apply has no changes.

The publication fixture creates a real local bare remote. It begins an
operation after the foreign index and pages exist, records exact owned pages,
uses the project-only CLI with `--paths-file`, `--since` and `--diff`, and adds
one log. It asserts dry run does not change the ledger, apply records only the
two actual project outputs, and repeat does not even append ledger bytes.
`commitOp` and `syncVault` complete the owned operation. Actual `diff-tree -z`
membership is checked in both local HEAD and the remote commit, not inferred
from returned counts. The remote head and ancestry agree; the token is closed;
the foreign staged page remains staged; foreign files and index keep bytes and
times. The remote contains only the owned pages, project catalogs and log in
the operation commit.

These checks prove the generation and existing visibility boundary. They do not
establish locking, same-file edit isolation or safe merging of foreign hunks.

## Guidance and broader verification

Updated `skills/wiki-project/references/catalogs.md` to use the supported
project-only dry/apply route with the ownership ledger and token. It preserves
clean-owned-target requirements, deferred global refresh, stale-catalog
reporting, and the limits of already-committed page visibility. It distinguishes
the corrected source from installed 0.89.0 and earlier, which lack this flag.
Standalone helpers retain their existing option limits.

`npm.cmd ci` completed successfully. Initial skill verification caught removal
of the standalone helper names from the prose (45 passed, 1 failed); restoring
their names with the option-limit caution corrected that documentation omission.
Then `npm.cmd run test:skills` passed **46/46**, with no failures or skips.
`node scripts/refresh-catalogs.mjs --help` agrees with the documented flag,
required project, dry-run default, ownership and operation options.
`git diff --check` passed.

`npm.cmd test` completed with **2,355 passed, 0 failed, 4 skipped** (2,359 total),
exit 0. The skips are unavailable Xpdf table-mode integration, two file-symlink
fixtures denied by the platform, and an unset private-term dictionary. The
repository's native PDF/render checks otherwise ran in the inherited environment.

This package does not claim a merged delivery, versioned release or installed
cache update. The next package owns final review, CI, publication and cleanup.
