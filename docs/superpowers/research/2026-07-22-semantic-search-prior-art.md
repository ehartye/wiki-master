# Prior-art study: semantic search over the wiki

**Status:** survey — findings only; the recommendation lives in the companion spec,
`docs/superpowers/specs/2026-07-22-semantic-search-design.md`.
**Question that started it:** the source pattern wiki-master implements (Karpathy's LLM-wiki gist)
explicitly names search as the thing you eventually need and explicitly names a tool (`qmd`) —
but wiki-master today has no semantic layer at all: `/wiki-query` is a single `obsidian search`
keyword call. This doc records what the primary source actually says, what `qmd` actually is,
what wiki-master already has half-built, and what the wider ecosystem does, all read at the
source/code level. **The conclusion is deliberately omitted** — see the spec.

## Method

Read from source, not from memory or secondhand summary: the gist fetched directly, `qmd`'s
`package.json`/README read from its repo, wiki-master's own scripts read directly, one
representative Obsidian community plugin's README read directly. Each entry answers a fixed frame:

1. **What does it actually do** — keyword, vector, or hybrid; local or remote model?
2. **What does it cost to adopt** — new runtime/dependency requirements, daemon or not?
3. **Is it scriptable by an agent, or human/UI-facing only?**
4. **What does it store, and where?**

---

## 0. The primary source's own position (Karpathy's LLM-wiki gist, fetched directly)

Two separate passages, **not joined in the source** (confirmed by direct fetch — this is the same
distinction `wiki-maintainer` SKILL.md already had to correct once, see CHANGELOG 0.5.4):

> "**index.md** is content-oriented... This works surprisingly well at moderate scale (~100
> sources, ~hundreds of pages) and avoids the need for embedding-based RAG infrastructure."

> "At some point you may want to build small tools that help the LLM operate on the wiki more
> efficiently. A search engine over the wiki pages is the most obvious one — at small scale the
> index file is enough, but as the wiki grows you want proper search. [qmd](https://github.com/tobi/qmd)
> is a good option: it's a local search engine for markdown files with hybrid BM25/vector search
> and LLM re-ranking, all on-device. It has both a CLI (so the LLM can shell out to it) and an MCP
> server (so the LLM can use it as a native tool). You could also build something simpler yourself
> — the LLM can help you vibe-code a naive search script as the need arises."

Three things the source is explicit about, worth stating precisely because they're easy to
over-read: (a) the ~100/hundreds figure is attached to *index-only navigation being sufficient*,
not to a trigger for adopting search tooling — the source names no threshold for the latter;
(b) `qmd` is offered as *"a good option"*, not a mandate — the very next sentence offers "build
something simpler yourself" as an equally-licensed alternative; (c) `qmd` is explicitly framed as
CLI-first ("so the LLM can shell out to it"), with the MCP server as a secondary integration mode,
not the primary one.

## 1. `qmd` (github.com/tobi/qmd, npm `@tobilu/qmd`) — read from `package.json` + README directly

- **What it does:** hybrid search — BM25 full-text (SQLite FTS5) + vector semantic search
  (`sqlite-vec`) + LLM re-ranking, combined via Reciprocal Rank Fusion. The MCP `query` tool's own
  parameter docs are the clearest spec: typed sub-queries `lex` (BM25) / `vec` (embedding) / `hyde`
  (hypothetical-document embedding), 1–10 per call, first gets 2× weight, reranked by an LLM unless
  `rerank: false`. Also does **code-aware chunking** for source files via bundled tree-sitter
  grammars (Go/Python/Rust/TypeScript) — a capability aimed past markdown, at general codebases.
- **Local models, not Ollama.** Embeddings and reranking run via `node-llama-cpp` against bundled
  GGUF models — a **separate local-inference stack** from the Ollama server wiki-master's own
  `drift.mjs` already depends on. Adopting qmd does not reuse wiki-master's existing Ollama
  investment; it adds a second, independent local-model runtime alongside it.
- **Storage:** a single SQLite file (`better-sqlite3` + `sqlite-vec` extension) per `createStore()`
  call — an embedded index, not a hosted/server vector database. Native prebuilt binaries ship for
  darwin-arm64/x64, linux-arm64/x64, windows-x64 (covers the overwhelming majority of dev
  machines; anything outside that list needs a source build).
- **Daemon: optional, not required.** Default MCP transport is **stdio**, spawned as a subprocess
  per client — no persistent process. A long-lived **HTTP daemon** mode (`qmd mcp --http --daemon`,
  PID file under `~/.cache/qmd/`) exists purely to avoid repeated model-load latency; it is opt-in.
  Used as a bare CLI (`qmd search`/`qmd query`, no `mcp` subcommand invoked at all), qmd runs
  daemon-free — a single CLI process per call, the same shape as every other tool wiki-master
  already shells out to (`obsidian`, `defuddle`).
- **Agent-scriptable:** yes, by design — CLI with `--json`/`--files` output modes explicitly
  documented as "designed for agentic workflows," plus an MCP server as an alternative integration
  path for hosts that prefer native tool-calling over shelling out.
- **Adoption cost, concretely:**
  - `"engines": { "node": ">=22.0.0" }` — wiki-master's own README states **Node.js ≥18**. This is
    a real, immediate compatibility gap: adopting qmd as a hard dependency would raise every
    wiki-master user's minimum Node version.
  - MIT license, v2.6.3 at time of reading, active `CHANGELOG.md`, author is a well-known engineer
    (Shopify's Tobi Lütke) — ordinary open-source provenance signals, not independently verified
    beyond what the manifest states.
  - Dependency surface: `better-sqlite3`, `sqlite-vec` (+5 platform-specific optional native
    packages), `node-llama-cpp`, four tree-sitter grammar packages, `@modelcontextprotocol/sdk`,
    `zod`, `yaml`, `fast-glob` — a substantially heavier install than anything currently in
    wiki-master's own `package.json` (which has **zero** runtime dependencies today; it shells out
    to external CLIs instead of vendoring libraries).
  - Interestingly, qmd itself ships `.claude-plugin/` + `skills/` directories — it's built the same
    way wiki-master is (a CLI wrapped in an agent-plugin shell), which is presumably exactly why
    the gist singles it out as compatible with this pattern.

## 2. wiki-master's own embedding infrastructure — already half of what's needed

Read directly (`scripts/lib/embed.mjs`, `scripts/drift.mjs`):

- **`embed.mjs`** is an 26-line Ollama HTTP client: `POST {OLLAMA_HOST}/api/embeddings` with
  `model` (default `nomic-embed-text`, both env-overridable) and a `prompt`; returns the raw
  embedding vector. Plus `cosine(a, b)` and `isAvailable()` (a liveness probe against
  `/api/tags`, used to degrade gracefully).
- **`drift.mjs`** is the only current *consumer* of `embed.mjs`, and only for a narrow purpose:
  page-vs-source semantic drift (does a page's embedding still resemble the centroid of the
  sources it cites?). It already has every low-level piece a brute-force semantic search would
  need: a **hash-keyed embedding cache** at `.wiki-master/embeddings.json` (`loadCache`/`saveCache`,
  keyed by `sha256(text)` so unchanged pages are never re-embedded), and graceful skip
  (`if (!(await isAvailable())) { console.log('drift skipped...'); return { skipped: true } }`)
  when Ollama isn't running — the exact "degrades gracefully if absent" behavior the README
  promises for anything Ollama-dependent.
- **What's missing for search specifically:** nothing computes an embedding for a *query string*
  and ranks *all* cached page vectors against it. `drift.mjs`'s embed calls are always
  page-vs-its-own-sources, never page-vs-arbitrary-query. The cache format (`{hash: vector}`,
  keyed by content hash, not by page path) would need a path→vector view to be searchable
  directly, or a second small index built alongside it.
- **Confirmed live in this environment:** Ollama is installed and `nomic-embed-text` is already
  pulled (274MB). The dependency this option would lean on is not hypothetical here — it's already
  satisfied.

## 3. Obsidian's own native search (`obsidian search`, today's actual baseline)

Read directly (`skills/wiki-query/SKILL.md`): `/wiki-query`'s entire retrieval step is
`obsidian search query="..." path=wiki limit=10 format=json` — Obsidian's built-in search index,
keyword/text matching only, no semantic layer, no query embedding. This is the thing any new work
is additive to, not a replacement target — the spec should treat it as the keyword channel a
hybrid design would still want, not code to delete.

## 4. Obsidian community plugins with local semantic search (ecosystem check)

Read directly: **Smart Connections** (`brianpetro/obsidian-smart-connections`) — "uses local
embeddings... to surface notes that are semantically related to what you are working on right
now," ships a bundled local embedding model, works offline, mobile-compatible. This validates that
local, on-device semantic search over an Obsidian vault is a well-established, proven pattern (not
a novel risk) — but it is an **in-app UI plugin**: a "Connections view," a "Lookup view," a chat
surface, all human-facing inside Obsidian itself. It exposes no CLI or API wiki-master's agent
could shell out to. Architecturally it answers a different question (help a *human* browsing
Obsidian resurface related notes) than wiki-master needs answered (let the *agent* driving a
CLI/script pipeline retrieve relevant pages for a query). Useful as validation that the underlying
technique works; not itself adoptable into wiki-master's agent-driven architecture.

## 5. Loosely-relevant background already in the user's vault

Not wiki-master-specific (the vault has no prior notes on wiki-master's own search architecture —
checked directly: searches for "wiki-master" + search-related terms, "BM25", "search engine
markdown", and "roadmap" inside `~/.wiki-master-vault` turn up nothing but coincidental keyword
hits in unrelated Salesforce/graph-database clippings). One page is generically relevant as
background on vector-search-system tradeoffs: `wiki/sources/Data 360 (Formerly Data Cloud) Deep
Dive- Your Guide to the Vector Database (Summary).md` (medium-quality, inherited from a Salesforce
Ben article) documents the standard build path — chunk → embed → index → retrieve — and names
staleness/index-drift as a standing operational risk of any embedding-based retrieval system,
which is the same failure mode wiki-master's own `drift.mjs` already exists to catch in a
different context (page-vs-source drift, not query-index drift). Cited as generic grounding only;
not a wiki-master design decision.

## Baseline scale check (this environment, read directly, not the abstract "~100")

`~/.wiki-master-vault`: **357** `raw/clippings/` sources, **555** `wiki/` pages (109 concepts, 375
sources, 69 entities, 2 syntheses), 912 total tracked `.md` files. This is not a hypothetical
future scenario — measured against the source pattern's own stated range for where index-only
navigation "works surprisingly well" (~100 sources, ~hundreds of pages), this vault is already
3.5× past the sources figure. Whatever the spec recommends, "is this premature" is not the live
question for at least this vault.
