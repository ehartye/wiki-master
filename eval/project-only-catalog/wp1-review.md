# Project-only catalog refresh: independent WP1 review

Result: **PASS**. Reviewer is distinct from the WP1 author and package orchestrators.

Reviewed the saved specification, source/parser/help changes, seven new regression
cases and `wp1.md` red/green evidence. No blocking correctness or scope findings.

The API validates both the project slug and boolean option before graph creation;
the CLI parser rejects a missing project before resolving the vault. Only the
combined helper opts into `--project-only`; standalone commands still reject it.
The conditional bypasses `regenerateIndex` entirely, including dry runs, while
preserving the existing graph, ownership filtering, roadmap/MOC snapshot order,
stale-catalog calculation and changed-path recording. Default behavior remains
index-inclusive, with additive `projectOnly: false` in the result. The omission
notice stays on stderr, preserving machine-readable stdout.

Independent verification:

```sh
node --test test/refresh-catalogs.test.mjs test/catalog-dry-run.test.mjs test/catalog-scope.test.mjs test/backlog-gen.test.mjs test/moc-authored-gen.test.mjs test/op-ledger-writers.test.mjs
node scripts/refresh-catalogs.mjs --help
git diff --check
```

Focused suite: **116 passed, 0 failed, 0 skipped**. Help and whitespace checks
passed. Tests exercise a deliberately obstructed index to establish omission,
pre-scan rejection, default equivalence, exact nested selection, no eligible
output, dry-run byte/time preservation, ledger/diff CLI handling and roadmap
visibility in the generated MOC. Existing Git line-ending warnings were benign.

WP2 remains responsible for the deeper real-Git staged/untracked ownership and
publication fixture, repeated-apply ledger assertions, guidance and broader
verification. This review does not claim those later acceptance cases, a merged
delivery or an installed release update.
