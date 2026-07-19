# Vault schema (wiki-master)

This vault is an LLM-maintained wiki (Karpathy pattern). Maintained by the
`wiki-master` Claude Code plugin.

## Layout
- `raw/` — immutable sources: the **body** is never edited (it is the evidence).
  Frontmatter is pipeline state, updated only by wiki-master tooling.
  `raw/clippings/` — Web Clipper / clip.mjs output.
- `wiki/sources|entities|concepts|syntheses` — LLM-owned pages.
- `moc/` — Maps of Content. `index.md` — catalog. `log/` — one file per operation, viewed via `log.base`.

## Frontmatter contract
- Raw/clippings: `title, source, author, published, created, tags:[clippings], quality, source-hash`.
- Wiki pages: `type, created, updated, reviewed, status, sources:[[...]], ai-generated`.

## Rules
- Raw is the source of truth. Every wiki page cites its `raw/` provenance.
- Links are `[[wikilinks]]`; embeds `![[...]]` are transclusion only.
