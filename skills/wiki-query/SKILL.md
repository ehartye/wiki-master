---
name: wiki-query
description: Answer a question against the wiki with citations, and optionally file the answer back so knowledge compounds.
argument-hint: <your question>
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Load the `wiki-maintainer` skill and follow its **Query** workflow.

Question: $ARGUMENTS

1. Search the wiki: `node ../../scripts/search.mjs "..."` (resolved relative to this
   skill's own directory). Prints which tier answered (`qmd`/`hybrid`/`keyword`) on
   the first line, then ranked paths — mention the tier if it's `keyword` (Ollama/qmd
   unavailable, results are keyword-only, same as `obsidian search` alone). Read the
   most relevant pages returned.
2. Synthesize an answer that **cites** the pages/sources it rests on.
3. If the answer is substantive and not already captured, offer to file it as a new
   `wiki/syntheses/<slug>.md` page (with provenance), then regenerate the catalog
   (`node ../../scripts/index-gen.mjs`) and write the log entry:
   `node ../../scripts/log-entry.mjs --op query --title "<question>"` (answer summary on stdin).
