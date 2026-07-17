---
name: wiki-discoverer
description: The discipline for autonomous source discovery in wiki-master (/wiki-discover). Defines the perspective agents, the credibility rubric, dedup rules, and the hand-off to clipping — so discovery finds good, non-duplicate, credible sources without writing the vault.
---

# Discovering sources for the wiki

Given a topic, find the best web sources, credibility-rank them, clip the
survivors, and hand off to `/wiki-ingest`. **Discovery agents are read-only
researchers: they RETURN candidates and NEVER write the vault.** The only writer
is `scripts/clip.mjs`.

> **Scripts:** run `clip.mjs` from the plugin's `scripts/` directory — resolve
> `../../scripts/clip.mjs` relative to this skill's own directory (the plugin root
> is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so
> use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

## Phase 0 — dedup before searching
Gather what the wiki already has so agents hunt for *gaps*, not dupes:
- Known source URLs: **read the filesystem** — `scripts/clip.mjs`'s
  `knownSourceUrls(vaultPath)` (or equivalently grep `^source:` across
  `raw/clippings/*.md`). **Never build the dedup set from `obsidian search`:**
  the CLI can silently return empty (app not running, index rebuilding, wrong
  binary on Windows), and an empty dedup set fails open — everything re-clips.
  The filesystem cannot silently be empty.
- Coverage summary: read `index.md`.
- Sanity-check the set: if the vault has clippings on disk but the known-URL
  set is empty, STOP — the collection step failed; do not proceed to search.
Pass the known-URL set + a one-line "already covered" summary to every agent.

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
why_ingest }`.

## Phase 2 — independent select + credibility (do NOT let a finder grade itself)
As the orchestrator (or a separate reviewer), over the pooled candidates:
1. Dedup by URL (normalize: drop `#fragment`, trailing `/`); drop any already in the
   known-URL set; drop blocked domains; drop any in the decline log
   (`.wiki-master/declined.json` — clip.mjs enforces this too, but skipping here
   saves the agents from re-arguing settled candidates).
2. Score each survivor with the rubric → `high | medium | low`:
   - +2 peer-reviewed / primary / official
   - +1 recent (≤3 yr) where recency matters
   - +1 known/credentialed author or authoritative org
   - +1 corroborated by another perspective's find (max +1)
   - −1 vendor-primary / promotional / single-blogger opinion
   Tiers: **high** ≥4, **medium** 2–3, **low** 0–1, **reject** <0 (don't clip).
3. Keep the top sources (favor `high`/`medium`; a few `low` are fine if on-topic).
4. **Record every reject** so it is never re-litigated:
   `node ../../scripts/clip.mjs "<url>" --decline="<one-line reason>"`.
   "Seen, considered, declined" must have a representation — an unrecorded reject
   is indistinguishable from "never seen" and comes back every run. Declines
   expire after 180 days (TTL), so a changed world gets one re-evaluation.

## Phase 3 — clip the survivors (the only writes)
For each kept candidate:
`node ../../scripts/clip.mjs "<url>" --quality=<tier>`
It blocks unreliable domains, skips dupes, extracts via Defuddle, and writes
`raw/clippings/<slug>.md` with `source`, `created`, `tags:[clippings]`, `quality`,
`source-hash`. A `thin content` result means the page was a SPA/paywall — clip.mjs
records the decline automatically; report it for manual clipping, don't retry
blindly. A `failed` result (403/transient) is NOT auto-declined — decline it
explicitly with `--decline` only if you judge it permanently unclippable.

## Guardrails
- Agents never write the vault; `clip.mjs` is the sole writer to `raw/`.
- Never edit the **body** of anything under `raw/` — clipped content is immutable
  source-of-truth. Frontmatter is pipeline state and may be updated by wiki-master
  tooling only (never by hand, never the body).
- Prefer primary/authoritative sources over open-publishing platforms.
- The user confirms before anything is ingested (the command handles the gate).
