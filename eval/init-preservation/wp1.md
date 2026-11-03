# Safe scaffold: WP1 regression evidence

Baseline: `ce8ec71473b140672054e0510510fb3e745982d0` (0.89.0).

## TDD: red

Before changing the initializer, ran:

```sh
node --test --test-name-pattern="preserves customized" test/init.test.mjs
```

Result: **0 passed, 1 failed**. The assertion comparing bytes and modification
times showed `_templates/nested/b.md` changed from the customized fixture text
to the distributed text and its modification time changed. This is the expected
baseline defect, independent of any newly introduced report fields.

The first complete baseline run terminated its init test process with native
exit code 3221226505 on Windows; it did not provide per-case results. The isolated
overwrite regression above supplied the clear red result. The existing two Git
ownership tests passed in that baseline run.

## Implementation: green

```sh
node --test test/init.test.mjs test/init-git-ownership.test.mjs
git diff --check
```

Result: **18 passed, 0 failed, 2 skipped** (20 tests total). The two real file-link
fixtures skipped because the platform denied file-symlink creation with EPERM.
Both real directory-junction fixtures and the linked-vault-root fixture passed.
Whitespace validation passed.

Verified behaviors:

- Root, customized, identical, nested and user-only content and times survive;
  missing distributed nested files are added, and repeat execution creates none.
- Root and template destination races are injected at exclusive open: competing
  bytes survive and are reported as preserved.
- File/directory conflicts and source/destination directory links are reported
  as obstructions, without following or replacing them.
- An injected partial write leaves its partial file and reports it separately;
  successful creations remain, and retry adds missing files without replacing
  the partial existing file.
- CLI success reports paths without private contents; obstruction exits 1,
  identifies the blocked path and discloses retained creations. Help agrees.
- New scaffolds copy distributed fixture bytes and do not create a Git repository.

This package does not establish full-suite success, a merged delivery or an
installed-release update. WP2 owns broader verification and guidance.

## Review correction: ancestor aliases

The first independent review found that checking ancestors above the supplied
roots rejected normal vaults beneath platform directory aliases. Added and ran
this regression before correcting the implementation:

```sh
node --test --test-name-pattern="ordinary vault and source roots under a parent alias" test/init.test.mjs
```

Red result: **0 passed, 1 failed** with `Scaffold incomplete`, no created files,
and obstruction errors. The fixture supplies ordinary vault and source roots
beneath a junction alias, representing the same boundary as a macOS `/var` alias.

Directory checks now stop at the supplied vault or source root, checking that
root and its descendants while allowing platform aliases above it. Creating a
missing vault beneath an ancestor alias is also covered. Linked vault and source
roots remain rejected, as do descendant links.

Reran the focused two-file command: **20 passed, 0 failed, 2 skipped** (22 tests).
The skips remain real file-symlink fixtures denied by platform permissions.
Ancestor-alias, linked-root and descendant-junction checks all executed and
passed. `git diff --check` passed. A fresh review is still required.
