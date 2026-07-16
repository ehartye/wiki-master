---
description: Answer a question against the wiki with citations, and optionally file the answer back so knowledge compounds.
argument-hint: <your question>
---

Load the `wiki-maintainer` skill and follow its **Query** workflow.

Question: $ARGUMENTS

1. Search the wiki: `obsidian search query="..." path=wiki limit=10 format=json`
   (PowerShell — see obsidian-cli skill; never default to `search:context`, and
   probe `total` before trusting an empty result). Read the most relevant pages.
2. Synthesize an answer that **cites** the pages/sources it rests on.
3. If the answer is substantive and not already captured, offer to file it as a new
   `wiki/syntheses/<slug>.md` page (with provenance), then regenerate the catalog
   (`node ${CLAUDE_PLUGIN_ROOT}/scripts/index-gen.mjs`) and append to `log.md`
   via `obsidian append` only.
