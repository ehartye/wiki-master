---
description: Scaffold a fresh wiki-master vault (folders, index/log, schema, Bases dashboard, templates) and print the one-time setup steps.
---

Initialize the wiki vault.

1. Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs`
2. Relay the printed one-time setup steps to the user (open as vault, verify with
   `obsidian vaults`, import the Web Clipper template).
3. Once the user confirms the vault is open in Obsidian, run `/wiki-health` to
   confirm the CLI can reach it.
