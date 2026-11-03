# Initialization guidance and integration: WP2

The setup initialization reference now describes the corrected source behavior:
exclusive creation, preserved bytes and modification times, deterministic
path-only reports, obstruction failures and retained partial creations. It
explicitly states that retries preserve existing partial files. The 0.89.0 and
earlier workaround remains, with no claim that this source change updates an
installed cache or has a released version.

This package changed documentation only. Its verification was factual execution,
not new tests that mirror prose. WP1's red/green regressions remain in `wp1.md`.

## Verification

All commands ran from the feature worktree:

| Command | Result |
|---|---|
| `npm.cmd ci` | Exit 0; 22 packages installed; audit reported zero vulnerabilities. |
| `node --test test/init.test.mjs test/init-git-ownership.test.mjs` | Exit 0; 22 tests, 20 passed, 2 skipped. |
| `npm.cmd run test:skills` | Exit 0; 46 passed, no failures or skips. |
| `npm.cmd test` | Exit 0; 2,327 tests, 2,323 passed, 4 skipped, no failures or cancellations; about 93 seconds. |
| `git diff --check` | Exit 0. |

Full-suite skips were the table-row integration case because the selected text
extractor lacked `-table`, the two file-symlink cases because creation permission
was unavailable, and the private-term dictionary check because no dictionary was
configured. Directory-junction, linked-root and ancestor-alias cases passed. These
results do not claim native table-mode integration or private-dictionary coverage.

An additional disposable CLI fixture pre-created a customized
`_templates/authored-note.md`, ran `node scripts/init.mjs` with an explicit
temporary vault, and asserted exit zero, unchanged custom bytes and mtime,
`preserved:` and `differing:` path lines, and absence of the private fixture text
from output. A second invocation created no files. `node scripts/init.mjs --help`
exited zero and advertised the same reports and link/type-conflict errors. The
fixture was cleaned up. WP1 also verifies nonzero obstruction handling.

Only this sanitized receipt is retained in the repository; raw console logs
include environment-dependent paths and were kept outside it. No source release,
marketplace publication, installed-cache update, commit or push occurred in WP2.
