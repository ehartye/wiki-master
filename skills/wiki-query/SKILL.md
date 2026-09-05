---
name: wiki-query
description: Ask a question against the wiki and get a synthesized, cited answer, with the option to file it back as a new page so knowledge compounds. Use whenever the user wants a narrative answer to a question, not just a list of matching pages — for pure retrieval (find what pages exist on a topic, locate a passage) use /wiki-search instead.
argument-hint: <your question>
---

> **Host portability (Claude Code, Copilot CLI, Codex):** Resolve bundled
> `scripts/` and `templates/` paths from this skill's installed directory:
> `../../` is the plugin root. Use quoted absolute paths when running helpers;
> do not resolve them from the current workspace or depend on plugin-root shell
> variables. For sibling skills, read `../<skill-name>/SKILL.md` if the host has
> no skill-loading tool. References such as `/wiki-health` mean that skill's
> workflow; in Codex, select the skill or ask for it by name. Treat `$ARGUMENTS`
> as the user's request when the host does not substitute it.

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
   wiki/ page. To verify a `wiki/` citation actually traces back to real
   evidence (rather than a broken or title-drifted link), pipe it into
   `node ../../scripts/resolve-evidence.mjs` — faster than opening the page
   and reading its `sources:` frontmatter by hand, and it reports a genuine
   gap plainly rather than you assuming the citation is good.
3. If the answer is substantive and not already captured, offer to file it as a new
   `wiki/syntheses/<slug>.md` page (with provenance), then regenerate the catalog
   (`node ../../scripts/index-gen.mjs`) and write the log entry:
   `node ../../scripts/log-entry.mjs --op query --title "<question>"` (answer summary on stdin).

   **Only if the user accepts**, bracket that write so it becomes a commit rather than
   a working-tree change. Open before creating the page —
   `TOKEN=$(node ../../scripts/op-begin.mjs --op query)` — and close after the log entry:
   `node ../../scripts/op-commit.mjs --op query --title "<question>" --since $TOKEN`.
   A query the user does not file back is read-only; never open an operation for it.
