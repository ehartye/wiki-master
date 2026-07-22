# Semantic search over the wiki — Design Spec

**Date:** 2026-07-22
**Status:** Implemented (2026-07-22, same day) — `scripts/search.mjs` + tests shipped per
`docs/superpowers/plans/2026-07-22-semantic-search.md`, which also records real findings from
testing against the live vault (qmd's confirmed JSON shape, an `obsidian` CLI zero-hit quirk, and
an embedding-model context-length limit) that weren't and couldn't have been known at spec time.
**Author:** Design conversation with @Eric-Hartye_HON
**Prior art:** `docs/superpowers/research/2026-07-22-semantic-search-prior-art.md` (read first —
this spec assumes its findings)

---

## 1. Summary

wiki-master today has no semantic retrieval: `/wiki-query`'s entire search step is one
`obsidian search` keyword call (`skills/wiki-query/SKILL.md`). The source pattern wiki-master
implements explicitly anticipates this gap and explicitly names a tool for it (`qmd`), while
explicitly licensing a simpler home-built alternative in the same breath. Measured against this
environment's actual vault (357 sources, 555 wiki pages — see prior-art doc §"Baseline scale
check"), the wiki is already past the range the source pattern says index-only navigation covers
comfortably. This is not a premature ask.

**Recommendation, one line:** build a small, tiered, feature-detected search script that reuses
wiki-master's *existing* Ollama embedding infrastructure as the default semantic layer, keep
`obsidian search` as the always-available keyword layer, and treat `qmd` as an optional,
auto-detected quality upgrade for users who have it installed — never a hard dependency.

## 2. Decision: what to build, weighed against the alternatives

| Option | Time | Risk | Complexity | Architectural fit | Long-term cost |
|---|---|---|---|---|---|
| **A. Tiered own script, reusing `embed.mjs`/Ollama (recommended, primary)** | Small — reuses an existing, tested client and cache; new code is mostly "embed query, rank cache" | Low — same dependency (Ollama) already optional and gracefully-degrading elsewhere in this codebase; brute-force cosine at hundreds of pages is milliseconds, no ANN complexity | Low — one new script, same shape as `health.mjs`/`lint.mjs` | Matches "small Node helper layer," "degrades gracefully if absent," zero new runtime deps | Low — wiki-master owns and can evolve it; no third-party release cadence to track |
| **B. Adopt `qmd` as the (sole) search mechanism** | Small *if* it works out of the box; real if Node≥22 or native-module install friction bites a user | Medium — third-party dependency for a load-bearing path (`/wiki-query`'s only retrieval step would break vault-wide if qmd breaks); Node ≥22 vs wiki-master's stated ≥18 forces an ecosystem-wide bump | Low code, but adds a large dependency tree (`node-llama-cpp`, `sqlite-vec`, 4 tree-sitter grammars, MCP SDK) `package.json` doesn't have today (wiki-master currently ships **zero** runtime deps) | Contradicts "no vector database" read literally (though arguably not in spirit — see §3); best-in-class retrieval quality (query expansion, LLM rerank, RRF) no home-grown script matches soon | Medium — tied to an external project's roadmap/breaking changes for something every `/wiki-query` call depends on |
| **C. Status quo — `obsidian search` only, do nothing** | None | Low short-term, but the actual measured vault (912 files) is already past the source pattern's own comfort range — the risk is answer quality silently degrading as keyword-only search misses paraphrased/synonymous matches | None | Consistent with minimalism, but the pattern's own author doesn't recommend stopping here at this scale | Deferred cost: the longer this waits, the more query answers rest on incomplete retrieval without anyone noticing (no metric currently measures retrieval recall) |
| D. Hand-roll `sqlite-vec` directly (skip qmd's full stack, keep ANN) | Medium — real code to write, a native dependency to add | Low-medium — one native module instead of qmd's whole tree | Medium | Buys nothing brute-force cosine doesn't already give at this scale (hundreds, not millions, of vectors) | Not worth it until corpus size actually needs an index, which isn't now |

**Recommended: A, with qmd offered as an optional Tier 1 accelerator (see §4) — not B, not C, not D.**
Rationale in one sentence: wiki-master already paid for the one dependency (Ollama) this needs,
already has the cache and the graceful-degradation idiom (`drift.mjs`), and the source pattern
itself licenses exactly this path ("build something simpler yourself... a naive search script").

## 3. On "no vector database" (README) — does Option A/qmd violate it?

Worth resolving explicitly since it's a stated project principle, not implicit. Read literally,
brute-force cosine similarity over an in-memory array of cached vectors is not a *database* of any
kind — no query planner, no index, no server, just a loop. It doesn't touch this principle. `qmd`'s
own storage (a single SQLite file with the `sqlite-vec` extension) is closer to the line, but
reads more naturally as "embedded index," the same category `.wiki-master/embeddings.json` already
occupies, not "vector database" in the sense the README is contrasting itself with (a hosted
service like Pinecone/Weaviate, or a **daemon** — the actual target of "no daemon," which the CLI
invocation path qmd offers doesn't require). Recommendation: keep the principle's spirit (no
persistent server process, no hosted service) and read "no vector database" as ruling out a
*service*, not an embedded SQLite file — but this is a judgment call worth the user's explicit
sign-off before it's treated as settled, since it's their stated principle to interpret, not mine
to redefine unilaterally.

## 4. Recommended design: three tiers, each degrading to the one below

```
1. qmd (optional, if detected on PATH)  →  best quality: hybrid + query expansion + LLM rerank
2. Ollama embedding + brute-force cosine (default)  →  good quality: real semantic recall
3. obsidian search (always available)  →  baseline: keyword only, zero dependencies
```

- **Detection, not configuration.** Mirrors the exact pattern `scripts/init.mjs`'s
  `defuddleAvailable()` already uses (try the command, `stdio: 'ignore'`, catch → false) and
  `drift.mjs`'s `isAvailable()` Ollama liveness probe. No new environment variable to *choose* a
  tier — the script picks the best one actually available and says which it used, the same way
  `/wiki-init` already reports "Note: /wiki-discover needs the Defuddle CLI" only when it's
  missing.
- **qmd used only as an external CLI, never as an npm dependency.** `execSync('qmd --version')`
  probes availability; a hit shells out to `qmd query "<question>" --json` (or `qmd search`,
  final choice at implementation time) exactly as `obsidian` and `defuddle` are invoked today.
  This is the detail that neutralizes most of §2's Option B cost row: Node ≥22 becomes a
  constraint on whoever chooses to `npm install -g @tobilu/qmd`, not on every wiki-master install
  — the same relationship wiki-master already has with Ollama (present → used; absent → skipped;
  never a hard `package.json` dependency). **Correction relative to the prior-art doc:** that doc
  weighed the Node ≥22 cost as if qmd were vendored in-process; used purely as a detected external
  CLI, it isn't wiki-master's constraint to inherit at all.
- **Tier 2, concretely — reuses the existing cache with no schema change.** `.wiki-master/
  embeddings.json` is already keyed by `sha256(text)` (content-addressed, `drift.mjs:33-39`), not
  by path. A search script needs no new cache format: for each `wiki/` page, hash its body, look up
  the cached vector (embed-and-cache on miss, via the same `embed.mjs` client), then rank every
  page's vector against one query embedding by cosine similarity. Unchanged pages never re-embed —
  the same property that already makes `drift.mjs` cheap on repeat runs.
  ```js
  // scripts/search.mjs (sketch — depth matches this repo's existing spec convention,
  // not a line-complete implementation)
  export async function semanticSearch(query, pages, { embedFn, cache, topN = 10 } = {}) {
    const qVec = await embedFn(query);
    const scored = [];
    for (const p of pages) {                       // wiki/ pages only, matching wiki-query's path=wiki
      const h = hash(p.body);
      const vec = cache[h] ?? (cache[h] = await embedFn(p.body));
      scored.push({ path: p.path, score: cosine(qVec, vec) });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topN);
  }
  ```
- **Keyword + semantic merge.** Simplest workable combination: run both channels, merge by
  Reciprocal Rank Fusion (same principle qmd uses, far less code — `score = Σ 1/(k + rank_i)`
  across the keyword-hit list and the semantic-hit list). Exact formula/weights are an
  implementation-time decision (needs empirical tuning against real queries), not a spec-level one.
- **Known, honest cost: cold-cache latency.** A vault this size (555 `wiki/` pages) has a
  one-time cost to warm the cache — up to low-hundreds of sequential Ollama calls the first time
  search runs (or after a large ingest batch adds many new/changed pages), then near-instant on
  every subsequent call because unchanged pages are never re-embedded. This should be stated to
  the user up front (e.g. in `/wiki-query`'s output — "warming semantic cache: N/M pages"), not
  discovered as an unexplained slow first run.

## 5. Decision: where this plugs in

| Option | Recommendation |
|---|---|
| Extend `/wiki-query`'s existing retrieval step in place | **Recommended** — it is the only current consumer of search; replacing its one `obsidian search` line with a call to the new script is a minimal, backward-compatible change (same JSON-array-of-paths output shape observed from `obsidian search ... format=json` today) |
| New standalone `/wiki-search` skill | Not now — no second consumer exists yet to justify a user-facing command. Ship the primitive as `scripts/search.mjs` (callable directly, tested in isolation like `health.mjs`) so a future skill (dedup detection, relink materialization, a future `/wiki-search`) can call it without rework |

## 6. Scope

- **Corpus: `wiki/` pages only, matching `/wiki-query`'s current `path=wiki` scoping.** `raw/` stays
  reached via citation from a wiki page, not searched directly — consistent with the existing
  contract that raw is evidence, wiki is the navigable/queryable layer.
- **Not in scope for this spec:** an implementation plan (would follow the `docs/superpowers/
  plans/` convention as a separate artifact once this design is confirmed), reusing this
  infrastructure for near-duplicate-concept detection or `/wiki-relink` materialization (a natural
  future extension of the same cache, worth a follow-up spec, not designed here), any change to
  `drift.mjs`'s own behavior (it keeps its narrower page-vs-source purpose; this shares its client
  and cache, not its logic), and any decision about `qmd`'s MCP mode (this recommends CLI-only
  invocation; the MCP path is a possible future upgrade, not needed for v1).

## 7. Test plan (if/when this is implemented)

1. **Cache reuse contract.** An unchanged page's content hash hits the existing
   `.wiki-master/embeddings.json` cache format with no migration — same fixture style as
   `drift.test.mjs`.
2. **Ranking correctness.** A small in-memory fixture (3–5 fake pages + known embedding vectors,
   no real Ollama call) proves `semanticSearch` ranks by cosine similarity, descending, and
   respects `topN`.
3. **Graceful degradation.** With `isAvailable()` stubbed false, the search step falls back to
   keyword-only and reports which tier it used — mirrors `drift.mjs`'s existing "skipped" test.
4. **qmd detection.** With a stubbed `execSync`, presence/absence of `qmd` on PATH correctly
   selects/skips Tier 1, independent of Ollama's availability (the two are independent probes).
5. **Merge/RRF.** Given a fixed keyword-hit list and a fixed semantic-hit list, the merged ranking
   is deterministic and every de-duplicated page appears exactly once.

## 8. Decisions to confirm before implementation

**Confirmed 2026-07-22 by @Eric-Hartye_HON** — recommended column adopted for all five.

| # | Decision | Recommendation | Alternative (and cost) |
|---|---|---|---|
| D1 | Primary mechanism | **✅ Confirmed — own tiered script, reusing `embed.mjs`/Ollama** (§2 Option A) | Adopt `qmd` as sole mechanism — best quality, but a load-bearing third-party dependency with a Node ≥22 floor if ever vendored in-process |
| D2 | `qmd`'s role | **✅ Confirmed — optional, auto-detected Tier 1 accelerator, CLI-only** (§4) | Ignore it entirely — forgoes real quality gains (query expansion, LLM rerank) for users willing to install it |
| D3 | Integration point | **✅ Confirmed — extend `/wiki-query`'s existing step** (§5) | New `/wiki-search` skill — premature with only one consumer |
| D4 | Corpus scope | **✅ Confirmed — `wiki/` only, matching current `path=wiki`** (§6) | Include `raw/` — breaks the evidence/navigable-layer distinction the vault contract relies on |
| D5 | "No vector database" principle | **✅ Confirmed — read as "no service/daemon," not "no embedded index"** (§3) — brute-force cosine and even qmd's embedded SQLite both stay inside it | Read literally — would rule out qmd entirely (even CLI-only) and cap Option A at pure keyword, defeating the point |

Implementation plan: `docs/superpowers/plans/2026-07-22-semantic-search.md` (TDD task breakdown
against a new `scripts/search.mjs`, its tests, and the one-line `/wiki-query` change).
