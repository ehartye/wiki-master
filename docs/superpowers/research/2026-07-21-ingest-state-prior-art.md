# Prior-art study: how knowledge systems track "what has been ingested"

**Status:** evolving survey — findings only, no recommendation yet.
**Question that started it:** wiki-master's ingest backlog (`unsummarizedSources`) reported 172
items; on inspection ~0 genuinely needed ingesting. The metric infers ingest-state from whether
a `wiki/sources/` wikilink *resolves* to a raw file (fuzzy basename match, at read time), which
desyncs on rename, citation-format drift, and binaries. This doc records how other systems solve
the same problem, read at the code level. **The conclusion is deliberately omitted** — this is
reference material to weigh perspectives against, not a decision.

## Method

Each system is read from source and answered against a fixed 6-question frame:

1. **Unit of ingestion + the "already ingested?" test** — what signal gates re-processing?
2. **Derived-at-read-time vs. persistent ledger** — where does state live?
3. **Content hash — key or cosmetic?** — is a hash computed, and is it ever *read back*?
4. **Re-ingest-on-change / staleness** — how is a changed source detected?
5. **Provenance link (raw→summary) + rename robustness**.
6. **Skill/command wording** — how the agent layer is told what to ingest / mark done.

Systems are read via `gh api "repos/<owner>/<repo>/contents/<path>" -H "Accept: application/vnd.github.raw"`.

---

## Baseline — wiki-master (ours), as it stands today

- **Backlog** `graph.mjs:272` `unsummarizedSources` = every `raw/` file **not cited by a
  `wiki/sources/` page**, where "cited" = a body/frontmatter wikilink that `resolveLinkTarget`
  (`graph.mjs:198-211`, stem → path-qualified → bare-basename fuzzy match) resolves to it.
  Derived at read time from the link graph; there is a companion `unparsedSources` (`inbound === 0`).
- **No persistent ingest ledger.** `.wiki-master/` holds only an (empty) embedding cache,
  `declined.json`, and `triage.jsonl` (dispositions). `log/` is a per-op narrative audit trail,
  explicitly excluded from the graph and never read back to answer "is X ingested?"
- **Content hash: cosmetic.** `clip.mjs:105,269` writes `source-hash: <sha256>` to clipping
  frontmatter and slices 7 chars for a filename disambiguator. **Never read back.** Dedup at clip
  time is by **URL** (`clip.mjs:225` `isDuplicateUrl`), not hash.
- **Re-ingest-on-change: none.** The spec named `source-hash` "the re-ingest guard"
  (`docs/.../2026-07-15-wiki-master-design.md:163`, `# re-ingest only when this changes`) — **unimplemented**.
- **Provenance:** `sources: ["[[Title]]"]` frontmatter wikilink, observed in ≥3 formats
  (bare title ~706 pages; full path+hash 4 pages; path+ext). Fuzzy-resolved; no rename coherence.
- **Health:** graph topology (orphans/dead-ends/broken/hub-stubs → 0–100), mirroring turbovault,
  plus `unparsed`/`unsummarized` as side metrics (not in the score).

---

## 1. SamurAIGPT/llm-wiki-agent — Python, Claude-Code wiki agent (closest sibling)

Default branch `main`. Read: `tools/{ingest,build_graph,health,refresh,heal,_utils,file_to_md}.py`,
`.claude/commands/*.md`, `CLAUDE.md`, `docs/automated-sync.md`, `wiki/{index,log,overview}.md`.

**Headline: there is no ingest-backlog / un-ingested-source detection.** Ingestion is *push-based* —
`tools/ingest.py` processes exactly the paths handed to it; dedup is only *within one invocation*
by absolute path. The nightly job re-runs ingest over all of `raw/` blindly (`docs/automated-sync.md`).

- **Persistent state (staleness only):** `graph/.refresh_cache.json` = `{raw_path: sha256}`;
  `graph/.cache.json` = `{page: {hash, edges}}` (edge-inference cache).
- **Hash — split fate:** `ingest.py` computes `source_hash = sha256(source_content, truncate=16)`
  and only **prints** it (cosmetic, never stored — identical to wiki-master). `refresh.py` computes
  `sha256(raw)` and **compares it to `.refresh_cache.json`** → this one *is* the staleness key.
- **Re-ingest-on-change:** `refresh.py::find_stale_sources` locates the raw file via the
  `source_file:` frontmatter field, hashes it, and flags stale on `cached_hash != current_hash`.
  **Known bug:** stores full 64-char (`cache[raw]=sha256(raw)`) but compares 16-char
  (`sha256(raw, truncate=16)`) → every source reads stale after first run.
- **Provenance:** `source_file: raw/…` — an **explicit path string**, read directly by regex (not
  fuzzy-resolved). Breaks silently on rename (both `REPO_ROOT/source_file` and `RAW_DIR/source_file`
  miss → `continue`). The LLM's ingest JSON schema does **not** enforce `source_file`; it's
  best-effort/model-dependent.
- **Skill wording:** `.claude/commands/wiki-ingest.md` hands the agent a path; "done" = appending
  `## [date] ingest | <Title>` to `log.md` + an `index.md` row. No backlog-discovery instruction.
- **Re-ingest is non-idempotent:** re-running prepends a new `index.md` line and appends a new
  `log.md` entry with no dedup → duplicate rows accumulate.

## 2. Epistates/turbovault — Rust, Obsidian SDK + MCP server (the repo our health score mirrors)

Default branch `main`. Read: `turbovault-git/src/{cas,occ,changeset,materialize}.rs`,
`turbovault-core/src/{cache,metrics,models}.rs`, `turbovault-graph/src/{graph,health}.rs`,
`turbovault-sql/src/{engine,convert}.rs`, `turbovault-audit/src/{log,snapshot}.rs`, READMEs.

**Headline: git is the ledger.** Every write is an atomic commit through an optimistic-concurrency
pipeline; all *query* state is in-memory and rebuilt each session. No persistent per-note store.

- **Naming trap:** `cas.rs` = **compare-and-swap** (git ref OCC), *not* content-addressable storage.
  `core/cache.rs` caches *vault config*, keyed by a hash of the project **path** (not content).
- **Two real content hashes, neither an ingest key:** (1) git **blob OID** (`occ.rs blob_oid_of`)
  used as an OCC **version token** — "has this known path changed under me," concurrency not
  ingestion; (2) **SHA-256** (`audit/snapshot.rs`, "Content-addressed snapshot storage… SHA-256 hash
  as filename for natural deduplication") used to dedup **rollback snapshots**, not to gate ingest.
- **Change detection = git commit diff.** A `CommitHook` pushes new commit OIDs onto a
  `ReindexQueue`; the drainer runs `repo.diff_path_statuses(parent, commit)` → reparse + graph delta
  (`turbovault-tools/src/reindex.rs`). Blind spot (documented §8.4): uncommitted working-tree edits.
- **Persistent DB: none.** `turbovault-sql` is **in-memory GlueSQL**, `CREATE TABLE files/tags/links`
  rebuilt by re-scanning + re-parsing every session. Per note it stores `path` + frontmatter + links —
  **no hash, no mtime, no processed flag.** `models.rs` `FileMetadata{checksum,modified_at,…}` and
  `VaultFile{is_parsed,last_parsed}` exist but live only on the in-memory scan object; never persisted
  for cross-run comparison (checksum is `"abc123"` in every test).
- **Health = topology only** (`health.rs`): broken/orphan/isolated/dead-end → `100 - penalty`
  (broken 30 / orphaned 20 / isolated 15 / dead-end 10). **No "unprocessed/stale/ingested" dimension.**
- **Provenance:** wikilinks resolved by **stem → alias → path-suffix** (`graph.rs resolve_link`) — same
  fuzzy family as ours. **Rename coherence via atomic link-rewrite:** a move is one changeset that
  renames the note *and* rewrites every linker (`changeset.rs`, tested
  `drain_move_keeps_backlinks_coherent`). Robustness comes from write-time maintenance, not a stable ID.
- **Audit:** `audit/log.rs` append-only JSONL, `AuditEntry{operation,path,before_hash,after_hash,
  before_snapshot_id,after_snapshot_id,…}` → op-log with pointers into the CAS snapshot store; not a
  current-state table.

## 3. raphasouthall/neurostack — Python, embedding/memory vault (the content-hash model)

Default branch verified. Read: `harvest.py`, `watcher.py`, `chunker.py`, `diff.py`, `schema.py`,
`session_index.py`, `memory_drift.py`, `embedder.py`, `memories.py`, `vault_writer.py`, `skills/*.md`.

**Headline: content hash in a SQLite row is the change-detection key, with skip-unchanged.** Two
independent pipelines:

- **Note indexing (hash-keyed):** `chunker.parse_note` computes
  `content_hash = sha256(text).hexdigest()[:16]`, stored in `notes.content_hash` (SQLite, schema v21,
  WAL + FTS5 + optional sqlite-vec). The gate (`watcher.index_single_note` / `full_index._prepare_note`):
  ```python
  existing = conn.execute("SELECT content_hash FROM notes WHERE path=?", (parsed.path,)).fetchone()
  if existing and existing["content_hash"] == parsed.content_hash:
      return   # unchanged → never re-embedded/re-summarized/re-tripled
  ```
  On a hash *mismatch*, the note's chunks/summaries/triples are **deleted and rebuilt wholesale**.
- **Session harvest (mtime-keyed):** `harvest_state.json` = `{session_path: mtime}`; skip if
  `prev_mtime == s.mtime`. Extracted memories are deduped **semantically** (cosine ≥ 0.88 + FTS floor,
  `_is_duplicate`), never by hash.
- **Change baseline / staleness:** `diff.py` diffs current `notes.content_hash` against a named
  `diff_snapshots` baseline (`added/modified/deleted`); stale summaries via a
  `WHERE s.content_hash != n.content_hash` join. Memory drift is embedding-distance (cosine > 0.40),
  not hash.
- **Hash as key — audit:** `notes.content_hash` ✅ primary key; `summaries.content_hash` ✅ staleness;
  `diff_snapshots.content_hash` ✅ baseline; `triples.content_hash` partial (retry queue);
  `chunks.content_hash` ❌ **written-never-read** (their one dead cosmetic hash — note churn is handled
  at note granularity). Agent `memories` have **no** content hash (uuid + embedding; dedup semantic).
- **Provenance / writeback:** DB is source of truth; file exports live in a quarantined `.neurostack/`.
  **Filename = memory UUID** — "stable across content edits and DB rebuilds, so wiki-links don't break."
  Conflict detection uses `neurostack_hash = sha256(body)` in frontmatter (`vault_writer._body_hash`);
  `sync_writeback` compares DB-body-hash vs file-body-hash vs stored hash, DB wins, mismatch → `conflict`.
- **Skill wording:** `skills/vault-audit.md` drives "what needs work" off `vault_prediction_errors()`
  (drift/low-relevance rows) and `vault_diff(baseline=…)` — never off a hash the agent computes; the
  bookkeeping is entirely in the Python layer.

## 4. khoj-ai/khoj — Python, incremental content index (35.9k★)

Default branch `master`. Read: `processor/content/text_to_entries.py`, `markdown/markdown_to_entries.py`,
`database/models/__init__.py`, `processor/embeddings.py`, `routers/api_content.py`, `search_type/text_search.py`.

**Headline: content-hash set-diff in a DB column** — the neurostack pattern, at chunk granularity.

- **Unit:** a heading-scoped, token-chunked `Entry`. **Identity:** `md5(entry.compiled)`
  (`hash_func = lambda e: hashlib.md5(getattr(e, key).encode()).hexdigest()`), stored in the
  `Entry.hashed_value` column (Postgres/pgvector).
- **The diff (`update_embeddings`):** per file, build the current hash set, then
  `hashes_to_process = hashes_for_file − existing_entry_hashes` (**add/changed**) and
  `to_delete = existing_entry_hashes − hashes_by_file[file]` (**deleted/edited-away**);
  the **intersection is left untouched** (never re-embedded). Only `hashes_to_process` are embedded.
- **No mtime / timestamp / path staleness** — the compiled-text hash is the entire ledger.
  `regenerate=True` wipes the file_type first (full rebuild).
- **`hashed_value` has no `unique`/index** and no explicit collision handling (MD5 trusted).
- **Provenance:** `file_path` + `url = file://…#line=N`. **Not rename-robust:** the filename is baked
  into `compiled`, so a rename changes every hash → handled as delete+add, not a move. `corpus_id`
  is regenerated each run (not a stable cross-run id).
- **Trigger:** HTTP endpoint (`indexer(regenerate=False→"sync" | True→"regenerate")`); "done" = 200 +
  logged created/deleted tally. No agent/skill wording.

## 5. SciPhi-AI/R2R — Python, RAG ingestion server (7.9k★)

Default branch `main` (code under `py/`). Read: `core/main/services/ingestion_service.py`,
`providers/database/documents.py`, `shared/abstractions/document.py`, `shared/utils/base_utils.py`,
`core/main/orchestration/simple/ingestion_workflow.py`, `core/main/api/v3/documents_router.py`.

**Headline: an explicit persisted status state-machine + deterministic document ID. No content hash at all.**

- **Ledger:** a Postgres `documents` row with `ingestion_status TEXT DEFAULT 'pending'` (+ `extraction_status`,
  `version`, `size_in_bytes`, `ingestion_attempt_number`, `total_tokens`). **No hash/checksum column
  anywhere** (confirmed by repo-wide search: `hashlib`/`content_hash`/`sha`/`checksum` → 0 hits).
- **Status enum:** `PENDING → PARSING → (AUGMENTING) → EMBEDDING → STORING → (ENRICHING) → SUCCESS`,
  or `FAILED` on any exception; advanced step-by-step by `update_document_status` in the workflow.
- **Identity:** deterministic **UUID5** (`generate_document_id`). Seed differs by path:
  raw-text/chunks = `content + user` (content-addressed → change → new id → new doc);
  **file upload = `filename + user`** (NOT content → an edited re-upload collides, undetected).
- **"Already ingested?"** = `document_id` row lookup + status: `SUCCESS` → 409 (must DELETE first);
  in-flight → 409; **only `FAILED` may be re-ingested**. No checkpoint/resume — recovery is full re-run.
- **"What needs work?"** = `get_document_ids_by_status(status IN ('pending','failed'))` — a status query.
- **Provenance:** chunks/vectors carry `document_id`; re-ingest replaces the chunk set wholesale.

## 6. basicmachines-co/basic-memory — Python, markdown↔SQLite sync (3.5k★) — closest cousin

Default branch `main` (architecture refactored: sync now in `index/` + `indexing/`, not the old
`sync/sync_service.py`). Read: `indexing/change_planning.py`, `indexing/change_detector.py`,
`indexing/file_index_planning.py`, `index/local_project.py`, `index/local_moves.py`,
`index/watch_service.py`, `services/file_service.py`, `file_utils.py`, `models/knowledge.py`.

**Headline: SHA-256 checksum of on-disk bytes as change/move evidence; durable identity is a stable UUID,
not the path. Solves the rename/desync problem directly.**

- **Ledger:** one markdown file = one `Entity` row in **one app-level SQLite DB** (`~/.basic-memory/memory.db`,
  multi-project via `project_id`; Postgres optional). Row persists `file_path`, `permalink`,
  **`checksum` (SHA-256 of raw on-disk bytes)**, `mtime`, `size`, and `external_id` (stable UUID).
- **Classifier (`plan_file_changes`):** per path — **new** (no row) · **modified**
  (`storage_checksum != db_checksum`) · **unchanged** (equal → skipped, idempotent) · **deleted**
  (`all_db_paths − storage_paths − moved`) · **moved**.
- **Move detection (`plan_moved_files` / `local_moves.py`):** a pathless-on-disk file whose checksum
  equals a **deleted** row's checksum → the **existing row is updated in place**, preserving `id`/`external_id`.
- **Hash is authoritative** (`FileService.compute_checksum` reads bytes back off disk in 64KB chunks);
  `mtime`+`size` is only an **rsync-style shortcut** to skip rehashing unchanged files (never the identity).
  Writes return the checksum of the bytes actually persisted, so drift resurfaces as "modified" next scan.
- **Identity:** durable = numeric `id` / `external_id` UUID (+ `permalink` for URIs). **`file_path` is a
  fallback, not identity** — which is exactly why moves preserve the row instead of delete+recreate.
- **Trigger:** background `watchfiles` watcher (debounced) auto-indexes; `bm status` = the "am I in sync?"
  scan; `bm reindex --full` = rebuild. "In sync" = every on-disk `checksum == Entity.checksum` and no
  orphan rows (`total_changes == 0`).

## 7. mem0ai/mem0 — Python/TS, agent memory layer (61.4k★) — the semantic-dedup outlier

Default branch `main` (Python under `mem0/`). Read: `memory/main.py`, `configs/prompts.py`, `memory/storage.py`.

**Headline: dedup is model-judged similarity + an exact-md5 gate; no derived backlog. Ingestion is ADD-only.**

- **Unit:** LLM-extracted **facts** (not raw messages). For each `add()`: embed the turn, pull the
  **top-10 nearest existing memories** (scoped by `user_id`/`agent_id`/`run_id`), hand them to a single
  **ADD-only** LLM call (`ADDITIVE_EXTRACTION_PROMPT`) told to *skip semantically-equivalent facts and link
  instead*. Primary dedup is **LLM-semantic**.
- **Deterministic layer:** `mem_hash = hashlib.md5(text).hexdigest()`; dropped if
  `mem_hash in existing_hashes or seen_hashes`. So **md5 IS a dedup key** — but only for byte-identical text.
- **Store:** vector-store payload (`id` uuid4, `data`, `hash`, embedding, `text_lemmatized`, timestamps,
  scope keys) + a SQLite **`history`** table logging `ADD`/`UPDATE`/`DELETE` events (`old_memory`→`new_memory`).
- **Supersession:** none at ingest (ADD-only). The classic ADD/UPDATE/DELETE/NONE adjudicator
  (`DEFAULT_UPDATE_MEMORY_PROMPT`, `get_update_memory_messages`) is **present but dead code on `main`**,
  referenced only by tests; UPDATE/DELETE happen only via the explicit `update()`/`delete()` APIs.

---

## Comparison matrix (8 systems read at code level)

| System (★) | Backlog concept | State location | "Already ingested?" key | Hash read back? | Re-ingest on change | Rename robustness |
|---|---|---|---|---|---|---|
| **wiki-master** | **Yes** (`unsummarized`) | Derived (link graph) | **Wikilink *resolves*** | ❌ cosmetic | ❌ none (spec'd) | ❌ none |
| llm-wiki-agent (3.2k) | No (push) | Cache + derived | Abs path (per-run) | ⚠️ refresh only (buggy) | ✅ hash-diff (buggy) | ❌ breaks silently |
| turbovault (140) | No | Derived (git+in-mem) | Path in git tree | ⚠️ OCC token / snapshot | ✅ git commit diff | ✅ atomic link-rewrite |
| neurostack (45) | Implicit | **Persistent SQLite** | **`content_hash` row** | ✅ primary key | ✅ hash-diff + baseline | ✅ stable-ID (UUID filename) |
| khoj (36k) | Implicit | **Persistent pgvector** | **`md5(compiled)` row** | ✅ primary key | ✅ hash set-diff | ❌ none (filename in hash) |
| R2R (7.9k) | Status query | **Persistent Postgres** | **`document_id` + status** | ❌ no hash (UUID5 id) | ⚠️ delete-then-reingest | ⚠️ UUID5 (content/filename seed) |
| basic-memory (3.5k) | Scan/status | **Persistent SQLite** | **`checksum` vs row** | ✅ change/move key | ✅ checksum scan | ✅ **move-detect + stable UUID** |
| mem0 (61k) | No | **Persistent vec+SQLite** | semantic + `md5` | ✅ md5 exact-dup key | ✅ (ADD-only) | n/a (id-based) |

**Five distinct answers to "what needs ingesting":** (a) don't track — push-based (llm-wiki-agent);
(b) git is the ledger, commit-diff feed (turbovault); (c) **content-hash row + skip-unchanged**
(neurostack, khoj, basic-memory — the majority, and the most-adopted); (d) **explicit status column +
deterministic ID** (R2R); (e) model-judged similarity + exact-hash (mem0). *Ours is a sixth thing* —
derive from whether a fuzzy wikilink resolves — and it is the only one that manufactures phantom backlog.

**Recurring "cosmetic hash" smell:** a hash computed and stored but never read appears in wiki-master
(`source-hash`), llm-wiki-agent (`ingest.py`), neurostack (`chunks.content_hash`), and khoj's unconstrained
`hashed_value` (trusted, unindexed) — but every one of those systems except wiki-master *also* keeps a
second hash that IS a key. wiki-master keeps only the cosmetic one.

**Rename robustness — three working strategies observed:** stable-ID filename (neurostack UUID;
basic-memory `external_id`), atomic link-rewrite at write time (turbovault), or content-hash move-detection
that preserves the row (basic-memory). wiki-master uses none.

---

## Popularity (GitHub, pulled 2026-07-21)

| Repo | ★ Stars | Forks | Created | Mechanism family |
|---|---:|---:|---|---|
| mem0ai/mem0 | 61,370 | 7,141 | 2023-06 | semantic + md5 |
| run-llama/llama_index | 50,979 | 7,784 | 2022-11 | docstore hash |
| khoj-ai/khoj | 35,908 | 2,319 | 2021-08 | hash set-diff |
| stanford-oval/storm | 30,178 | 2,826 | 2024-03 | (article gen) |
| getzep/graphiti | 29,003 | 2,929 | 2024-08 | (temporal KG) |
| iterative/dvc | 15,768 | 1,312 | 2017-03 | md5 in `dvc.lock` |
| reorproject/reor | 8,566 | 530 | 2023-11 | (local index) |
| SciPhi-AI/R2R | 7,935 | 641 | 2024-02 | status + UUID5 |
| basicmachines-co/basic-memory | 3,469 | 233 | 2024-12 | checksum + UUID |
| SamurAIGPT/llm-wiki-agent | 3,235 | 375 | 2023-04 | *no backlog* |
| Epistates/turbovault | 140 | 24 | 2025-10 | git-as-ledger |
| raphasouthall/neurostack | 45 | 3 | 2026-03 | content_hash row |

**Reading:** every widely-adopted system that tracks ingestion (mem0, llama_index, khoj, R2R,
basic-memory, dvc) keys on a **content hash, document ID, or explicit status column in a persistent
store** — none derive it from link resolution. The content-hash-store pattern (neurostack, which we
liked) is the *same* one the 30k–60k★ projects use. **Caveats:** popularity ≠ correctness; stars track
adoption/marketing. The three repos *our own design cited* (llm-wiki-agent, turbovault, neurostack) are
the least-proven of the set, and turbovault (2025-10) / neurostack (2026-03) are very young with noisy
star counts.

---

## External reference patterns (documented, not code-audited here)

- **LlamaIndex `IngestionPipeline`** — persisted **docstore keyed by `doc_id` + content `hash`**;
  each run compares hashes, **skips unchanged**, upserts changed (`docstore_strategy =
  UPSERTS | DUPLICATES_ONLY | UPSERTS_AND_DELETE`). Canonical RAG "what's ingested" = hash diff vs store.
- **DVC** — `dvc.lock` records an md5 per output; `dvc status` reports stale stages by hash diff.
- **Make / Bazel / Ninja** — target up-to-date if output exists and inputs unchanged (Make by mtime,
  Bazel/Ninja by content hash; modern tools moved off mtime for reliability). `make -n` = the backlog.
- **Git** — content-addressed; the blob/tree hash *is* identity; presence in the object store = tracked.

---

## Systems analyzed / queued

- **Analyzed (code-level):** llm-wiki-agent, turbovault, neurostack, khoj, R2R, basic-memory, mem0.
- **Analyzed (conceptual):** LlamaIndex, DVC, Make/Bazel/Ninja, Git.
- **Queued (candidates, not yet read):** getzep/graphiti (temporal-KG node/edge dedup), reorproject/reor
  (local AI notes auto-index), neuml/txtai, Obsidian Smart Connections (embedding cache keyed by
  hash/mtime), Zotero (dedup by hash/DOI), Nix store / Bazel remote cache (content-addressed builds).

## Open questions (deferred — not resolved in this study)

- Is our clip/ingest split (raw ≠ summarized) worth keeping, or should ingest be auto-on-clip
  (neurostack/turbovault style) so there is no backlog to track?
- If we keep the split: derive backlog from a hash join, adopt a stable-ID reference, or maintain
  link coherence at write time (the three sibling strategies) — or a combination?
