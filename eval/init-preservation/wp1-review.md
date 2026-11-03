# WP1 independent review

Reviewer: `init_wp1_review`, distinct from the implementing agent and orchestrator.
Status: **changes required**.

## Confirmed finding

**High — ancestor link checks reject ordinary vaults beneath OS directory aliases.**
`scripts/init.mjs` recursively checks every absolute ancestor in `directory()`,
including ancestors outside the supplied vault/template roots. A vault that is
itself an ordinary directory fails when a parent is a symlink or directory
junction. This breaks the established macOS temporary-directory route, whose
alias handling is already explicit in `scripts/lib/vault.mjs`.

Independent disposable fixture: create an ordinary directory containing `vault`,
create a junction alias to its parent, then call `scaffold(alias/vault, templates)`.
`lstat(vault).isSymbolicLink()` was false. Actual result was `Scaffold incomplete;
existing content was preserved.`, first error `.gitignore` / `OBSTRUCTION` /
`directory missing, linked or obstructed`, with `created: []`.

Fix the root trust boundary so existing platform aliases above the supplied roots
can resolve without admitting links at the root or within the scaffold tree.
Add a meaningful regression for an ordinary vault/source under an ancestor alias,
while retaining rejection of linked roots and links within both trees. Re-run
focused verification, followed by a fresh independent review.

## Verification and other observations

- `node --test test/init.test.mjs test/init-git-ownership.test.mjs`: 20 tests,
  18 passed, 0 failed, 2 skipped because file-symlink creation requires permission.
  Directory junction rejection and linked-root rejection executed successfully.
- `git diff --check`: passed.
- Inspected the saved spec, source diff, both focused test files and red/green
  evidence. Exclusive `wx` opens preserve competing destination creation; existing
  file bytes/times, deterministic path reporting, type conflicts and partial
  write disclosure have focused coverage.
- Partial files remain ordinary existing files on retry and are preserved. The
  report discloses this limit rather than claiming retry repairs them.
- No source edits, commits or wiki writes were performed by this review. Full
  repository/skill integration and delivery remain later package gates.
