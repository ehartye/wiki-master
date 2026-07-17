---
name: wiki-relink
description: Deepen relationships — add inferred links, materialize frequently-referenced entities, build/refresh MOCs.
---

Load the `wiki-maintainer` skill and follow its **Relink** workflow.

1. Find unresolved links and orphans: `obsidian unresolved verbose` · `obsidian orphans`.
2. For entities referenced ≥3× (via `obsidian search`) but having no page, create a
   stub page and link it from the mentioning pages.
3. Propose inferred `[[links]]` between related concepts/syntheses; apply the ones
   the user approves so they enter Obsidian's index.
4. Build or refresh MOC hubs in `moc/` for dense clusters. Append a
   `## [YYYY-MM-DD] relink | ...` line to `log.md`.
