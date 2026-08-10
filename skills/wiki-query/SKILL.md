---
name: wiki-query
description: Answer a question against the wiki with citations, and optionally file the answer back so knowledge compounds.
argument-hint: <your question>
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Load the `wiki-maintainer` skill and follow its **Query** workflow.

Question: $ARGUMENTS

1. Search the wiki: `node ../../scripts/search.mjs "..."` (resolved relative to this
   skill's own directory). Results are `path:line` — the line is the passage that
   matched, so read from there rather than the top of the page.

   **A status line always prints to stderr. Read it, and tell the user when it is not
   `hybrid`.** Search never fails loudly; it degrades to a working but weaker answer,
   which is why the disclosure exists:
   - `(hybrid · N chunks)` — keyword and chunk-level semantic, RRF-fused. Full strength.
   - `(lexical — <what is off> · run --health)` — Obsidian keyword only. The results are
     still real, but semantic ranking contributed nothing. **Say so in your answer** —
     a user reading a confident synthesis has no way to know the retrieval was degraded.

   To diagnose or fix: `node ../../scripts/search.mjs --health` for the full report,
   `--setup` for the exact remediation commands. The usual causes are Ollama not
   running, the embedding model not pulled, or the index not built
   (`node ../../scripts/index-embed.mjs`).

   **`op-commit` refreshes the index after every bracketed operation**, so anything
   written through an operation is already searchable. What it cannot see is an edit made
   outside one — a hand edit in Obsidian, a `git pull` from another machine. The index is
   chunk-content-hash keyed, so it can be incomplete but never wrong: a stale index misses
   recent edits rather than serving outdated text. `--health` reports how many files have
   changed since the last refresh.
2. Synthesize an answer that **cites** the pages/sources it rests on.
3. If the answer is substantive and not already captured, offer to file it as a new
   `wiki/syntheses/<slug>.md` page (with provenance), then regenerate the catalog
   (`node ../../scripts/index-gen.mjs`) and write the log entry:
   `node ../../scripts/log-entry.mjs --op query --title "<question>"` (answer summary on stdin).

   **Only if the user accepts**, bracket that write so it becomes a commit rather than
   a working-tree change. Open before creating the page —
   `TOKEN=$(node ../../scripts/op-begin.mjs --op query)` — and close after the log entry:
   `node ../../scripts/op-commit.mjs --op query --title "<question>" --since $TOKEN`.
   A query the user does not file back is read-only; never open an operation for it.
