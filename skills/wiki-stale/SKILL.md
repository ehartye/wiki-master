---
name: wiki-stale
description: Freshness report — buckets wiki pages by how long since they were reviewed/updated, plus semantic drift.
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory (the plugin root is the parent of `skills/`). Run each with node **by its absolute path**, resolving `../../scripts/<name>.mjs` against THIS skill's own directory — **do not `cd`** into the skill dir (compound `cd; node` commands get permission-denied under Copilot CLI), and don't rely on `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` (unset under Copilot CLI).

Report which wiki pages are going stale.

Steps:
1. Run the stale script (`../../scripts/stale.mjs`, resolved to an absolute path from this skill's directory) with node.
2. Then run `../../scripts/drift.mjs` the same way.
3. Summarize the stale/rotten pages and any drifted pages. Offer to re-review the
   worst offenders (which would run an ingest-style refresh and stamp `reviewed`).
