# Vault schema (wiki-master)

This vault is an LLM-maintained wiki (Karpathy pattern). Maintained by the
`wiki-master` Claude Code plugin.

## Layout
- `raw/` — captured sources. The **content is never modified**: no LLM rewriting, no
  reinterpreting what a source said — that integrity is the whole point of provenance.
  Deterministic tooling may still perform *faithful* representation transforms that preserve
  the content — text extraction, localizing an image reference to a stored copy, pipeline-state
  frontmatter. The line is semantic (never alter the evidence), not byte-level (freeze the file).
  `raw/clippings/` — Web Clipper / clip.mjs output. `raw/attachments/` — downloaded assets,
  content-hash named.
- `wiki/sources|entities|concepts|syntheses` — LLM-owned pages.
- `moc/` — Maps of Content. `index.md` — catalog. `log/` — one file per operation, viewed via `log.base`.

## Frontmatter contract
- Raw/clippings: `title, source, author, published, created, tags:[clippings], quality, source-hash`.
- Wiki pages: `type, created, updated, reviewed, status, sources:[[...]], ai-generated`.
  Source pages also carry `source-hashes:[<sha256>,…]` — the `source-hash` of each
  clipping they summarize; this is the content key the ingest-backlog metric joins on.

## Rules
- Raw is the source of truth. Every wiki page cites its `raw/` provenance.
- Links are `[[wikilinks]]`; embeds `![[...]]` are transclusion only.
