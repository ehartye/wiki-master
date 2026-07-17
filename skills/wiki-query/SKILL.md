---
name: wiki-query
description: Answer a question against the wiki with citations, and optionally file the answer back so knowledge compounds.
argument-hint: <your question>
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory (the plugin root is the parent of `skills/`). Run each with node **by its absolute path**, resolving `../../scripts/<name>.mjs` against THIS skill's own directory — **do not `cd`** into the skill dir (compound `cd; node` commands get permission-denied under Copilot CLI), and don't rely on `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` (unset under Copilot CLI).

Load the `wiki-maintainer` skill and follow its **Query** workflow.

Question: $ARGUMENTS

1. Search the wiki: `obsidian search query="..." path=wiki limit=10 format=json`
   (PowerShell — see obsidian-cli skill; never default to `search:context`, and
   probe `total` before trusting an empty result). Read the most relevant pages.
2. Synthesize an answer that **cites** the pages/sources it rests on.
3. If the answer is substantive and not already captured, offer to file it as a new
   `wiki/syntheses/<slug>.md` page (with provenance), then regenerate the catalog
   (`node ../../scripts/index-gen.mjs`) and append to `log.md`
   via `obsidian append` only.
