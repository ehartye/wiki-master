---
name: wiki-init
description: Scaffold a fresh wiki-master vault (folders, index/log, schema, Bases dashboard, templates) and print the one-time setup steps.
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory (the plugin root is the parent of `skills/`). Run each with node **by its absolute path**, resolving `../../scripts/<name>.mjs` against THIS skill's own directory — **do not `cd`** into the skill dir (compound `cd; node` commands get permission-denied under Copilot CLI), and don't rely on `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` (unset under Copilot CLI).

Initialize the wiki vault.

1. Run the init script — `../../scripts/init.mjs` resolved to an absolute path from this skill's directory — with node.
2. Relay the printed one-time setup steps to the user (open as vault, verify with
   `obsidian vaults`, import the Web Clipper template).
3. Once the user confirms the vault is open in Obsidian, run `/wiki-health` to
   confirm the CLI can reach it.
