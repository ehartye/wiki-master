---
name: wiki-relink
description: Use when asked to connect overlapping or complementary wiki concepts, repair links, or build task maps. For a report without changes use wiki-health; new external evidence belongs to wiki-discover.
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read [access and host commands](../wiki-maintainer/references/access.md) before touching the vault. Also read for this operation: [efficacy](../wiki-maintainer/references/efficacy.md), [operations](../wiki-maintainer/references/operations.md).
Load the rest only when this run reaches it — [evidence](../wiki-maintainer/references/evidence.md) before a relationship claim rests on a cited source; [maintenance](../wiki-maintainer/references/maintenance.md) when repairing wrapped links, citation shapes or ordering.
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

0. For an authorized repair run, open before the first write: `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op relink` — records
   what was already uncommitted, so step 5 commits your work and not the user's.
1. Find unresolved links and orphans with `node "<absolute-plugin-root>/scripts/health.mjs"`;
   Obsidian's `orphans` includes catalog links and can hide stranded pages.
   Run `node "<absolute-plugin-root>/scripts/identity-audit.mjs" --limit=20 --json` to separate
   ambiguous identities from concepts that merely need connections.
   For a preview-only request, stop after the reports without opening an operation.
   Run `node "<absolute-plugin-root>/scripts/repair-wrapped-links.mjs"` first in dry-run mode;
   apply scoped, authorized repairs with `--apply` before substantive relinking — a hard-wrapped
   wikilink (`[[Title\ncontinued]]`, from a paragraph that got word-wrapped across a
   line break) can never resolve and is not a real orphan/unresolved-link decision to
   make, just a mechanical fix; clearing it first keeps the rest of this workflow
   focused on links that actually need a judgment call. It reports anything it cannot
   safely fix (an ambiguous hyphen-adjacent wrap) for manual review — see
   `scripts/lib/dewrap-links.mjs`.
2. Before creating a page for a frequently mentioned entity, search candidate
   names and equivalent aliases; reuse the canonical page when it already exists.
   Do not merge related concepts merely because names or embeddings are similar.
3. Run `node "<absolute-plugin-root>/scripts/relationships.mjs" --limit=10 --json` (optionally
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
   `node "<absolute-plugin-root>/scripts/log-entry.mjs" --op relink --title "<summary>"` (details on stdin).
5. Close the operation:
   `node "<absolute-plugin-root>/scripts/op-commit.mjs" --op relink --title "<summary>" --since <saved-token>`
   Relink rewrites links across the graph; committing it as one unit is what makes
   it revertable. The helper does not push; complete already-authorized sync through the shared contract. This step also reports any hard-wrapped wikilink
   still present in the files it commits, in case one was introduced after step 1 ran.
