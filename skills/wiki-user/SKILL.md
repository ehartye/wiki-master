---
name: wiki-user
description: Find wiki pages or passages, answer questions from the wiki with citations, write or update original wiki project documentation, guides, ADRs and backlog items, or perform a requested Obsidian app action. Ordinary application work does not activate wiki operations; discovering external sources and ingesting clippings belong to wiki-researcher.
---

# Using the wiki

Choose the mode from the user's request and load only its references. Treat
`$ARGUMENTS` as that request when the host has not substituted it.

- **Find pages or passages:** read [search](references/search.md). This is the
  complete ordinary lookup startup path; no maintenance preamble is needed.
- **Answer with citations:** read [query](references/query.md),
  [search](references/search.md), and the shared
  [evidence policy](../wiki-maintainer/references/evidence.md).
- **Write original wiki documentation or validate what this authoring task wrote:**
  read [authoring](references/authoring.md),
  [access](../wiki-maintainer/references/access.md),
  [evidence](../wiki-maintainer/references/evidence.md), and
  [operation completion](../wiki-maintainer/references/operations.md).
- **Perform a requested native app action:** read
  [Obsidian commands](../wiki-maintainer/references/obsidian-cli.md) and
  [access](../wiki-maintainer/references/access.md). Ordinary Markdown edits use
  exact-path filesystem access; an unavailable app does not block them.

Retrieval and unfiled answers are read-only: no operations, logs, commits or index
refreshes. Answering does not authorize filing an answer. Before any authorized
vault mutation, read [operation completion](../wiki-maintainer/references/operations.md)
and finish its scoped validation, commit, sync and remote verification unless the
user holds publication. Preserve foreign edits and immutable raw evidence.

For an answer that needs source discovery or captured-source ingestion, route to
[wiki-researcher](../wiki-researcher/SKILL.md) in the requested mode; a search miss
alone does not authorize either operation.
