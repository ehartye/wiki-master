---
name: wiki-author
description: Use when asked to write or update wiki project documentation, architecture, a guide, an ADR, or a backlog item, or to check the frontmatter, folder placement and links of the pages an authoring task just wrote. Places original content canonically; captured external sources belong to wiki-ingest, not authoring.
argument-hint: "[what to author, e.g. \"a user guide for acme-scope\"]"
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [authoring](../wiki-maintainer/references/authoring.md), [evidence](../wiki-maintainer/references/evidence.md), [operations](../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

For: $ARGUMENTS

Steps:
1. Identify the project and document kind using the directly linked authoring
   reference. Locate the existing page first; preserve its established filename.
   For a new project, create its `overview.md` before its other documents.
2. Read the existing page and relevant project behavior. Before writing that the
   vault holds no source or page on a topic, run two bounded `search.mjs` queries
   (the topic, and the key terms of the claim) and report "not found by these queries",
   naming them; when a query returns a source page, cite it. Open before writing:
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op relink`.
   Save the token using the PowerShell or POSIX example in the operations reference. Create new files only after opening, never before: a page written first counts as already dirty, and `op-commit` refuses it until you pass `--include`.
3. Use `_templates/authored-note.md`, `_templates/authored-decision.md`, or
   `_templates/authored-backlog-item.md` as appropriate. Set `type: authored`,
   `sources: []`, honest `ai-generated`, and matching `project:`/`kind:` metadata.
   Write ordinary Markdown through exact-path filesystem edits, even when the
   Obsidian app is healthy; never send a whole note body through CLI `content=`.
   A stopped app does not prevent authoring. After an uncertain
   CLI write, inspect the target before retrying.
4. Revise living content in place; never stack dated update paragraphs. Keep
   architecture as-built, roadmaps current, ADR consequences balanced and
   reconstructed decisions labeled. Set `updated`; preserve `reviewed` unless
   factual content or project behavior was actually verified.
5. Validate frontmatter, placement and links of exactly the pages this task wrote.
   Use full-path links when crossing project boundaries:
   `[[wiki/authored/<project>/roadmap.md|<project> roadmap]]`. Write the ledger, a JSON
   array file of the vault-relative paths you created or edited (kept under
   `.wiki-master/` or outside the vault), and run
   `node "<absolute-plugin-root>/scripts/validate-authored.mjs" --paths-file <ledger>`
   with the vault set as in the access reference. Exit 1 means defects: fix, rerun,
   then continue. The ledger format, exit codes, rules and limits are in the
   [authoring reference](../wiki-maintainer/references/authoring.md#validating-what-a-task-wrote).
6. Refresh affected catalogs with `refresh-catalogs.mjs --project <slug> --apply` (one graph
   scan for the project's backlog, MOC and global index). With concurrent writers pass
   `--paths-file <ledger>` to omit their untracked additions. Inspect the returned
   `changed` paths and add the safe catalog paths to the ledger; when the refresh added
   paths, rerun step 5's check. If the result lists `staleCatalogs`, other projects' generated
   catalogs now hold a bare link your pages made ambiguous: refresh each named project too.
7. Complete the shared operations contract: one relink log entry, then
   `node "<absolute-plugin-root>/scripts/op-commit.mjs" --op relink --title "<summary>" --since <saved-token>`.
   Verify the commit and index-refresh notices, push with `wiki-sync.mjs`, and
   verify that the update reached the configured upstream. The authoring request
   includes this completion step unless the user explicitly holds publication;
   do not ask another routine permission question or leave the push to the user.

**Done only when** the requested documentation and affected catalogs are
validated, its log and operation commit are recorded, and remote publication is
verified. Report explicit holds, local-only results and failed sync precisely;
do not call a local commit published.
