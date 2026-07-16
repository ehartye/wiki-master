---
description: Periodic deep maintenance pass — structural health, contradictions, stale claims, missing concepts/links, and semantic drift.
---

Load the `wiki-maintainer` skill and follow its **Lint** workflow.

1. Run `/wiki-health` first: `node ${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs`. If the
   wiki is empty or clean, stop early — do not burn tokens.
2. Run drift: `node ${CLAUDE_PLUGIN_ROOT}/scripts/drift.mjs`.
3. Read the flagged pages (orphans, hub-stubs, drifted). Look for: contradictions
   between pages, claims superseded by newer sources, concepts referenced but
   unwritten, and missing cross-references.
4. Apply only safe, unambiguous fixes; present the rest as a proposed change list
   for the user to approve. Stamp `reviewed` on pages you touch. Append a
   `## [YYYY-MM-DD] lint | ...` line to `log.md`.
