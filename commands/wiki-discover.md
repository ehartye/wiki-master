---
description: Autonomously discover web sources on a topic — parallel perspective subagents find + credibility-rank sources, clip the best into raw/clippings/, then confirm before ingesting.
argument-hint: <topic>
---

Load the `wiki-discoverer` skill and run its flow for the topic: $ARGUMENTS

1. **Phase 0 — dedup check.** Gather existing clipping `source:` URLs
   (`obsidian search query="tag:clippings" format=json`) and a coverage summary
   from `index.md`.
2. **Phase 1 — fan out.** Launch the 5 perspective subagents IN PARALLEL (one
   message, multiple Agent calls), each read-only, each returning a ranked
   candidate list. Give each the topic, the known-URL set, and the coverage summary.
3. **Phase 2 — select.** Independently dedup + credibility-score the pooled
   candidates (high/medium/low), drop rejects and dupes, keep the top sources.
4. **Phase 3 — clip.** For each survivor:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/clip.mjs "<url>" --quality=<tier>`
5. **Confirm gate.** Show the user the ranked list (title, url, quality, why) and
   which clips succeeded / were skipped (blocked, duplicate, thin). Ask whether to
   ingest.
6. **On confirm:** run `/wiki-ingest` (which processes the new clippings), then
   append one line to `log.md`:
   `## [YYYY-MM-DD] discover | <topic> → N clipped, M ingested`.
   **On decline:** leave the clippings in `raw/clippings/` for manual review.
