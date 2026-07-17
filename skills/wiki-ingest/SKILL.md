---
name: wiki-ingest
description: Ingest a source (file path, clipping, or URL already clipped to raw/) into the wiki — summarize, cross-reference, index, log.
argument-hint: [path-or-name of a raw source, or blank to process new clippings]
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory (the plugin root is the parent of `skills/`). Run each with node **by its absolute path**, resolving `../../scripts/<name>.mjs` against THIS skill's own directory — **do not `cd`** into the skill dir (compound `cd; node` commands get permission-denied under Copilot CLI), and don't rely on `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` (unset under Copilot CLI).

Load the `wiki-maintainer` skill and follow its **Ingest** workflow for: $ARGUMENTS

If $ARGUMENTS is empty, find unprocessed clippings:
`obsidian search query="tag:clippings" format=json` and process any not yet
summarized in `wiki/sources/`.

For each source:
1. Read it (`obsidian read path=...`). Discuss the key takeaways with the user.
2. Write/update `wiki/sources/<slug>.md`: a summary with `sources: [[<raw link>]]`,
   `type: source`, `ai-generated: true`, and typed `created`/`updated`/`reviewed`.
3. Update the entities and concepts it touches; create stubs (`status: stub`) where
   a `[[link]]` has no page yet. Add links in both directions.
4. Regenerate the catalog: `node ../../scripts/index-gen.mjs`
   (never hand-edit index.md's generated fence). Append
   `## [YYYY-MM-DD] ingest | <title>` to `log.md` via `obsidian append` only.
5. Never edit anything under `raw/`.
