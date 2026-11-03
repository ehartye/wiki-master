Re-running initialization could overwrite customized files under `_templates/`.
The initializer now exclusively creates missing scaffold files, preserves existing
bytes and modification times, and reports created, preserved and differing paths.
It rejects links and type conflicts and reports partial creation on I/O failure.

Setup guidance explains the corrected source behavior and retains the workaround
for 0.89.0 and earlier. No release or installed-cache update is included.

Validation:

- Preservation and ancestor-alias regressions were observed failing before fixes.
- Focused initialization suite: 20 passed, 2 file-symlink permission skips.
- Skill suite: 46 passed.
- Full suite: 2,323 passed, 4 skipped, no failures. Skips cover unavailable table
  mode, two file-symlink permissions, and an unconfigured private-term dictionary.
- Disposable CLI/help checks and whitespace validation passed.
- Independent WP1 review passed after correcting the ancestor-alias boundary.

Detailed sanitized evidence is in `eval/init-preservation/`. Partial newly created
files remain on failure and are preserved on retry; the report and guidance make
that recovery limit explicit.
