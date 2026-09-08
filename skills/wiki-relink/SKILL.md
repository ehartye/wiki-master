---
name: wiki-relink
description: Find overlapping or complementary wiki concepts, explain useful relationships, and maintain task maps when asked to connect or reorganize knowledge.
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
1. Find unresolved links and orphans with `node ../../scripts/health.mjs`;
   Obsidian's `orphans` includes catalog links and can hide stranded pages.
   Run `node ../../scripts/identity-audit.mjs --limit=20 --json` to separate
   ambiguous identities from concepts that merely need connections.
   Run `node ../../scripts/repair-wrapped-links.mjs --apply` first — a hard-wrapped
   wikilink (`[[Title\ncontinued]]`, from a paragraph that got word-wrapped across a
   line break) can never resolve and is not a real orphan/unresolved-link decision to
   make, just a mechanical fix; clearing it first keeps the rest of this workflow
   focused on links that actually need a judgment call. It reports anything it cannot
   safely fix (an ambiguous hyphen-adjacent wrap) for manual review — see
   `scripts/lib/dewrap-links.mjs`.
2. Before creating a page for a frequently mentioned entity, search candidate
   names and equivalent aliases; reuse the canonical page when it already exists.
   Do not merge related concepts merely because names or embeddings are similar.
3. Run `node ../../scripts/relationships.mjs --limit=10 --json` (optionally
   `--since=YYYY-MM-DD`, `--seed="wiki/concepts/<page>.md"`, or `--semantic`).
   Read both candidate pages and their supporting evidence. Choose a role and an
   explanatory sentence using the efficacy contract. A candidate is unverified;
   shared evidence and similarity do not establish equivalence or causality.
   Apply links within the user's authorized scope under `## Relationships`;
   seek input for uncertain interpretations. Supporting citations stay in
   `sources:` and factual prose, separate from navigation. Preserve `reviewed`
   during mechanical linking. Report accepted/rejected candidates and reasons.
4. Build or refresh a small task MOC when it helps recurring questions: starting
   points, prerequisites, alternatives, complementary domains and open questions.
   Use `_templates/task-map.md`; keep generated document catalogs distinct.
   Confirm new links resolve and a task query can find the map. Write the log entry:
   `node ../../scripts/log-entry.mjs --op relink --title "<summary>"` (details on stdin).
5. Close the operation:
   `node ../../scripts/op-commit.mjs --op relink --title "<summary>" --since $TOKEN`
   Relink rewrites links across the graph; committing it as one unit is what makes
   it revertable. It does not push. This step also reports any hard-wrapped wikilink
   still present in the files it commits, in case one was introduced after step 1 ran.
