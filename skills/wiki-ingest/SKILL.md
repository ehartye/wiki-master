---
name: wiki-ingest
description: Use when asked to ingest a clipping, compile captured sources, or process the wiki ingest backlog. Summarizes existing raw evidence; use wiki-discover or a clip skill when the source has not been captured.
argument-hint: "[path-or-name of a raw source, or blank to process new clippings]"
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [evidence](../wiki-maintainer/references/evidence.md), [efficacy](../wiki-maintainer/references/efficacy.md), [maintenance](../wiki-maintainer/references/maintenance.md), [operations](../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

If $ARGUMENTS is empty, find the backlog with the hash-join metric — run
`node "<absolute-plugin-root>/scripts/health.mjs" --backlog`. The **not ingested (no summary records
their hash)** list is the backlog; process those clippings. If it is `0`, nothing
is pending — stop and say so. (See the directly linked maintenance reference for
why this beats hand-diffing `tag:clippings` against `wiki/sources/`.)

**Open the operation first:** `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op ingest`
This records what was already uncommitted, so the commit at the end contains your
work and not the user's in-progress writing. Close it in step 6.

Prefer a named clipping set; two concurrent ingests can overwrite shared concept
pages, so coordinate overlapping targets rather than processing the global backlog
in parallel. Update only pages substantively changed by the evidence.

For each source:
1. Read the exact clipping through the guarded CLI or filesystem. Write derived
   Markdown through exact-path filesystem edits, never a whole CLI `content=` payload. Discuss
   the key takeaways with the user.
2. Write/update `wiki/sources/<slug>.md`: a summary with `sources: ["[[<raw link>]]"]`,
   `type: source`, `ai-generated: true`, and typed `created`/`updated`/`reviewed`.
   **Always quote each wikilink inside the list — `sources: ["[[A]]", "[[B]]"]`,
   never a bare `sources: [[A]]` or an unquoted block list (`- [[A]]`).** Both
   unquoted shapes look correct and Obsidian still renders the links, but neither
   is valid YAML: `[[A]]` is flow-sequence syntax one level too many and silently
   parses into a nested list instead of a string, which is exactly the "type
   mismatch, expected list" defect `node "<absolute-plugin-root>/scripts/repair-inline-sources.mjs"`
   exists to repair in bulk. Quoting is what makes it an unambiguous string.
   **Cite the clipping by its actual filesystem path — `sources: ["[[raw/clippings/<exact filename>.md]]"]` — copied from the path you just read, never retyped from
   the source's title.** The clipper slugifies a title into a filename (`/`, `:`,
   `#`, `*`, `?`, quotes and brackets all become `-`, then a 120-char cap), so any
   title carrying one of those characters or running long does NOT name its own
   file. Citing the remembered title produces a link to a file that does not exist:
   the page becomes a `provenanceGap` and its clipping reads as unparsed, even
   though the ingest itself was correct. List the resolved vault's exact `raw/clippings/` directory or reuse the path
   from step 1 rather than reconstructing it.
   Also record `source-hashes: [<sha256>, …]` — the `source-hash` frontmatter value
   of each clipping you summarized (read it from the clipping's frontmatter). This
   is the machine key the ingest-backlog metric joins on — immune to filename and
   citation drift; the `sources: ["[[…]]"]` wikilink stays for navigation.
   To repair vaults that already drifted this way:
   `node "<absolute-plugin-root>/scripts/repair-provenance-links.mjs"` (dry run) then `--apply`.
3. Before creating a concept, search the proposed title, equivalent wording and
   nearby passages. Extend the canonical page, add a genuinely equivalent alias,
   or explain the new concept's distinct scope. Use `_templates/concept-note.md`;
   follow the directly linked efficacy reference for aliases and relationships.
   Create a stub (`status: stub`) only for an identified gap. Explain each useful
   connection under `## Relationships`; keep supporting citations in `sources:`
   and the relevant prose. Relatedness does not establish support. Update the
   task map the new knowledge helps answer. Preserve `reviewed` on pages that
   received only metadata/link edits; stamp it only after factual verification.
4. Regenerate the catalog: `node "<absolute-plugin-root>/scripts/index-gen.mjs"`
   (never hand-edit index.md's generated fence). Write the log entry by piping the
   narrative to `node "<absolute-plugin-root>/scripts/log-entry.mjs" --op ingest --title "<title>"`
   (creates `log/<timestamp>-ingest-<slug>.md` in the resolved vault).
5. Never edit anything under `raw/`.
6. **Close the operation:**
   `node "<absolute-plugin-root>/scripts/op-commit.mjs" --op ingest --title "<what you ingested>" --since <saved-token>`
   Commits exactly the pages this ingest touched, as one revertable unit, and
   reports anything it deliberately left alone. Then follow the shared completion contract for already-authorized sync and verify its result.
