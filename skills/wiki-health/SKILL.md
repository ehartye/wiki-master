---
name: wiki-health
description: Fast, zero-LLM structural health report for the wiki (orphans, dead-ends, broken links, hub-stubs, 0–100 score).
---

> **Host portability (Claude Code, Copilot CLI, Codex):** Resolve bundled
> `scripts/` and `templates/` paths from this skill's installed directory:
> `../../` is the plugin root. Use quoted absolute paths when running helpers;
> do not resolve them from the current workspace or depend on plugin-root shell
> variables. For sibling skills, read `../<skill-name>/SKILL.md` if the host has
> no skill-loading tool. References such as `/wiki-health` mean that skill's
> workflow; in Codex, select the skill or ask for it by name. Treat `$ARGUMENTS`
> as the user's request when the host does not substitute it.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location, the provenance/`raw/`-immutability
> guardrails, and the shared metrics these steps assume. Skip the load if you arrived
> here mid-run from a wiki-master skill that already pulled it in.

Run the deterministic health check and report the result to the user.

Steps:
1. Run `../../scripts/health.mjs` (path relative to this skill's directory) with node.
2. Present the score and each category. If broken links or orphans exist, offer to
   run `/wiki-relink` to fix them. Do not modify any files in this skill.
