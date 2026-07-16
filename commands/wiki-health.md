---
description: Fast, zero-LLM structural health report for the wiki (orphans, dead-ends, broken links, hub-stubs, 0–100 score).
---

Run the deterministic health check and report the result to the user.

Steps:
1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs`
2. Present the score and each category. If broken links or orphans exist, offer to
   run `/wiki-relink` to fix them. Do not modify any files in this command.
