# Chunk-level semantic index — Design Spec

**Date:** 2026-08-09
**Status:** Designed (not yet implemented)
**Author:** Design conversation with @Eric-Hartye_HON

---

## 1. Summary

Replace whole-page embedding with a **chunk-level index** so semantic search covers all of
every document, returns the line of the matching passage, and answers in under a second.
Built on the Ollama embedding path already in the repo. No new dependency, no second model,
no vector database.

The user's ask, restated: *"semantic search that's quick and effective and searches ALL of
EVERY document."*

## 2. Why the current path cannot satisfy that

`search.mjs`'s `semanticRun` embeds each page's **first 4,000 characters** —
`EMBED_TRUNCATE_CHARS`, chosen because nomic-embed-text rejects an oversized input with
HTTP 500 rather than truncating. Measured against the live vault:

```
wiki pages:                              1,820
pages over the 4,000-char limit:           395  (21.7%)
characters never embedded:             979,529  of 5,834,364  (16.8%)
largest pages, fraction embedded:  18% · 19% · 19% · 22% · 23% · 24%
```

Chunking is not an optimization here — it is the only way to embed past a model's context
window at all.

## 3. Measured baseline

Where a semantic query's time actually goes, profiled on the live vault:

| Step | Time |
|---|---|
| `obsidian files` subprocess | 90 ms |
| Load the 28 MB vector cache | 120 ms |
| Read all 1,820 files | 101 ms |
| SHA-256 all of them | 10 ms |
| **Embed the query (Ollama, model unloaded)** | **2,142 ms** |
| Cached-vector lookup | 1 ms |

Two findings, both actionable and independent of chunking:

- **The dominant cost is Ollama unloading the model.** The same call measured 30 ms when
  warm. Ollama's default `keep_alive` is 5 minutes; passing `keep_alive` on the embed
  request keeps it resident. This is a one-line fix worth taking on its own.
- **Every query re-reads and re-hashes the whole vault** to decide what is cached — 211 ms
  of avoidable work that a persisted manifest removes.

## 4. Rejected alternatives, with the evidence

### qmd (`@tobilu/qmd`) — installed and measured, then rejected

Installed live during this investigation, collection built (1,820 files, 3,263 chunks,
3m18s, 334 MB model). What the measurements showed:

- **`qmd search` is BM25 only** — qmd's own help says so, and it returned `[]` for a query
  with no literal term overlap. wiki-master's "qmd tier" was therefore lexical-only while
  sitting *above* the actually-hybrid tier in the ladder, so any BM25 hit preempted semantic
  search entirely. Installing qmd made semantic queries worse.
- **True hybrid is available without extra models**: `qmd query $'lex:…\nvec:…' --no-rerank`
  runs both channels fused by RRF and downloaded 0.0 MB. So the tier *could* have been fixed.
- **But it is slower, not faster**: 3.0 s warm, 5.4 s cold, versus 1.5 s for the existing
  path. Each invocation is a fresh process that reloads the model. The daemon
  (`qmd mcp --http --daemon`) was tested and **made no difference to CLI latency** — with it
  stopped and caches warm, queries were identical at 3.0 s. It exists for MCP transports,
  not to accelerate the CLI. Ollama already is the persistent server qmd lacks.
- **And it did not retrieve better.** On a paraphrase of content 12,000 characters into a
  20,745-character page — deep past the truncation cutoff, the case chunking is supposed to
  win — the truncated Ollama path ranked the target page **7 of 1,820** and qmd's chunked
  hybrid did not surface it in the top 5. A page's first 4,000 characters are title,
  frontmatter and topical opening: a strong fingerprint for *which page is about this*.
  Chunk retrieval is passage-matching, which is a different and sometimes worse fit for
  page-level recall.

One query is not a benchmark, and qmd ships `qmd bench` for exactly this. But nothing
measured justified adopting a second embedding stack, a second model, a global npm install,
a Node ≥22 constraint, and a separate index that goes stale silently — when the capability
it offered that we actually wanted (passage-level hits with line numbers) is obtainable from
the infrastructure already present.

**qmd will be uninstalled and its collection removed** as part of this work.

### A vector database (sqlite-vec, LanceDB, Chroma) — rejected on scale

Brute-force cosine over ~4,500 chunks × 768 dimensions is roughly 3 M multiply-adds, single-
digit milliseconds in plain JavaScript. It stays under a second out to ~100 K chunks. The
vault has ~4.5 K. A vector index solves a problem this vault will not have for years, and
the README's stated architecture is explicitly *"No MCP server, no daemon, no vector
database."*

## 5. Design

### 5.1 Chunking (`scripts/lib/chunk.mjs`, pure)

Split on markdown structure, not blind character offsets — a chunk that begins mid-sentence
embeds poorly.

- Prefer heading boundaries (`^#{1,6} `), falling back to paragraph groups, falling back to
  a hard character split for a single unbroken run.
- Target ~1,200 characters, ~150 characters of overlap so a passage spanning a boundary is
  still reachable from both sides.
- Each chunk carries the page's **title and heading path** as a prefix before embedding, so
  a chunk deep in a document still knows what document it belongs to. This is what preserves
  the topical-fingerprint strength that made the truncated page-level path retrieve well.
- Frontmatter is embedded with the first chunk only, never repeated.

Emits `{ text, startLine, endLine, headingPath }` per chunk. Pure — no I/O — so boundary
behaviour is testable without a vault.

### 5.2 Index (`scripts/lib/vector-index.mjs`, pure over injected I/O)

Two persisted artifacts under `.wiki-master/` (gitignored, per-machine, same as today):

- `chunks.json` — the manifest: `{ [path]: { mtimeMs, size, chunks: [{ hash, startLine, endLine }] } }`
- `vectors.bin` + `vectors.idx.json` — chunk-hash → Float32Array(768), stored binary.
  JSON floats cost ~6 KB per vector; Float32 costs 3 KB. At 4,500 chunks that is 14 MB
  rather than 28 MB, and it loads by `readFileSync` + `Float32Array` view rather than parse.

**Keyed by chunk-content hash, exactly as the existing cache is keyed by page hash.** This
is the property that makes staleness structurally impossible: an edited chunk hashes
differently, misses, and is re-embedded. The index can be incomplete, never wrong — which is
precisely what a qmd-style index cannot promise.

Refresh reads only files whose `mtimeMs` or `size` differs from the manifest.

### 5.3 Query

1. Embed the query once, with `keep_alive` set so the model stays resident.
2. Cosine against every chunk vector.
3. Aggregate to pages: a page scores as its **best chunk**, and carries that chunk's line
   number.
4. Fuse with Obsidian keyword results through the existing `mergeRRF`.

Returns `{ path, score, line }` — the line number is the passage-level capability, obtained
without qmd.

### 5.4 Tier vocabulary

The current names conflate engine with mechanism and one of them is false. Renaming, as
agreed:

| Old | New | Meaning |
|---|---|---|
| `hybrid` | `hybrid` | Obsidian keyword + chunk-level semantic, RRF-fused |
| `keyword` | `lexical` | Obsidian search alone — semantic unavailable |
| `qmd` | *(removed)* | qmd is being uninstalled |

### 5.5 Health disclosure

`scripts/lib/search-health.mjs` (already written on this branch) reports which channels
contributed and what is missing. Retained and adapted to the new vocabulary:

- Every search prints one line naming the tier and any degradation — never silent.
- The first search in a 4-hour window prints the full block with fixes.
- `search.mjs --health` gives the full report; `--setup` prints a remediation plan.
- `modelPresent()` (already added to `embed.mjs`) closes the case where Ollama answers but
  the model was never pulled — the one state where the tier label is actively false.

Index coverage joins that report: chunks embedded vs chunks needed, and how many files
changed since the last refresh.

## 6. Migration

The existing 28 MB page-level `embeddings.json` becomes obsolete for search. **`drift.mjs`
shares it** and embeds whole pages and raw sources for drift detection — a different job
that does not want chunking. Decision: `drift.mjs` keeps `embeddings.json` unchanged; the
chunk index is a separate store. Two stores, one purpose each, neither pretending to serve
the other.

`raw/` is **not** indexed initially. Clippings include very large documents (one is a
219 K-word thesis) and would roughly triple the index. Opt-in via a flag, decided after the
wiki-only index is proven.

## 7. Testing

Same discipline the purge work settled on: every guard mutation-verified — deleted, a test
confirmed to fail, restored.

| # | Test | Guards |
|---|---|---|
| 1 | A 20 K-char page yields chunks covering it end to end, no gaps | The actual ask |
| 2 | Chunks overlap, so a passage on a boundary is reachable from both | Boundary loss |
| 3 | Chunk boundaries prefer headings over mid-sentence splits | Embedding quality |
| 4 | Every chunk carries its heading path and page title | Topical fingerprint |
| 5 | An edited page re-chunks only that page; others keep their vectors | Incremental refresh |
| 6 | A changed chunk misses the cache and is re-embedded | Staleness is impossible |
| 7 | An unchanged vault refreshes with zero embed calls | No redundant work |
| 8 | Page score is its best chunk's score, and the line number is that chunk's | Aggregation |
| 9 | Query time stays under 300 ms on a 4,500-chunk index with a warm model | "Quick" |
| 10 | Search with the index absent degrades to `lexical` and says so | Never silent |

## 8. Non-goals

Reranking, query expansion, HyDE, an ANN index, indexing `raw/`, and any background daemon.
Each is a real technique; none is justified at 4,500 chunks, and the last contradicts the
architecture the README states.
