---
description: Answer a question against the wiki with citations, and optionally file the answer back so knowledge compounds.
argument-hint: <your question>
---

Load the `wiki-maintainer` skill and follow its **Query** workflow.

Question: $ARGUMENTS

1. Search the wiki: `obsidian search:context query="..." format=json` (derive good
   query terms from the question). Read the most relevant pages.
2. Synthesize an answer that **cites** the pages/sources it rests on.
3. If the answer is substantive and not already captured, offer to file it as a new
   `wiki/syntheses/<slug>.md` page (with provenance) and update `index.md`/`log.md`.
