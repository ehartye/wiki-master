# Hash-based ingest-state tracking — Design Spec

**Date:** 2026-07-21
**Status:** Implemented (v0.4.0) — recommended §9 decisions confirmed. Transitional
link-resolution fallback in place; follow-up removes it once vaults are migrated.
**Author:** Design conversation (grounded in `research/2026-07-21-ingest-state-prior-art.md`)

---

## 1. Summary

Replace wiki-master's **inferred** ingest-state signal — "a raw source is ingested iff a
`wiki/sources/` wikilink *resolves* to it" — with a **content-hash join**: a raw clipping is ingested
iff its `source-hash` appears in the `source-hashes` set recorded by some `wiki/sources/` page.

This is the mechanism the most-adopted prior art converges on (khoj, neurostack, basic-memory, DVC,
LlamaIndex all key ingest-state on a content hash in a store; see the prior-art study). It keeps
wiki-master's **"derive, never store twice"** doctrine intact — state is still derived at read time,
but from a robust key (the sha256 we already compute) carried *in the markdown itself*, not from a
fuzzy, human-authored link string. It also implements, for free, the long-specified-but-unbuilt
**re-ingest guard** (`source-hash` `# re-ingest only when this changes`, `2026-07-15-wiki-master-design.md:163`).

### Problem being fixed

The current metric (`scripts/lib/graph.mjs:262-274`, `unsummarizedSources`) reported **172** backlog
items of which **~0** genuinely needed ingesting. Two root causes, both structural:

1. **Hash-suffix mismatch (80 items).** Clippings are named `Title-<hash7>.md`; source pages cite
   `[[Title]]` without the suffix, so `resolveLinkTarget` can't bridge them and the clipping reads as
   un-ingested despite having a real summary page.
2. **Binaries counted as sources (92 items).** The backlog universe is `path.startsWith('raw/')` for
   *all* extensions; a `.pdf`/`.xlsx`/`.zip` can never receive a `wiki/sources/` citation by design
   (the pipeline summarizes the `.md` clipping, not the binary), so every binary is a permanent
   false-positive.

### What changes (one line)

Source pages gain a machine key (`source-hashes`); the backlog metric becomes a **hash set-diff**
over `.md` clippings only; both root causes disappear and re-ingest-on-change comes along for free.

---

## 2. Design principles (retained)

- **Derive, never store twice** (`skills/wiki-maintainer/SKILL.md:139-144`). No new persisted ledger,
  no state file, no DB. The hash key lives in the markdown frontmatter (single source of truth); the
  backlog is still computed at read time from the vault, exactly as `index.md` is regenerated.
- **`raw/` is immutable.** Clippings are never edited or moved to record state.
- **Concurrency-safe.** No read-modify-write on a shared state file (the reason a filesystem ledger
  was rejected originally) — the key is co-located with each page and merges cleanly under git.
- **Content hash = mechanical identity; the agent does judgment.** This mirrors the two agent-maintained
  prior-art systems (llm-wiki-agent, neurostack): a deterministic hash ledger underneath, the LLM
  reserved for semantic work (summarizing, reconciling, healing). We are moving mechanical bookkeeping
  *off* the agent-authored wikilink and onto a deterministic key.

---

## 3. Schema changes

### 3.1 `wiki/sources/*` frontmatter — add `source-hashes`

```yaml
---
type: source
created: 2026-07-17
updated: 2026-07-17
reviewed: 2026-07-17
status: maintained
sources: ["[[A Survey of Procedural Content Generatio]]"]   # UNCHANGED — human/Obsidian navigation
source-hashes: ["b87e4014e65dabc21456303650c015a02c2cfecc355db4b2a07c8cc02c924680"]  # NEW — machine key
quality: high
ai-generated: true
---
```

- **`source-hashes`**: a list (set semantics) of the **full sha256** `source-hash` of each raw clipping
  this page summarizes. One entry per cited clipping. Multi-source pages list several.
- **`sources`** (the `[[wikilink]]`) is **retained unchanged** — it drives Obsidian's graph and human
  navigation. It is no longer load-bearing for ingest-state. (Decision §9-D2.)
- Rationale for the full 64-char hash (not the 7-char suffix): exact identity, zero collision risk,
  and it matches the value already in each clipping's `source-hash` frontmatter — a direct equality join.

### 3.2 `raw/clippings/*` frontmatter — no change

Clippings already carry `source-hash: <sha256>` (`scripts/clip.mjs:105,269`). This becomes a *read*
field for the first time. No write-path change to the clippers.

### 3.3 `templates/vault-schema.md` and `skills/wiki-maintainer/SKILL.md`

Update the source-page schema and the **"Has this been ingested?"** section to state the new contract:
*a raw clipping is ingested iff its `source-hash` is listed in some `wiki/sources/` page's
`source-hashes`.* (Replaces "iff a `wiki/sources/` page cites it".)

---

## 4. The metric (`scripts/lib/graph.mjs`)

Replace the link-resolution body of `unsummarizedSources` with a hash set-diff.

```js
// The set of every clipping-hash claimed by a summary page.
const ingestedHashes = new Set();
for (const p of pages) {
  if (!p.path.startsWith('wiki/sources/')) continue;
  for (const h of (p.frontmatter?.['source-hashes'] ?? [])) ingestedHashes.add(String(h).toLowerCase());
}

// Every ingestable raw unit = a .md clipping carrying a source-hash.
// Binaries (.pdf/.xlsx/.docx/.zip) are NOT ingestable units — the pipeline
// summarizes their .md representation — and are excluded from the universe.
const clippingHash = new Map();       // path -> source-hash
const missingHash = [];               // .md clippings with no source-hash (defensive)
for (const p of pages) {
  if (!p.path.startsWith('raw/') || !p.path.endsWith('.md')) continue;
  const h = p.frontmatter?.['source-hash'];
  if (!h) { missingHash.push(p.path); continue; }
  clippingHash.set(p.path, String(h).toLowerCase());
}

// Backlog = clippings whose content hash no summary page has recorded.
// A re-clipped clipping gets a new hash, so it naturally reappears here
// (the khoj/neurostack set-diff property → re-ingest-on-change, for free).
const unsummarizedSources = [...clippingHash]
  .filter(([, h]) => !ingestedHashes.has(h))
  .map(([path]) => path);
```

Notes:
- **`buildGraph` must parse `source-hash` and `source-hashes` into `p.frontmatter`.** Today the parser
  reads only `status/type/created/updated` (`graph.mjs:57-60`); extend it to retain these two keys.
  (List parsing: accept YAML flow `["…","…"]` and block-sequence forms.)
- `unparsedSources` (`inbound === 0`) is orthogonal (structural orphan check) and stays as-is, but is
  **no longer** the ingest signal. Keep it for the health report; it will no longer collide with backlog.
- **Binary handling:** the universe is now `raw/**/*.md` only. `raw/**/*.{pdf,xlsx,docx,zip}` are dropped
  from the backlog entirely. (This alone removes 92 of the 172.)
- **`missingHash`** is surfaced as a new health line (should be empty; defensive against a hand-added or
  legacy clipping lacking `source-hash`).

### 4.1 Optional secondary metric — `orphanedSummaries` (nice-to-have, low priority)

Source pages listing a `source-hashes` value that matches **no** current clipping (clipping deleted or
superseded by a re-clip). Reuses the same two maps; report-only, unscored. Defer unless cheap.

---

## 5. Write path (`skills/wiki-ingest`)

When `/wiki-ingest` creates or updates a `wiki/sources/<slug>.md`, it must record the `source-hash` of
each clipping it summarizes into `source-hashes`.

- Add a step to the ingest workflow: "read each source clipping's `source-hash` frontmatter; write the
  full value(s) into the new page's `source-hashes` list."
- Provide a tiny helper (or extend an existing lib) `readSourceHash(clippingPath)` so the skill/agent
  doesn't hand-copy a 64-char string. Consider a `scripts/lib/frontmatter.mjs` reader if one isn't
  already shared (the graph parser can export it).
- Keep writing `sources: [[…]]` as today (navigation). **Recommendation:** standardize the wikilink to
  the hash-qualified path form `[[raw/clippings/Title-hash7.md]]` going forward (the newest batch
  already does this) — it makes the human link exact too — but this is cosmetic now that the hash is
  authoritative. (Decision §9-D2.)

---

## 6. Migration / backfill

~706 existing source pages cite by bare title with no `source-hashes`. One-time, idempotent script
`scripts/backfill-source-hashes.mjs`:

1. For each `wiki/sources/*.md` lacking `source-hashes`:
   a. Resolve each `sources: [[…]]` wikilink to a `raw/` clipping via the **existing** `resolveLinkTarget`
      (path-qualified first, then bare basename).
   b. Read the resolved clipping's `source-hash`; collect into `source-hashes`.
   c. Write the field back (preserve all other frontmatter; append the new key).
2. **Ambiguity/failure handling** (do NOT guess):
   - Wikilink resolves to >1 candidate (bare-basename collision) → **skip, log to a review list**.
   - Wikilink resolves to nothing → skip, log.
   - Resolved clipping has no `source-hash` → skip, log.
3. Emit a report: `{written, skipped-ambiguous, skipped-unresolved, skipped-nohash}` with the paths.
   The skipped set is the human-review queue (feed to triage).

Backfill is safe to re-run; it only fills pages still missing the key.

### 6.1 Transitional dual-signal (avoid regression during backfill)

Until backfill coverage is 100%, the metric credits a clipping as ingested if **either** (a) its hash is
in `ingestedHashes`, **or** (b) a legacy `wiki/sources/` wikilink resolves to it (the old path). Report a
`backfillPending` count = source pages still lacking `source-hashes`. Once `backfillPending === 0`, delete
the fallback branch (a follow-up cleanup PR). (Decision §9-D3.)

---

## 7. Downstream consumers (no interface change)

- **`scripts/triage.mjs`** consumes `computeGraphMetrics(...).unsummarizedSources` (`triage.mjs:60-62`)
  and `backlogTotal` — same field name, so the triage backlog immediately becomes accurate. Update the
  group's "why" text: *"in raw/, but no summary page records their content hash."*
- **`scripts/health.mjs`** (`:52-62`) reports `unparsedSources`/`unsummarizedSources`/`provenanceGaps` —
  unchanged field names; add `missingHash` and `backfillPending` lines.
- **No change** to the health *score* weighting (topology-based, per turbovault-mirrored model).

---

## 8. Test plan (TDD — write first)

Fixture-vault unit tests in `test/` (mirrors `test/clip-*.test.mjs` style):

1. **Hash-join backlog.** Clipping with `source-hash: H`; a source page with `source-hashes: [H]` →
   NOT in backlog. Same clipping, no matching source page → in backlog.
2. **Hash-suffix immunity.** Clipping file `Title-abc1234.md` (hash H) + source page citing
   `[[Title]]` (bare) but with `source-hashes: [H]` → NOT in backlog. (The exact regression that
   produced the 80.)
3. **Binary exclusion.** `raw/x.pdf`, `raw/x.xlsx`, `raw/clippings/ref-docs-staging/y.zip` → never in
   backlog regardless of citations.
4. **Re-ingest-on-change.** Clipping hash changes H→H'; source page still lists H → clipping reappears
   in backlog (set-diff property).
5. **Multi-source page.** `source-hashes: [H1, H2]` covers two clippings → both ingested.
6. **Missing-hash guard.** `.md` clipping with no `source-hash` → excluded from backlog, listed in
   `missingHash`.
7. **Backfill.** Given legacy pages (bare wikilink, no `source-hashes`), backfill populates the field
   for unambiguous cases and logs ambiguous/unresolved ones without writing.
8. **Transitional fallback.** Pre-backfill page (no `source-hashes`, legacy resolvable wikilink) → its
   clipping not double-counted as backlog; `backfillPending` reflects it.

**Acceptance:** run against the live vault; `unsummarizedSources` drops from 172 to the true residual
(expected ≈ 0 after backfill), with `missingHash` and `backfillPending` both 0.

---

## 9. Decisions to confirm before implementation

| # | Decision | Recommendation | Alternative (and cost) |
|---|---|---|---|
| **D1** | Where does ingest-state live? | **Derive from `source-hashes` in frontmatter** (single source of truth; honors "derive, never store twice"; concurrency-safe) | External ledger (`.wiki-master/ingest-index.json` / SQLite) — matches khoj/neurostack literally, but violates the doctrine, adds a second source of truth that races under multi-machine sync |
| **D2** | Key carrier | **Dedicated `source-hashes:` field**, keep `sources: [[…]]` for navigation | Encode the key only in a hash-qualified wikilink `[[raw/clippings/T-hash7.md]]` — lighter, no new field, but re-couples state to link resolution (weaker) |
| **D3** | Migration | **Transitional dual-signal**, then drop fallback at 100% | Big-bang: backfill then hard-switch — simpler code, but any un-backfilled page regresses to phantom backlog until fixed |
| **D4** | Full vs 7-char hash on source page | **Full sha256** (exact equality with clipping frontmatter) | 7-char prefix — smaller, but reintroduces collision risk and needs prefix-matching |

All four recommendations are internally consistent and, together, are the minimal change that fixes both
root causes while honoring the existing architecture. If you confirm the recommended column, the next
artifact is an implementation plan (TDD task breakdown) against `graph.mjs`, `wiki-ingest`, the backfill
script, and the schema/docs.

---

## 10. Out of scope

- Changing the clip/ingest split (the deliberate raw≠summarized funnel that *creates* the backlog
  concept). Retained — it is what distinguishes wiki-master from auto-index-everything systems.
- Rename-coherence of the `sources: [[…]]` navigation link (turbovault-style atomic rewrite). Not needed:
  the hash key is rename-immune, so a stale navigation wikilink is now cosmetic, not a desync.
- Any change to the health *score* or the semantic `lint` pass.
