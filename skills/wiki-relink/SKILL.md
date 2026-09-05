---
name: wiki-relink
description: Deepen relationships — add inferred links, materialize frequently-referenced entities, build/refresh MOCs.
---

> **Host portability (Claude Code, Copilot CLI, Codex):** Resolve bundled
> `scripts/` and `templates/` paths from this skill's installed directory:
> `../../` is the plugin root. Use quoted absolute paths when running helpers;
> do not resolve them from the current workspace or depend on plugin-root shell
> variables. For sibling skills, read `../<skill-name>/SKILL.md` if the host has
> no skill-loading tool. References such as `/wiki-health` mean that skill's
> workflow; in Codex, select the skill or ask for it by name. Treat `$ARGUMENTS`
> as the user's request when the host does not substitute it.

Load the `wiki-maintainer` skill and follow its **Relink** workflow.

0. Open the operation: `TOKEN=$(node ../../scripts/op-begin.mjs --op relink)` — records
   what was already uncommitted, so step 5 commits your work and not the user's.
1. Find unresolved links and orphans: `obsidian unresolved verbose` · `obsidian orphans`.
   Run `node ../../scripts/repair-wrapped-links.mjs --apply` first — a hard-wrapped
   wikilink (`[[Title\ncontinued]]`, from a paragraph that got word-wrapped across a
   line break) can never resolve and is not a real orphan/unresolved-link decision to
   make, just a mechanical fix; clearing it first keeps the rest of this workflow
   focused on links that actually need a judgment call. It reports anything it cannot
   safely fix (an ambiguous hyphen-adjacent wrap) for manual review — see
   `scripts/lib/dewrap-links.mjs`.
2. For entities referenced ≥3× (via `obsidian search`) but having no page, create a
   stub page and link it from the mentioning pages.
3. Propose inferred `[[links]]` between related concepts/syntheses; apply the ones
   the user approves so they enter Obsidian's index.
4. Build or refresh MOC hubs in `moc/` for dense clusters. Write the log entry:
   `node ../../scripts/log-entry.mjs --op relink --title "<summary>"` (details on stdin).
5. Close the operation:
   `node ../../scripts/op-commit.mjs --op relink --title "<summary>" --since $TOKEN`
   Relink rewrites links across the graph; committing it as one unit is what makes
   it revertable. It does not push. This step also reports any hard-wrapped wikilink
   still present in the files it commits, in case one was introduced after step 1 ran.
