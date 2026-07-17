---
name: wiki-health
description: Fast, zero-LLM structural health report for the wiki (orphans, dead-ends, broken links, hub-stubs, 0–100 score).
---

Run the deterministic health check and report the result to the user.

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Steps:
1. Run `../../scripts/health.mjs` (path relative to this skill's directory) with node.
2. Present the score and each category. If broken links or orphans exist, offer to
   run `/wiki-relink` to fix them. Do not modify any files in this skill.
