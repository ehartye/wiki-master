---
name: wiki-discover
description: Autonomously discover web sources on a topic — perspective researchers find + credibility-rank sources, clip the best into raw/clippings/, then confirm before ingesting.
argument-hint: <topic>
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Load the `wiki-discoverer` skill and run its flow for the topic: $ARGUMENTS

1. **Phase 0 — dedup check.** Gather existing clipping `source:` URLs
   (`obsidian search query="tag:clippings" format=json`) and a coverage summary
   from `index.md`.
2. **Phase 1 — fan out.** Run the 5 read-only perspective passes (Academic,
   Technical, Applied, News/Trends, Contrarian), each returning a ranked candidate
   list, each given the topic, the known-URL set, and the coverage summary. Run
   them **in parallel if your host supports agent fan-out** (Claude Code's Agent
   tool — multiple agents in one message; Copilot CLI custom agents); **otherwise
   run them sequentially.** Either way, no perspective writes the vault.
3. **Phase 2 — select.** Independently dedup + credibility-score the pooled
   candidates (high/medium/low), drop rejects and dupes, keep the top sources.
4. **Phase 3 — clip.** For each survivor:
   `node ../../scripts/clip.mjs "<url>" --quality=<tier>`
5. **Confirm gate.** Show the user the ranked list (title, url, quality, why) and
   which clips succeeded / were skipped (blocked, duplicate, thin). Ask whether to
   ingest.
6. **On confirm:** run `/wiki-ingest` (which processes the new clippings), then
   append one line to `log.md`:
   `## [YYYY-MM-DD] discover | <topic> → N clipped, M ingested`.
   **On decline:** leave the clippings in `raw/clippings/` for manual review.
