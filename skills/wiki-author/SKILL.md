---
name: wiki-author
description: Use when asked to write or update wiki project documentation, architecture, a guide, an ADR, or a backlog item. Places original content canonically; captured external sources belong to wiki-ingest, not authoring.
argument-hint: "[what to author, e.g. \"a user guide for sparta-scope\"]"
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [authoring](../wiki-maintainer/references/authoring.md), [evidence](../wiki-maintainer/references/evidence.md), [operations](../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

For: $ARGUMENTS

Steps:
1. Identify the project and document kind using the directly linked authoring
   reference. Locate the existing page first; preserve its established filename.
   For a new project, create its `overview.md` before its other documents.
2. Read the existing page and relevant project behavior. Open before writing:
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op relink`.
   Save the token using the PowerShell or POSIX example in the operations reference.
3. Use `_templates/authored-note.md`, `_templates/authored-decision.md`, or
   `_templates/authored-backlog-item.md` as appropriate. Set `type: authored`,
   `sources: []`, honest `ai-generated`, and matching `project:`/`kind:` metadata.
   Write through the CLI or supported exact-path filesystem fallback. A stopped
   Obsidian app does not prevent ordinary Markdown authoring. After an uncertain
   CLI write, inspect the target before retrying.
4. Revise living content in place; never stack dated update paragraphs. Keep
   architecture as-built, roadmaps current, ADR consequences balanced and
   reconstructed decisions labeled. Set `updated`; preserve `reviewed` unless
   factual content or project behavior was actually verified.
5. Validate frontmatter, placement and links. Use full-path links when crossing
   project boundaries: `[[wiki/authored/<project>/roadmap.md|<project> roadmap]]`.
   Refresh the index catalog; use `moc-authored-gen.mjs --apply` for projects
   with two or more authored pages and `backlog-gen.mjs --apply` for backlog
   changes. Inspect generated changes for unrelated projects.
6. Complete the shared operations contract: one relink log entry, then
   `node "<absolute-plugin-root>/scripts/op-commit.mjs" --op relink --title "<summary>" --since <saved-token>`.
   Verify the commit and index-refresh notices, sync when already authorized,
   and verify the upstream state. Do not ask again for authorized publishing.

**Done only when** the requested documentation and affected catalogs are
validated, its log and operation commit are recorded, and already-authorized sync
is verified. Report local-only, skipped or failed steps precisely; do not call an
uncommitted page published.
