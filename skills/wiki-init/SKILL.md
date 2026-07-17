---
name: wiki-init
description: Scaffold a fresh wiki-master vault (folders, index/log, schema, Bases dashboard, templates) and print the one-time setup steps.
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Initialize the wiki vault.

1. Run `../../scripts/init.mjs` (path relative to this skill's directory) with node.
2. Relay the printed one-time setup steps to the user (open as vault, verify with
   `obsidian vaults`, import the Web Clipper template).
3. Once the user confirms the vault is open in Obsidian, run `/wiki-health` to
   confirm the CLI can reach it.
