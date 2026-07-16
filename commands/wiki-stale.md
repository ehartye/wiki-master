---
description: Freshness report — buckets wiki pages by how long since they were reviewed/updated, plus semantic drift.
---

Report which wiki pages are going stale.

Steps:
1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/stale.mjs`
2. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/drift.mjs`
3. Summarize the stale/rotten pages and any drifted pages. Offer to re-review the
   worst offenders (which would run an ingest-style refresh and stamp `reviewed`).
