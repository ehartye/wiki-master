---
name: wiki-query
description: Ask a question against the wiki and get a synthesized, cited answer, with the option to file it back as a new page so knowledge compounds. Use whenever the user wants a narrative answer to a question, not just a list of matching pages — for pure retrieval (find what pages exist on a topic, locate a passage) use /wiki-search instead.
argument-hint: <your question>
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Load the `wiki-maintainer` skill and follow its **Query** workflow.

Question: $ARGUMENTS

This skill does two things pure retrieval does not: it **synthesizes** an
answer (not just a list of matching pages) and it can **file that answer
back** into the wiki so the next question benefits from it. Retrieval itself
is `/wiki-search`'s job — load that skill and use it for step 1 below rather
than reimplementing its search-mechanics/health-disclosure logic here.

1. **Search**: load the `wiki-search` skill and run
   `node ../../scripts/search.mjs "..."` (add `--include-raw` if the question
   is plausibly about something recent enough that it may only exist as an
   unprocessed clipping, not yet a wiki/ page). Read the stderr status
   line(s) `wiki-search` describes — **when the tier is not `hybrid`, or a
   raw/ check came back empty, say so in your answer.** A user reading a
   confident synthesis has no way to know the retrieval underneath it was
   degraded or incomplete.
2. Synthesize an answer that **cites** the pages/sources it rests on. A raw/
   hit (if `--include-raw` surfaced one) is unvetted evidence, not yet a
   reviewed claim — cite it as such, not as if it were an established
   wiki/ page.
3. If the answer is substantive and not already captured, offer to file it as a new
   `wiki/syntheses/<slug>.md` page (with provenance), then regenerate the catalog
   (`node ../../scripts/index-gen.mjs`) and write the log entry:
   `node ../../scripts/log-entry.mjs --op query --title "<question>"` (answer summary on stdin).

   **Only if the user accepts**, bracket that write so it becomes a commit rather than
   a working-tree change. Open before creating the page —
   `TOKEN=$(node ../../scripts/op-begin.mjs --op query)` — and close after the log entry:
   `node ../../scripts/op-commit.mjs --op query --title "<question>" --since $TOKEN`.
   A query the user does not file back is read-only; never open an operation for it.
