# Project catalogs

`index.md`, every roadmap and every project map are generated inside fences. A generated
fence is overwritten at each refresh, so never hand-edit one; write framing prose outside
it, where it stays.

`node "<absolute-plugin-root>/scripts/refresh-index.mjs"` regenerates every catalog and
the search index for the whole vault. It is the last step of [completion](../../wiki-maintainer/references/operations.md),
once per task, and it rewrites no file that would not change.

Catalogs read what is on disk, so another writer's pages can appear in them before that
writer has finished.
