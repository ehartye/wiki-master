---
name: wiki-health
description: Fast, zero-LLM structural health report for the wiki (orphans, dead-ends, broken links, hub-stubs, 0–100 score).
---

Run the deterministic health check and report the result to the user.

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory (the plugin root is the parent of `skills/`). Run each with node **by its absolute path**, resolving `../../scripts/<name>.mjs` against THIS skill's own directory — **do not `cd`** into the skill dir (compound `cd; node` commands get permission-denied under Copilot CLI), and don't rely on `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` (unset under Copilot CLI).

Steps:
1. Run the health script — `../../scripts/health.mjs` resolved to an absolute path from this skill's directory — with node.
2. Present the score and each category. If broken links or orphans exist, offer to
   run `/wiki-relink` to fix them. Do not modify any files in this skill.
