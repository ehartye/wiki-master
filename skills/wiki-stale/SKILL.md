---
name: wiki-stale
description: Freshness report — buckets wiki pages by how long since they were reviewed/updated, plus semantic drift.
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

Report which wiki pages are going stale.

Steps:
1. Run `../../scripts/stale.mjs` (path relative to this skill's directory) with node.
2. Then run `../../scripts/drift.mjs`.
3. Summarize the stale/rotten pages and any drifted pages. Offer to re-review the
   worst offenders (which would run an ingest-style refresh and stamp `reviewed`).
