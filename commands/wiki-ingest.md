---
description: Ingest a source (file path, clipping, or URL already clipped to raw/) into the wiki — summarize, cross-reference, index, log.
argument-hint: [path-or-name of a raw source, or blank to process new clippings]
---

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
4. Update `index.md` and append `## [YYYY-MM-DD] ingest | <title>` to `log.md`.
5. Never edit anything under `raw/`.
