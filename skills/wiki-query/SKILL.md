---
name: wiki-query
description: Use when asked to answer a question using the wiki with citations or synthesize what it knows. For matching page lists or locating a passage use wiki-search; filing an answer requires authorization.
argument-hint: <your question>
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read [access and host commands](../wiki-maintainer/references/access.md) before touching the vault. Also read for this operation: [evidence](../wiki-maintainer/references/evidence.md).
Load the rest only when this run reaches it — [efficacy](../wiki-maintainer/references/efficacy.md) when the question spans topics and you must verify a relationship link; [operations](../wiki-maintainer/references/operations.md) only if filing the answer is authorized — an unfiled answer opens no operation.
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

Question: $ARGUMENTS

This skill does two things pure retrieval does not: it **synthesizes** an
answer (not just a list of matching pages) and it can **file that answer
back** into the wiki so the next question benefits from it. Retrieval itself
is `/wiki-search`'s job — load that skill and use it for step 1 below rather
than reimplementing its search-mechanics/health-disclosure logic here.

1. **Search**: load the `wiki-search` skill and run
   `node "<absolute-plugin-root>/scripts/search.mjs" "..."` (add `--include-raw` if the question
   is plausibly about something recent enough that it may only exist as an
   unprocessed clipping, not yet a wiki/ page). Read the stderr status
   line(s) `wiki-search` describes — **when the tier is not `hybrid`, or a
   raw/ check came back empty, say so in your answer.** A user reading a
   confident synthesis has no way to know the retrieval underneath it was
   degraded or incomplete.
2. Inspect result passages, scope, factual review dates and decision/backlog
   states (`search.mjs --json` exposes these). Read the canonical page, relevant
   alternatives and supporting evidence. A proposed ADR or planned feature is
   not current behavior. For cross-topic questions, follow explained relationship
   links and verify the inferred connection; do not mistake neighbors for evidence.
   Synthesize an answer that **cites** the pages/sources it rests on. A raw/
   hit (if `--include-raw` surfaced one) is unvetted evidence, not yet a
   reviewed claim — cite it as such, not as if it were an established
   wiki/ page. To verify a `wiki/` citation actually traces back to real
   evidence (rather than a broken or title-drifted link), pipe it into
   `node "<absolute-plugin-root>/scripts/resolve-evidence.mjs"` — faster than opening the page
   and reading its `sources:` frontmatter by hand, and it reports a genuine
   gap plainly rather than you assuming the citation is good.
3. If filing is already authorized and the answer adds substantive knowledge,
   write or update the appropriate synthesis with provenance. Otherwise offer to
   file a substantive new answer and wait for acceptance; answering alone is
   read-only. Before creating or editing the page, open a query operation and
   retain the token. Validate citations, regenerate the catalog, log once, close
   the operation, and verify already-authorized sync using the directly linked
   completion contract. Do not open an operation for an answer that is not filed.
