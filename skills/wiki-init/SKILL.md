---
name: wiki-init
description: Use when asked to initialize or scaffold a new wiki-master vault. Existing-vault health checks belong to wiki-health; this is not a migration or repair workflow.
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [operations](../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

Initialize the wiki vault.

1. Verify this is the intended new vault root. Open an operation before
   scaffolding, using the fresh-vault exception in the completion contract.
   Run `node "<absolute-plugin-root>/scripts/init.mjs"`.
2. Verify the expected folders, schema, templates and catalog exist. Run
   `node "<absolute-plugin-root>/scripts/health.mjs"`; it checks files without
   requiring a running app. Log and close the operation; sync only if authorized
   and configured. Report a non-git vault as local-only.
3. Relay the one-time app setup steps (open the folder as a vault, verify with
   `obsidian vaults`, import the Web Clipper template). Report app registration
   separately from completed filesystem initialization; do not claim a health
   report proved the CLI can reach Obsidian.
