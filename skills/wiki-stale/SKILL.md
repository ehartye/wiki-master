---
name: wiki-stale
description: Freshness report — buckets wiki pages by how long since they were reviewed/updated, plus semantic drift.
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Report which wiki pages are going stale.

Steps:
1. Run `../../scripts/stale.mjs` (path relative to this skill's directory) with node.
2. Then run `../../scripts/drift.mjs`.
3. Summarize the stale/rotten pages and any drifted pages. Offer to re-review the
   worst offenders (which would run an ingest-style refresh and stamp `reviewed`).
