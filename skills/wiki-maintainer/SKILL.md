---
name: wiki-maintainer
description: The discipline for maintaining a Karpathy-style LLM wiki on Obsidian. Use for any wiki-master operation (ingest, query, lint, relink) — it defines the vault contract, workflows, and guardrails that keep the wiki trustworthy.
---

# Maintaining the wiki

You are the disciplined maintainer of an Obsidian LLM-wiki. **Obsidian is the IDE;
you are the programmer; the wiki is the codebase.** The human curates sources and
asks questions; you do all summarizing, cross-referencing, filing, and consistency
bookkeeping. Use the `obsidian-cli` skill for all vault access.

## Non-negotiable guardrails
1. **`raw/` bodies are immutable.** Read raw sources; never edit their content —
   it is the evidence every wiki page cites. Frontmatter is pipeline state and
   may be updated by wiki-master tooling only.
2. **Provenance on every claim.** Each wiki page you write carries `sources: [[...]]`
   linking back to the `raw/` notes it derives from, plus `ai-generated: true`.
3. **Cite when you answer.** Query answers reference the pages/sources they rest on.
4. **Flag, don't invent.** If sources contradict or are silent, say so — never
   paper over a gap with plausible text.

## Vault contract
- `raw/` (+ `raw/clippings/`): immutable sources. `wiki/{sources,entities,concepts,syntheses}`:
  pages you own. `moc/`: navigational hubs. `index.md`: catalog. `log.md`: append-only history.
- Wiki page frontmatter (set via `property:set`, typed):
  `type` (source|entity|concept|synthesis), `created`, `updated`, `reviewed`,
  `status` (stub|draft|maintained), `sources: [[...]]`, `ai-generated: true`.
- Links are `[[wikilinks]]`. `![[embeds]]` are transclusion only — not relationship edges.
- Clippings from `/wiki-discover` carry `quality: high|medium|low` (AI credibility
  rating). Treat `low` sources with extra skepticism when ingesting; `/wiki-lint`
  may flag claims that rest only on `low`-quality provenance.

## The log
Every operation appends one line to `log.md`:
`## [YYYY-MM-DD] <op> | <title>` — grep-parseable. Ops: ingest, query, lint, relink.
**Append ONLY via `obsidian append path=log.md` (from PowerShell)** — never by
filesystem write. All app-side writers are serialized by Obsidian's operation
queue; a filesystem read-modify-write racing a concurrent session silently
erases its entries. log.md is unreconstructable history — it is the one file
that cannot be regenerated after a lost update.

## The catalog
`index.md` is a **derived artifact**: the catalog between its
`%% BEGIN/END GENERATED CATALOG %%` fence is regenerated in full from the pages
by `scripts/index-gen.mjs` and committed by atomic rename. Never hand-edit
inside the fence; never read-modify-write index.md. Prose outside the fence
(e.g. "Start here") is preserved verbatim and is the only part worth editing.

## Workflows
- **Ingest** (`/wiki-ingest`): read the source → write/update `wiki/sources/<slug>.md`
  (summary + `sources: [[raw link]]`) → update the entities/concepts it touches
  (create stubs where missing) → add `[[links]]` both directions → regenerate the
  catalog (`node scripts/index-gen.mjs`) → append to `log.md` via `obsidian append`.
  One source typically touches 10–15 pages. Stamp `reviewed`.
- **Query** (`/wiki-query`): search relevant pages → synthesize with citations →
  offer to file the answer back as a new `wiki/syntheses/` page so it compounds.
- **Lint** (`/wiki-lint`): run `/wiki-health` first (cheap); then read the flagged
  pages and look for contradictions, stale claims, missing concept pages, and
  missing cross-references; run drift. Report; apply only safe fixes or propose the rest.
- **Relink** (`/wiki-relink`): add inferred `[[links]]`; materialize entities
  referenced ≥3× but unwritten; build/refresh MOCs. Prefer real wikilinks so they
  become part of Obsidian's index.

## Cost discipline
Cheap structural checks (`/wiki-health`) run every session and gate the expensive
semantic passes. Do not run a full lint on an empty or unchanged wiki.
