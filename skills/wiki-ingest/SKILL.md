---
name: wiki-ingest
description: Ingest a source (file path, clipping, or URL already clipped to raw/) into the wiki — summarize, cross-reference, index, log.
argument-hint: "[path-or-name of a raw source, or blank to process new clippings]"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Load the `wiki-maintainer` skill and follow its **Ingest** workflow for: $ARGUMENTS

If $ARGUMENTS is empty, find the backlog with the hash-join metric — run
`node ../../scripts/health.mjs --backlog`. The **not ingested (no summary records
their hash)** list is the backlog; process those clippings. If it is `0`, nothing
is pending — stop and say so. (See wiki-maintainer's "Has this been ingested?" for
why this beats hand-diffing `tag:clippings` against `wiki/sources/`.)

For each source:
1. Read it (`obsidian read path=...`). Discuss the key takeaways with the user.
2. Write/update `wiki/sources/<slug>.md`: a summary with `sources: [[<raw link>]]`,
   `type: source`, `ai-generated: true`, and typed `created`/`updated`/`reviewed`.
   **Cite the clipping by its actual filesystem path — `sources: [[raw/clippings/
   <exact filename>.md]]` — copied from the path you just read, never retyped from
   the source's title.** The clipper slugifies a title into a filename (`/`, `:`,
   `#`, `*`, `?`, quotes and brackets all become `-`, then a 120-char cap), so any
   title carrying one of those characters or running long does NOT name its own
   file. Citing the remembered title produces a link to a file that does not exist:
   the page becomes a `provenanceGap` and its clipping reads as unparsed, even
   though the ingest itself was correct. Run `ls raw/clippings/` or reuse the path
   from step 1 rather than reconstructing it.
   Also record `source-hashes: [<sha256>, …]` — the `source-hash` frontmatter value
   of each clipping you summarized (read it from the clipping's frontmatter). This
   is the machine key the ingest-backlog metric joins on — immune to filename and
   citation drift; the `sources: [[…]]` wikilink stays for navigation.
   To repair vaults that already drifted this way:
   `node ../../scripts/repair-provenance-links.mjs` (dry run) then `--apply`.
3. Update the entities and concepts it touches; create stubs (`status: stub`) where
   a `[[link]]` has no page yet. Add links in both directions.
4. Regenerate the catalog: `node ../../scripts/index-gen.mjs`
   (never hand-edit index.md's generated fence). Write the log entry by piping the
   narrative to `node ../../scripts/log-entry.mjs --op ingest --title "<title>"`
   (creates `log/<timestamp>-ingest-<slug>.md`; resolved relative to this skill dir).
5. Never edit anything under `raw/`.
