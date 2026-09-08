---
name: wiki-discover
description: Use when asked to find sources for the wiki, research an evidence gap, or discover new material on a topic. Existing wiki lookup belongs to wiki-search; already captured sources belong to wiki-ingest.
argument-hint: <topic>
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [evidence](../wiki-maintainer/references/evidence.md), [efficacy](../wiki-maintainer/references/efficacy.md), [operations](../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

# Discovering sources for the wiki

Given a topic ($ARGUMENTS), find the best web sources, credibility-rank them, clip
the survivors, and hand off to `/wiki-ingest`. **Discovery is read-only research:
the perspective passes RETURN candidates and NEVER write the vault.** The only
writer is `scripts/clip.mjs`.

## Phase 0 — dedup before searching
Gather what the wiki already has so the search hunts for *gaps*, not dupes:
- Known source URLs: `scripts/clip.mjs`'s `knownSourceUrls(vaultPath)` (or
  equivalently grep `^source:` across `raw/clippings/*.md`). This reads the
  clippings themselves, rather than querying an index built from them — the
  shortest path to the fact, and it stays correct while the index is stale.
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
4. **Before the first decline or clip write**, open a discover operation with
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op discover` and retain its
   token using the host-specific completion example. Reuse that operation below.
   **Record every reject** so it is never re-litigated:
   `node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --decline="<one-line reason>"`.
   "Seen, considered, declined" must have a representation — an unrecorded reject
   is indistinguishable from "never seen" and comes back every run. Declines
   expire after 180 days (TTL), so a changed world gets one re-evaluation.

## Phase 3 — clip the survivors (the only writes)
Use the operation opened before the first decline or clip. If no decline was
recorded, open it now before clipping; never overwrite a saved token.

For each kept candidate:
`node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --quality=<tier> --topic="<topic>"`

**Pass `--topic` on every clip in the run, and use the same string for all of
them** — it is what lets `/wiki-triage` group this run's leftovers together
later. Use the topic as the user gave it ($ARGUMENTS); do not re-word it per
source, or one run becomes several groups. The flag feeds both places a topic
can land: the clipping's frontmatter when the clip succeeds, and the triage log
when it fails, so you never have to know which happened.

**"Every clip" includes the non-HTML ones.** A candidate that is a PDF, a Word
file or a spreadsheet does not go through `clip.mjs` — it goes through
`clip-pdf.mjs`, `clip-docx.mjs` or `clip-xlsx.mjs` (see the `/clip-pdf` and
`/clip-docx` skills), and **every one of those takes `--topic` too**:

```bash
node "<absolute-plugin-root>/scripts/clip-pdf.mjs"  "<file.pdf>"  --source="<url>" --quality=<tier> --topic="<topic>"
node "<absolute-plugin-root>/scripts/clip-docx.mjs" "<file.docx>" --source="<url>" --quality=<tier> --topic="<topic>"
node "<absolute-plugin-root>/scripts/clip-xlsx.mjs" "<file.xlsx>" --source="<url>" --quality=<tier> --topic="<topic>"
```

**A Confluence Cloud URL is HTML but also does not go through `clip.mjs`** — it
requires authentication `clip.mjs`'s anonymous fetch does not have, and reads
as thin content / gets auto-declined. Route it to `/clip-confluence` instead
(only applies if the `confluencer` plugin is installed — an optional runtime
dependency this one clipper alone takes on; see its skill for why):

```bash
node "<absolute-plugin-root>/scripts/clip-confluence.mjs" "<confluence-url-or-page-id>" --quality=<tier> --topic="<topic>"
```

Forgetting it on the binary paths is the failure mode this run is most likely to
hit, because a PDF-heavy topic routes most of its clips away from `clip.mjs`. One
measured run lost attribution on **16 of 41 clippings (39%)** exactly this way.
**Topic is recorded going forward only and nothing can retro-fit it**, so those
rows are *Unattributed* in triage permanently — the loss is silent and final.

It blocks unreliable domains, skips dupes, extracts via Defuddle, and writes
`raw/clippings/<slug>.md` with `source`, `created`, `tags:[clippings]`, `quality`,
`topic`, `source-hash`. A `thin content` result means the page was a SPA/paywall — clip.mjs
records the decline automatically; report it for manual clipping, don't retry
blindly. A `failed` result (403/transient) is NOT auto-declined — it may recover,
and a 180-day TTL would bury a source you still want.

**Every unresolved link is queued for triage automatically.** `clip.mjs` records
`failed`, `thin`, and `wrong-node` outcomes to `.wiki-master/triage.jsonl`, so a
link that needs a human survives the terminal scrollback. Do not rely on your
Phase 4 prose to carry them — point the user at `/wiki-triage`, where they can
disposition each one (retry, decline, clipped-by-hand). Queue anything else that
needs their judgement yourself with `recordIssue(vaultPath, { url, kind:
'attention', reason })`.

## Phase 4 — finish capture, then hand off
Show the ranked list (title, url, quality, why), which clips succeeded, and which
were skipped (blocked, duplicate, thin, failed). If issues were queued, mention
`/wiki-triage` and report their counts.

**Finish the capture operation before any decision pause.** Validate returned
clipping paths, write one discovery log entry naming the clipped/declined/failed
counts, and close with:
`node "<absolute-plugin-root>/scripts/op-commit.mjs" --op discover --title "<topic> → N clipped" --since <saved-token>`.
Verify the commit and complete already-authorized sync through the shared
contract. If no writes occurred, report that and do not manufacture a log/commit.
Clippings must not remain dirty while waiting for an ingestion decision.

Then use the existing authorization for this exact source set:
- **Discover-and-ingest already authorized:** run `/wiki-ingest` on the named
  successful clippings immediately. It owns a fresh operation and its own log.
  No second confirmation is needed.
- **Only discovery authorized:** ask whether to ingest and wait. The capture is
  already committed; if accepted, ingest the named set in a fresh operation.
- **Ingestion declined:** retain the committed clippings for manual review.

## Guardrails
- The perspective passes never write the vault; `clip.mjs` is the sole writer to `raw/`.
- Never edit the **body** of anything under `raw/` — clipped content is immutable
  source-of-truth. Frontmatter is pipeline state and may be updated by wiki-master
  tooling only (never by hand, never the body).
- Prefer primary/authoritative sources over open-publishing platforms.
- Ingestion requires authorization for this scope; existing explicit authorization
  satisfies Phase 4. Do not add another confirmation to an approved discover-and-ingest run.
