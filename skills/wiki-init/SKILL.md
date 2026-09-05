---
name: wiki-init
description: Scaffold a fresh wiki-master vault (folders, index/log, schema, Bases dashboard, templates) and print the one-time setup steps.
---

> **Host portability (Claude Code, Copilot CLI, Codex):** Resolve bundled
> `scripts/` and `templates/` paths from this skill's installed directory:
> `../../` is the plugin root. Use quoted absolute paths when running helpers;
> do not resolve them from the current workspace or depend on plugin-root shell
> variables. For sibling skills, read `../<skill-name>/SKILL.md` if the host has
> no skill-loading tool. References such as `/wiki-health` mean that skill's
> workflow; in Codex, select the skill or ask for it by name. Treat `$ARGUMENTS`
> as the user's request when the host does not substitute it.

Initialize the wiki vault.

1. Run `../../scripts/init.mjs` (path relative to this skill's directory) with node.
2. Relay the printed one-time setup steps to the user (open as vault, verify with
   `obsidian vaults`, import the Web Clipper template).
3. Once the user confirms the vault is open in Obsidian, run `/wiki-health` to
   confirm the CLI can reach it.
