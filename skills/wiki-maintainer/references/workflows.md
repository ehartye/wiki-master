# Domain workflow reference

## Workflows
- **Ingest** (`/wiki-ingest`): read the source → write/update `wiki/sources/<slug>.md`
  (summary + `sources: ["[[raw link]]"]`) → update the entities/concepts it touches
  (create stubs where missing) → add `[[links]]` both directions → regenerate the
  catalog (`node "<absolute-plugin-root>/scripts/index-gen.mjs"`) → write the log entry via `node "<absolute-plugin-root>/scripts/log-entry.mjs"`.
  Update only pages the source substantively changes. Set `reviewed` only where factual claims were checked against the evidence; mechanical edits preserve it.
  **Prefer a named source set over the bare "process all new clippings" form.**
  Two sessions sharing a vault is normal, and ingest is not concurrency-safe:
  both would rewrite the same concept and index pages, last write silently wins.
  Scoping to what you clipped keeps sessions out of each other's work.
  **When a source discusses a concept that already has a page, revise that page
  rather than adding a parallel one** — accumulating per-concept is what makes the
  wiki compound instead of sprawl.
- **Search** (`/wiki-search`): pure retrieval — find matching `wiki/` pages
  (and, with `--include-raw`, `raw/` clippings too) and return citation-ready
  `path:line` results. No synthesis, no writes; use this whenever you just
  need to locate something, not answer a question.
- **Query** (`/wiki-query`): calls `/wiki-search` → synthesize with citations →
  file back only when authorized, or offer a substantive new answer for filing.
- **Lint** (`/wiki-lint`): run `/wiki-health` first (cheap); then read the flagged
  pages and look for contradictions, stale claims, missing concept pages, and
  missing cross-references; run drift. Report; apply only safe fixes or propose the rest.
- **Relink** (`/wiki-relink`): add inferred `[[links]]`; materialize entities
  referenced ≥3× but unwritten after checking canonical identity; build/refresh MOCs. Prefer real wikilinks so they
  become part of Obsidian's index.
- **Authoring** (`wiki/authored/`; dedicated skill `/wiki-author`): write these
  directly — there is no source to ingest from. Place the file per the
  canonical table in authoring.md; use `_templates/authored-note.md`
  (`_templates/authored-decision.md` for an ADR,
  `_templates/authored-backlog-item.md` for a backlog item), set
  `type: authored` and `sources: []`, and record `ai-generated` honestly
  (`true` if you drafted it, `false` if the human did). Set `project:`/`kind:`
  matching the folder — see authoring.md for the
  vocabulary. Treat it as a living page like any other: revise it in place as
  it evolves, set `updated` for edits and `reviewed` only after verifying the factual content or project behavior, and never invent a `raw/` counterpart
  to satisfy the provenance guardrail — the disclosure *is* satisfying it. Run
  `node "<absolute-plugin-root>/scripts/moc-authored-gen.mjs" --apply` after adding a page to a
  project with two or more — it regenerates that project's `moc/<project>.md`
  hub from `project:`/`kind:`, the same fenced-region contract `index.md`
  itself uses, so the hub can never silently fall out of sync with the files.
  For a backlog item specifically, also run
  `node "<absolute-plugin-root>/scripts/backlog-gen.mjs" --apply` — it regenerates
  `<project>/roadmap.md`'s itemized list from `backlog/*.md`, the same fence
  contract, so the roadmap view can never drift from what the items actually
  say.
