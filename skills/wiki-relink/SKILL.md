---
name: wiki-relink
description: Deepen relationships — add inferred links, materialize frequently-referenced entities, build/refresh MOCs.
---

Load the `wiki-maintainer` skill and follow its **Relink** workflow.

0. Open the operation: `TOKEN=$(node ../../scripts/op-begin.mjs --op relink)` — records
   what was already uncommitted, so step 5 commits your work and not the user's.
1. Find unresolved links and orphans: `obsidian unresolved verbose` · `obsidian orphans`.
2. For entities referenced ≥3× (via `obsidian search`) but having no page, create a
   stub page and link it from the mentioning pages.
3. Propose inferred `[[links]]` between related concepts/syntheses; apply the ones
   the user approves so they enter Obsidian's index.
4. Build or refresh MOC hubs in `moc/` for dense clusters. Write the log entry:
   `node ../../scripts/log-entry.mjs --op relink --title "<summary>"` (details on stdin).
5. Close the operation:
   `node ../../scripts/op-commit.mjs --op relink --title "<summary>" --since $TOKEN`
   Relink rewrites links across the graph; committing it as one unit is what makes
   it revertable. It does not push.
