---
name: wiki-ingest
description: Ingest a source (file path, clipping, or URL already clipped to raw/) into the wiki — summarize, cross-reference, index, log.
argument-hint: "[path-or-name of a raw source, or blank to process new clippings]"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Load the `wiki-maintainer` skill and follow its **Ingest** workflow for: $ARGUMENTS

If $ARGUMENTS is empty, find the backlog with the hash-join metric — do **not**
hand-diff clippings against `wiki/sources/`:
`node ../../scripts/health.mjs --backlog` prints just the ingest lines. The
**not ingested (no summary records their hash)** list is the backlog — those are
the clippings to process. If it is `0`, nothing is pending; stop and say so.
(`--backlog` filters the full report; plain `node ../../scripts/health.mjs` shows
the same lines at the bottom. Both default to the `~/.wiki-master-vault` vault.)
Prefer this over `obsidian search query="tag:clippings"`, which re-derives the
answer by fuzzy link-resolution — the exact drift the `source-hashes` join replaces.

For each source:
1. Read it (`obsidian read path=...`). Discuss the key takeaways with the user.
2. Write/update `wiki/sources/<slug>.md`: a summary with `sources: [[<raw link>]]`,
   `type: source`, `ai-generated: true`, and typed `created`/`updated`/`reviewed`.
   Also record `source-hashes: [<sha256>, …]` — the `source-hash` frontmatter value
   of each clipping you summarized (read it from the clipping's frontmatter). This
   is the machine key the ingest-backlog metric joins on — immune to filename and
   citation drift; the `sources: [[…]]` wikilink stays for navigation.
3. Update the entities and concepts it touches; create stubs (`status: stub`) where
   a `[[link]]` has no page yet. Add links in both directions.
4. Regenerate the catalog: `node ../../scripts/index-gen.mjs`
   (never hand-edit index.md's generated fence). Write the log entry by piping the
   narrative to `node ../../scripts/log-entry.mjs --op ingest --title "<title>"`
   (creates `log/<timestamp>-ingest-<slug>.md`; resolved relative to this skill dir).
5. Never edit anything under `raw/`.
