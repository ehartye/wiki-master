Read directly for this task: [access](../../wiki-maintainer/references/access.md), [evidence](../../wiki-maintainer/references/evidence.md), [efficacy](../../wiki-maintainer/references/efficacy.md), [completion](../../wiki-maintainer/references/operations.md).
Reuse existing session authorization for the first write.

# Discover sources on a topic

Given a topic, find and independently assess sources that fill an evidence gap.
Perspective passes return candidates and never write the vault. A candidates-only
request stays read-only: report the selection without declines or captures. When
capture is within scope, use [capture and completion](capture.md#capture-the-selected-sources).
Ingestion is a separate authorized mode.

## Independence checkpoint before capture

Topic discovery requires the five perspective passes below and independent
selection. When the host provides delegation, actually dispatch read-only
finders; do not replace their execution with a list you found and scored yourself.
The orchestrator may select their returned candidates, or a separate reviewer
may select them. A finder must not grade its own finds. A small or controlled
source corpus does not remove this separation.

Before calling a clipper, retain the returned candidate
lists and the independent selection with its credibility reasons. If delegation
is unavailable, use the documented sequential lenses and disclose that limit;
do not claim an independent pass that did not run. Named-source capture skips
topic discovery and uses [capture](capture.md) directly.

## Phase 0 — check the browser, then dedup before searching
Before a batch that will clip pages, run `node "<absolute-plugin-root>/scripts/doctor.mjs"`
(read-only) and read its `clip` line. `clip.mjs` needs `playwright-core` and Chrome
or Edge to read a JavaScript page. Without them it queues those pages for triage
instead of clipping them, and doctor still exits 0 because both are optional. Tell
the user what is missing before the batch; installing it is their decision.

Gather what the wiki already has so the search hunts for *gaps*, not dupes:
- Known source URLs: `node "<absolute-plugin-root>/scripts/known-urls.mjs"` prints
  them, one per line, normalized as the clipper normalizes them (`--count` prints
  the number). It reads the clippings themselves (the first `source:` line of each
  file directly under `raw/clippings`), rather than querying an index built from
  them — the shortest path to the fact, and it stays correct while the index is
  stale. To ask about particular candidates, use
  `node "<absolute-plugin-root>/scripts/known-urls.mjs" --check "<url>" "<url>"`: one line
  per URL, in the order given, `new`, `clipped raw/clippings/<name>.md` (with
  ` (+N recapture)` when later captures of the page exist) or `declined: <reason>`.
  `--summary --topic "<topic>"` prints what a topic already holds. All three only read.
- Coverage summary: name the unanswered question, run bounded wiki searches, and
  read the relevant task MOC and leading concept/synthesis pages. Read only the
  manual Start here section of `index.md` if orientation is needed; do not load
  the generated catalog. List the known coverage and the specific evidence gap.
- Sanity-check the set: if the vault has clippings on disk but the known-URL
  set is empty, STOP — the collection step failed; do not proceed to search.
Pass the known-URL set + a one-line "already covered" summary to every perspective.

## Phase 1 — five perspective researchers (parallel if supported, else sequential)
Each perspective gets: the topic, the known-URL set, the coverage summary, and its
lens. Run them **in parallel if your host supports agent fan-out** — Claude Code:
dispatch five read-only agents in one message via the Agent tool; Copilot CLI: use
custom agents — **otherwise run the five lenses sequentially yourself.** Each runs
2–3 *varied* web searches, pre-skips any result whose domain is on the blocklist,
fetches the promising hits, and **returns a ranked candidate list** — it writes
nothing. Lenses:
- **Academic** — papers, textbooks, primary research, .edu.
- **Technical** — official docs, specs, standards, source repos.
- **Applied** — case studies, real-world usage, tutorials from practitioners.
- **News/Trends** — recent developments, reputable reporting (last ~2 years).
- **Contrarian** — critiques, failure modes, dissenting analysis.

Each candidate: `{ title, url, quality_guess: high|medium|low, key_findings,
why_ingest, adds_evidence, changes_page }`. `adds_evidence` names the unanswered
question it helps settle; `changes_page` names an existing or proposed concept
or synthesis. More material on an already answered question is not automatically
an improvement. Inspect existing high-use stubs and missing bridges before
requesting another broad collection run.

## Phase 2 — independent select + credibility (do NOT let a finder grade itself)
As the orchestrator (or a separate reviewer), over the pooled candidates:
1. Dedup by URL (normalize: drop `#fragment`, trailing `/`); drop any already in the
   known-URL set; drop blocked domains; drop any in the decline log
   (`.wiki-master/declined.json` — clip.mjs enforces this too, but skipping here
   saves re-arguing settled candidates).
2. Score each survivor with the rubric → `high | medium | low`:
   - +2 peer-reviewed / primary / official
   - +1 recent (≤3 yr) where recency matters
   - +1 known/credentialed author or authoritative org
   - +1 corroborated by another perspective's find (max +1)
   - −1 vendor-primary / promotional / single-blogger opinion
   Tiers: **high** ≥4, **medium** 2–3, **low** 0–1, **reject** <0 (don't clip).
3. Keep the top sources (favor `high`/`medium`; a few `low` are fine if on-topic).
   Reddit posts/comments and Medium articles are eligible; assess each source
   using the rubric, without treating votes as credibility. In the ranked report,
   group them under `## Reddit discussion (anecdotal)` and `## Medium articles`
   respectively, and carry those sections into ingestion per the
   [Reddit and Medium evidence policy](../../wiki-maintainer/references/evidence.md#reddit-and-medium).
4. **Only when capture is authorized, record every reject** so it is never re-litigated:
   `node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --decline="<one-line reason>"`.
   "Seen, considered, declined" must have a representation — an unrecorded reject
   is indistinguishable from "never seen" and comes back every run. Declines
   expire after 180 days (TTL), so a changed world gets one re-evaluation.
   `node "<absolute-plugin-root>/scripts/decline.mjs" list` (`--json` for a machine reading)
   and `show "<url>"` read the log without changing it. `supersede "<url>" --reason "<why>"`
   ends an active decline without clipping anything; it is the only way to do so for a URL
   already in the vault, because `--supersede-decline` on a clip takes effect only when a
   clipping is written.


Continue with [capture and completion](capture.md#capture-the-selected-sources)
for approved-scope survivors, or return the candidate report for a research-only
request. Named URLs and saved files use [named capture](capture.md) directly.
