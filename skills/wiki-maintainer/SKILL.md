---
name: wiki-maintainer
description: Use for wiki-master work when reading, answering from, or maintaining the knowledge vault. Defines shared evidence and vault rules; select the task-specific skill for search, authoring, ingest, or maintenance. Ordinary application code work is not a wiki operation unless it uses or updates the vault.
---

# Maintaining the wiki

Read this short core once per session. Obsidian is the wiki's IDE; Markdown is
its portable knowledge store. A failed app connection does not block supported
filesystem work. Load the directly linked references required by your operation,
not every reference for a simple lookup.

## Location and access

The vault is `WIKI_MASTER_VAULT`, default `~/.wiki-master-vault`; its Obsidian
name is `WIKI_MASTER_VAULT_NAME`, default the folder basename. Bundled helpers
resolve this through `scripts/lib/vault.mjs`. Start at this known root; do not
search the disk. Read the vault's own `AGENTS.md` and schema before changing it.

Read [access and host commands](references/access.md) before accessing the vault.
Use quoted absolute helper paths resolved from this installed skill directory
(two parents up is the plugin root), never from the user's current workspace.
Sibling skill names refer to their workflows; load `../<name>/SKILL.md` directly
when the host has no skill loader. Treat `$ARGUMENTS` as the user's request when
not substituted by the host.

## Invariants

1. **Raw bodies are immutable.** Only clipping tools create `raw/` evidence;
   only pipeline tooling updates its frontmatter. Never move raw files to mark
   ingestion state. Never read, cite or count `.recycle/`; only purge owns it.
2. **Claims carry provenance.** Derived pages declare `sources: ["[[...]]"]`
   pointing to exact source/raw paths, and honest `ai-generated` authorship.
   Original `wiki/authored/` work explicitly declares `sources: []`.
3. **Verify against captured evidence.** Clippings outrank paraphrases or memory
   for what the vault holds, not for universal truth. Degraded captures cannot
   establish exact quotes; absence of support is not proof a claim is false.
   Cite answers; disclose contradictions and uncertainty rather than inventing.
4. **Keep three dates distinct.** `updated` means edited; `reviewed` means factual
   claims checked against evidence or current project behavior; index freshness
   means indexed content matches files. Mechanical edits preserve `reviewed`.
5. **Preserve scope and user work.** Reuse existing session authorization. Reads
   do not open operations, log, commit or refresh indexes. Before the first
   authorized write, follow [operation completion](references/operations.md).
   Never stage the whole vault. Purge retains its explicit plan approval.

## Layout and navigation

- `raw/clippings/`: evidence; `wiki/{sources,entities,concepts,syntheses,authored}/`:
  maintained pages; `moc/`: navigational maps; `log/`: one file per operation.
- Wiki frontmatter: `type` (source/entity/concept/synthesis/authored), `created`,
  `updated`, `reviewed`, `status` (stub/draft/maintained), `sources`, `ai-generated`.
- Use `[[wikilinks]]`; `![[embeds]]` are transclusion, not relationship edges.
  Write unwrapped logical lines; never split a wikilink across a line break.
- `index.md`'s generated catalog is derived: regenerate with `index-gen.mjs`;
  never hand-edit its fence or read-modify-write the file. Manual framing outside
  the fence is preserved. Prefer bounded search and relevant MOCs over loading
  the whole generated catalog.
- Treat search diagnostics as evidence about coverage, not relevance. A stale
  index can omit useful pages; read current passages and disclose weaker channels.
  Zero evaluated drift pages cannot establish that the wiki has no drift.

## Load only the relevant policy

| Operation | Direct references to read |
|---|---|
| Source claims, quotes, synthesis, editorial changes | [Evidence and page-type licenses](references/evidence.md) |
| Original project docs, guides, ADRs, backlog | [Canonical placement and living documentation](references/authoring.md) |
| Concepts, relinking, task maps, discovery, factual review | [Identity, relationships and verification](references/efficacy.md) |
| Ingest backlog, lint, structural repairs, migration | [Metrics, repairs and pattern limits](references/maintenance.md) |
| Domain workflow details when needed | [Workflow reference](references/workflows.md) |
| Any vault mutation | [Completion, logging, commits and authorized sync](references/operations.md) |

Run cheap structural checks during substantive maintenance. A clean graph does
not establish factual correctness: sample changed or high-use pages when reviewing
knowledge. Skip an empty vault and avoid a full lint of an unchanged wiki.
