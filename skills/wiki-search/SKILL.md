---
name: wiki-search
description: Use when asked to find wiki pages or passages, look up a title or alias, search captured evidence, trace provenance, or answer a question from the wiki with citations. Read-only retrieval; original project documentation belongs to wiki-project, diagnostics to wiki-setup, and external discovery or ingestion to wiki-researcher.
---

# Search and answer from the wiki

Find relevant passages and explain what they support. This skill never writes
content, opens an operation, logs, commits or refreshes indexes. A question does
not authorize filing its answer or researching new sources.

## Simple search

1. Resolve the installed plugin root from this `SKILL.md`: two parents above its
   containing skill folder. Resolve the known vault from `WIKI_MASTER_VAULT`,
   default `~/.wiki-master-vault`; `WIKI_MASTER_REQUIRE_VAULT=1` requires an
   explicit vault. Before the first helper, open/read the actual vault `AGENTS.md`
   if present; do not infer its contents from helper output or a host plugin name.
   Use that root, not a recursive profile or whole-vault inventory. No running app
   is required.
2. Replace the placeholder below with the quoted absolute installed root and run
   one bounded query. If changing the vault for a command, restore the prior
   environment afterward; [shell examples](../wiki-maintainer/references/access.md#shell-portability)
   are optional when needed.

   ```sh
   node "<absolute-plugin-root>/scripts/search.mjs" "exact title or useful terms" --json --limit=10
   ```

   The default content scopes are `wiki/` and `moc/`; raw evidence is opt-in.
3. Read stderr status and JSON coverage metadata. Disclose lexical-only search
   and failed channels, including failures inside a hybrid run. Missing/stale
   indexes or zero hits do not establish that the vault knows nothing. A failed
   raw channel means **not searched**, not zero evidence.
4. Open each useful result's exact path under the vault at its matched line and
   read surrounding passages. Verify relevance, page status, review date and
   decision/backlog state. A planned feature or proposed ADR is not shipped.
   Disambiguate similar titles by full path and context instead of guessing.
5. Return useful page paths with line citations and a concise account of what
   the passages support, including missing coverage. For a narrative answer or
   quotation, read the directly linked [cited-answer procedure](references/answers.md)
   and [evidence policy](../wiki-maintainer/references/evidence.md).

**Example.** Request: “Find the Beacon deployment guide.” Action: search
`"Beacon deployment"`, open the matched guide passage and check its title/scope.
Result: “The deployment steps are in `wiki/authored/beacon/guides/deployment.md:24`;
this run used lexical search, so semantic ranking contributed nothing.” Use the
actual path, line and channel result, never the example as evidence.

## Advanced search

Read [advanced retrieval](references/advanced.md) for scoped or multi-query
retrieval, exact-title/alias ambiguity, explicit raw evidence and provenance walks.
For questions spanning claims or sources, also read [cited answers](references/answers.md),
[evidence](../wiki-maintainer/references/evidence.md) and, when relationships matter,
[identity and relationships](../wiki-maintainer/references/efficacy.md).

**Example.** Request: “Does Beacon already support two workers? Include the raw
evidence.” Action: search with `--project=beacon --include-raw --json --limit=10`,
open the architecture and planned backlog passages, resolve their evidence routes,
then check the actual raw text. Result: a cited distinction between deployed and
proposed behavior, with the raw-hit count or an explicit failed-coverage statement.

**Example.** Request: “What do these sources agree on?” Action: run complementary
bounded queries, open the supporting passages and preserve contradictory evidence.
Result: a cited answer separating source claims from the wiki's inference; nothing
is filed by this skill.

## Best practices and handoffs

- Prefer exact titles and equivalent aliases, then useful terms. Use a scope only
  when the request establishes it. Read passages rather than trusting ranking.
- Keep filesystem fallback bounded to `wiki/` and `moc/`; include `raw/clippings/`
  only for requested evidence. Never read, cite or count `.recycle/`, dot folders,
  dependencies or binary originals.
- For a requested diagnosis, use [search diagnostics](../wiki-setup/references/search-diagnostics.md).
  A degraded lookup never authorizes repair or installation.
- For project work listed by lifecycle, use [backlog listing](../wiki-project/references/backlog.md#list-by-lifecycle).
- If writing is explicitly authorized, hand original documentation to
  [wiki-project](../wiki-project/SKILL.md), and provenance-derived synthesis filing
  to [maintainer filing](../wiki-maintainer/references/synthesis-filing.md). Do not
  perform the write from this read-only workflow.
- New external discovery/capture/ingestion requires its own requested scope in
  [wiki-researcher](../wiki-researcher/SKILL.md); a search miss is not authorization.

## Done

The requested lookup or answer has opened supporting passages, usable citations,
honest coverage limits and no vault changes. If nothing supports the claim, say
“not found by these queries” and name the queries; do not invent an answer.
