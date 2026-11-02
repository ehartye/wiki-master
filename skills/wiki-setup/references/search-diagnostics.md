# Diagnose search and index coverage

This procedure is read-only unless the user explicitly requests a particular
setup/repair action. Run quoted absolute installed helpers in the known vault.
Ordinary lookup uses [wiki-search](../../wiki-search/SKILL.md) without this preamble.

## Inspect the result and backend

1. Preserve the failing query, stderr status and JSON `channels`, `diagnostics`,
   `semanticGate` and freshness fields. Run
   `node "<absolute-plugin-root>/scripts/search.mjs" --health` for coverage. Use
   `--setup` only to display the exact remediation commands; display is not execution.
2. Distinguish reachable backend, pulled model and built/current index. Common
   causes are Ollama unavailable, embedding model missing or no index. Do not
   silently install/start services, pull models or run `index-embed.mjs` during diagnosis.
3. Report what succeeded and failed. A failed raw scan means not searched. A failed
   primary `wiki/` scan means incomplete coverage, even if other channels returned
   plausible results. Zero hits with failed coverage establishes no absence claim.

## Reading status and ranking

Keyword search scans `wiki/` and `moc/` Markdown: exact phrase, all query terms,
then partial matches. A chunk-level semantic index, built by `index-embed.mjs`
against Ollama, contributes Reciprocal Rank Fusion when backend and index exist.
Results report the actual matched `path:line` passage.

- `hybrid`: keyword and semantic channels contribute candidates. When one to three
  pages contain the whole query, or a query of at most five terms matches all terms
  within one paragraph on one to three pages, semantic candidates stop voting in
  final ordering. JSON `semanticGate: { reason, pages }` reports this; `null` means
  no gate. Tier stays hybrid because semantic still admits candidates.
- `lexical`: real keyword results, no semantic ranking. Say so in the report.
- `keyword request failed (wiki)`: the primary scope failed; other channel results
  do not restore that coverage. `channels.keyword.{wiki,moc,raw}` is `ok` or
  `failed`; semantic is `ok`, `failed`, `ollama-unavailable` or `index-unavailable`;
  identity is `ok` or `incomplete`. Inspect failed channels even under hybrid.
- `raw/ clippings NOT searched`: raw scan failed; no raw hits are not zero evidence.

Channel health does not establish relevance or factual truth. Return to the
retrieval workflow to open actual passages and check the user's claim.

## Index freshness and authorized remedies

Search validates candidate file versions against current files: modified semantic
hits are excluded until refreshed, removed hits dropped, and lexical/identity
hits may still have outdated embeddings. Candidate-limit notices bound what was
validated. Hash-keyed vectors do not make a stale manifest current. `--health`
reports changes since refresh; factual `reviewed` dates are a separate question.

`op-commit` attempts a semantic refresh after an ordinary mutation. Read its
notice: a committed change does not prove a successful/full index build. Hand
edits and changes pulled from another machine can make the index stale.

For an explicitly authorized rebuild, follow the exact supported setup output
and run `node "<absolute-plugin-root>/scripts/index-embed.mjs"` only within that
scope, then rerun health and the original query. Apply the shared
[operation contract](../../wiki-maintainer/references/operations.md) if tracked
vault content changes; report local index/cache work separately. Never add a Git
remote or repair content merely to make diagnostics green. On backend failure,
report the remaining issue and use bounded lexical/filesystem retrieval.
