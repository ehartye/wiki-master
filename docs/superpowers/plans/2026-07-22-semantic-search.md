# Semantic search — Implementation Plan

> **How to use this doc:** task-by-task, in order, strict TDD (write the failing test, run it,
> watch it fail for the *stated* reason, implement the minimal code, run it again, commit) — the
> convention this repo's other `docs/superpowers/plans/*.md` already follow. Steps use `- [ ]` so
> progress is trackable.

**Goal:** give `/wiki-query` a real semantic retrieval layer without adding a hard dependency,
per the confirmed spec decisions (D1 approved, D2 `qmd` optional/CLI-only, D5 "no vector database"
read as no-service/no-daemon, not no-embedded-index).

**Architecture:** three tiers, each degrading to the next — `qmd` (optional, CLI-detected) →
Ollama embedding + brute-force cosine, reusing the existing embedding cache → `obsidian search`
keyword (always available). A new `scripts/search.mjs` owns the ranking/tiering logic, mirroring
how `index-gen.mjs` centralizes catalog logic and `drift.mjs` centralizes drift logic. The one
existing consumer of search, `/wiki-query`, is repointed at it.

**Tech stack:** Node ESM (`type: module`), `node --test`, the existing `obsidian` CLI and
`scripts/lib/embed.mjs` Ollama client (both unchanged in behavior).

**Spec:** `docs/superpowers/specs/2026-07-22-semantic-search-design.md` (decisions D1/D2/D5
confirmed by the user 2026-07-22; D3/D4 — extend `/wiki-query` in place, `wiki/`-only corpus —
carried through unchanged as the spec's own low-controversy recommendation).

**Prior art:** `docs/superpowers/research/2026-07-22-semantic-search-prior-art.md`

**Verification already done in this planning pass (not yet committed):** the core pure functions
below (`semanticSearch`, `mergeRRF`, `qmdAvailable`, the `search()` tiering orchestrator) were
prototyped in a scratch directory outside the repo and run under `node --test` — all 10 tests
passed before being written into this plan. The code in Tasks 1–2 below is that verified code, not
untested pseudocode. Task 3 (real `qmd` JSON parsing) is explicitly **not** verified this way — see
its warning — because it depends on a real `qmd` install this planning pass didn't have.

---

## File Structure

- **Create** `scripts/lib/embed-cache.mjs` — extracted from `drift.mjs` (hash-keyed embedding
  cache load/save + the `hash()` helper). No behavior change to `drift.mjs`.
- **Modify** `scripts/drift.mjs` — import the extracted cache helpers instead of its own private
  copies.
- **Create** `scripts/search.mjs` — `semanticSearch`, `mergeRRF`, `qmdAvailable`, `qmdSearch`,
  `search` (tiering orchestrator), `main()` CLI.
- **Create** `test/search.test.mjs`.
- **Modify** `skills/wiki-query/SKILL.md` — replace the raw `obsidian search` step with a call to
  the new script.

---

## Task 0: Extract the embedding cache so `drift.mjs` and `search.mjs` share one implementation

**Why first:** `search.mjs` needs the exact same content-hash-keyed cache `drift.mjs` already
writes to `.wiki-master/embeddings.json` — reusing it (not a parallel copy) is what makes a page
`drift.mjs` already embedded free for `search.mjs` to rank, and vice versa. Duplicating
`loadCache`/`saveCache`/`hash` into `search.mjs` would work but leaves two copies to keep in sync.

**Files:**
- Create: `scripts/lib/embed-cache.mjs`
- Modify: `scripts/drift.mjs`
- Test: existing `test/drift.test.mjs` must stay green unmodified (confirmed by direct read: it
  imports only `computeDrift`, never the private cache functions, so this refactor is behavior-only
  and needs no new test of its own)

- [ ] **Step 1: Run the existing drift tests to record the baseline**

Run: `npm test -- test/drift.test.mjs` (or `node --test test/drift.test.mjs`)
Expected: PASS (all current drift tests green) — this is the regression guard for this task.

- [ ] **Step 2: Create `scripts/lib/embed-cache.mjs`**

```js
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function hash(text) { return createHash('sha256').update(text).digest('hex'); }

export function loadCache(dir) {
  const f = join(dir, 'embeddings.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}

export function saveCache(dir, cache) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'embeddings.json'), JSON.stringify(cache));
}
```

(Byte-for-byte the logic already in `drift.mjs` today — a pure extraction, not a rewrite.)

- [ ] **Step 3: Update `scripts/drift.mjs` to import instead of define these**

Remove `drift.mjs`'s own `loadCache`/`saveCache`/`hash` (currently private, module-level) and add:

```js
import { hash, loadCache, saveCache } from './lib/embed-cache.mjs';
```

- [ ] **Step 4: Run the drift tests again — must be byte-identical pass**

Run: `node --test test/drift.test.mjs`
Expected: PASS, same test count as Step 1. If anything changes, the extraction wasn't behavior-only
— stop and diff against the original functions rather than pushing forward.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/embed-cache.mjs scripts/drift.mjs
git commit -m "refactor: extract embedding cache from drift.mjs for reuse by search.mjs"
```

---

## Task 1: `scripts/search.mjs` — ranking core (`semanticSearch`, `mergeRRF`)

**Files:**
- Create: `scripts/search.mjs`
- Create: `test/search.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/search.test.mjs` (first part — more tests are appended in later tasks, do not run
`qmdAvailable`/`search` tests yet, they land in Task 2):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semanticSearch, mergeRRF } from '../scripts/search.mjs';

// A trivial 2D embedding space so cosine similarity is hand-verifiable: vectors
// pointing the same direction as the query score 1; orthogonal score 0.
const VEC = { query: [1, 0], same: [1, 0], orthogonal: [0, 1], opposite: [-1, 0] };
const embedFn = async (text) => VEC[text];

test('semanticSearch ranks by cosine similarity, descending', async () => {
  const pages = [
    { path: 'a.md', body: 'orthogonal' },
    { path: 'b.md', body: 'same' },
    { path: 'c.md', body: 'opposite' },
  ];
  const results = await semanticSearch('query', pages, { embedFn });
  assert.deepEqual(results.map((r) => r.path), ['b.md', 'a.md', 'c.md']);
  assert.equal(results[0].score, 1);
});

test('semanticSearch respects topN', async () => {
  const pages = [
    { path: 'a.md', body: 'orthogonal' },
    { path: 'b.md', body: 'same' },
    { path: 'c.md', body: 'opposite' },
  ];
  const results = await semanticSearch('query', pages, { embedFn, topN: 1 });
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'b.md');
});

test('semanticSearch reuses the cache: an already-cached hash is never re-embedded', async () => {
  let calls = 0;
  const countingEmbed = async (text) => { calls++; return VEC[text]; };
  const cache = {};
  const pages = [{ path: 'a.md', body: 'same' }];
  await semanticSearch('query', pages, { embedFn: countingEmbed, cache });
  const callsAfterFirst = calls;
  await semanticSearch('query', pages, { embedFn: countingEmbed, cache });
  // Second run re-embeds the query (always fresh) but not the unchanged page body.
  assert.equal(calls, callsAfterFirst + 1, 'only the query re-embeds; the cached page body does not');
});

test('mergeRRF combines two ranked lists, deduplicated, by reciprocal rank', () => {
  const keyword = ['x.md', 'y.md'];
  const semantic = ['y.md', 'z.md'];
  const merged = mergeRRF([keyword, semantic]);
  const paths = merged.map((r) => r.path);
  assert.deepEqual(new Set(paths), new Set(['x.md', 'y.md', 'z.md']), 'every page appears exactly once');
  // y.md is ranked in BOTH lists (rank 2 keyword, rank 1 semantic) so it must
  // outscore x.md/z.md, each ranked in only one list.
  assert.equal(paths[0], 'y.md');
});

test('mergeRRF is deterministic given the same input', () => {
  const a = mergeRRF([['x.md', 'y.md'], ['y.md', 'z.md']]);
  const b = mergeRRF([['x.md', 'y.md'], ['y.md', 'z.md']]);
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/search.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/search.mjs'`.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/search.mjs` (this much of it — `qmdAvailable`/`qmdSearch`/`search`/`main` are added
in Tasks 2–3, do not add them yet):

```js
import { cosine } from './lib/embed.mjs';
import { hash } from './lib/embed-cache.mjs';

// Ranks every candidate page's (cached-or-freshly-embedded) vector against one
// query embedding. `pages` is [{path, body}]; `cache` is the SAME hash-keyed map
// drift.mjs already populates in .wiki-master/embeddings.json (Task 0) — an
// unchanged page is never re-embedded, whether drift.mjs or search.mjs embedded
// it first. `body` must be hashed the same way drift.mjs hashes it (full file
// content, frontmatter included — see drift.mjs's own `body` variable) or the
// two features' cache entries will never hit each other.
export async function semanticSearch(query, pages, { embedFn, cache = {}, topN = 10 } = {}) {
  const qVec = await embedFn(query);
  const scored = [];
  for (const p of pages) {
    const h = hash(p.body);
    const vec = cache[h] ?? (cache[h] = await embedFn(p.body));
    scored.push({ path: p.path, score: cosine(qVec, vec) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

// Reciprocal Rank Fusion (Cormack et al. 2009): merges N ranked path lists into
// one. k=60 is the standard constant — large enough that rank 1 vs rank 2 in a
// single list differ only slightly, so no one channel dominates purely by
// having placed a result first.
const RRF_K = 60;
export function mergeRRF(lists) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach((path, i) => {
      scores.set(path, (scores.get(path) ?? 0) + 1 / (RRF_K + i + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path, score]) => ({ path, score }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/search.test.mjs`
Expected: PASS — all 5 tests green; run the FULL suite (`npm test`) too and confirm no regressions
(Task 0's drift tests in particular).

- [ ] **Step 5: Commit**

```bash
git add scripts/search.mjs test/search.test.mjs
git commit -m "feat: add scripts/search.mjs — semantic ranking + RRF merge (ranking core only)"
```

---

## Task 2: `qmd` detection + the tiering orchestrator

**Files:**
- Modify: `scripts/search.mjs` (append)
- Modify: `test/search.test.mjs` (append)

- [ ] **Step 1: Append the failing tests**

Add to `test/search.test.mjs`:

```js
import { qmdAvailable, search } from '../scripts/search.mjs'; // extend the existing import line

test('qmdAvailable reflects whether the probe command succeeds', () => {
  assert.equal(qmdAvailable(() => {}), true);
  assert.equal(qmdAvailable(() => { throw new Error('not found'); }), false);
});

test('search: qmd tier wins when qmd is available and succeeds', async () => {
  const r = await search('q', {
    keywordSearch: async () => { throw new Error('should not be called'); },
    qmdProbe: () => true,
    qmdRun: async () => [{ path: 'qmd-result.md' }],
    ollamaAvailable: async () => true,
    semanticRun: async () => { throw new Error('should not be called'); },
  });
  assert.equal(r.tier, 'qmd');
  assert.deepEqual(r.results, [{ path: 'qmd-result.md' }]);
});

test('search: falls back to hybrid when qmd is absent but Ollama is available', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    qmdProbe: () => false,
    qmdRun: async () => { throw new Error('should not be called'); },
    ollamaAvailable: async () => true,
    semanticRun: async () => [{ path: 's.md', score: 0.9 }],
  });
  assert.equal(r.tier, 'hybrid');
  assert.deepEqual(new Set(r.results.map((x) => x.path)), new Set(['k.md', 's.md']));
});

test('search: falls back to keyword-only when both qmd and Ollama are unavailable', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    qmdProbe: () => false,
    qmdRun: async () => { throw new Error('should not be called'); },
    ollamaAvailable: async () => false,
    semanticRun: async () => { throw new Error('should not be called'); },
  });
  assert.equal(r.tier, 'keyword');
  assert.deepEqual(r.results, [{ path: 'k.md' }]);
});

test('search: a qmd runtime failure (present but broken) falls through to the next tier', async () => {
  const r = await search('q', {
    keywordSearch: async () => ['k.md'],
    qmdProbe: () => true,
    qmdRun: async () => { throw new Error('qmd index corrupt'); },
    ollamaAvailable: async () => false,
    semanticRun: async () => { throw new Error('should not be called'); },
  });
  assert.equal(r.tier, 'keyword', 'a broken qmd degrades gracefully rather than erroring out');
});
```

- [ ] **Step 2: Run to verify these fail**

Run: `npm test -- test/search.test.mjs`
Expected: FAIL — `qmdAvailable`/`search` are not exported yet.

- [ ] **Step 3: Append the implementation**

Add to `scripts/search.mjs`:

```js
// Mirrors init.mjs's defuddleAvailable() exactly: try the command, ignore
// stdio, catch -> false. qmd is never a package.json dependency — only ever
// detected on PATH, the same relationship this codebase already has with
// Ollama and Defuddle (present -> used; absent -> the next tier down).
export function qmdAvailable(execImpl) {
  try { execImpl('qmd --version'); return true; } catch { return false; }
}

// The tiering ladder, isolated from real I/O behind injected deps so it is
// unit-testable without a live qmd/Ollama/Obsidian. `keywordSearch` always
// runs when needed (obsidian search always works or the vault is broken
// anyway); `qmdRun`/`semanticRun` are each optional and independently probed.
// A qmd that is PRESENT but fails at runtime (corrupt index, model load
// error) falls through rather than surfacing a hard error from what is by
// design an optional accelerator, not a load-bearing dependency.
export async function search(query, deps) {
  const { keywordSearch, qmdProbe, qmdRun, ollamaAvailable, semanticRun } = deps;
  if (qmdProbe()) {
    try {
      return { tier: 'qmd', results: await qmdRun(query) };
    } catch { /* fall through to the next tier */ }
  }
  const keywordHits = await keywordSearch(query);
  if (await ollamaAvailable()) {
    const semanticHits = await semanticRun(query);
    return { tier: 'hybrid', results: mergeRRF([keywordHits, semanticHits.map((h) => h.path)]) };
  }
  return { tier: 'keyword', results: keywordHits.map((path) => ({ path })) };
}
```

- [ ] **Step 4: Run to verify all pass**

Run: `npm test -- test/search.test.mjs` then the full `npm test`.
Expected: PASS — 10 tests total in `search.test.mjs`; no regressions elsewhere.

- [ ] **Step 5: Commit**

```bash
git add scripts/search.mjs test/search.test.mjs
git commit -m "feat: search.mjs qmd detection + graceful tiering (qmd -> hybrid -> keyword)"
```

---

## Task 3: Real I/O wiring — `qmdSearch`, `qmdAvailable()` bound to `execSync`, and `main()`

**⚠️ Not verified against a real `qmd` install in this planning pass — confirm before writing
tests that assert a specific JSON shape.** The qmd README documents `--json`/`--files` output
"designed for agentic workflows" and an MCP `query` tool returning a `file` field per hit, but this
plan does not have a live `qmd` to confirm the bare-CLI `--json` field names against. **First
sub-step here must be exploratory, not TDD**: install `qmd` (`npm install -g @tobilu/qmd`, Node
≥22 required for this install step only — it is not wiki-master's own runtime), index a small
sample directory, run `qmd query "test" --json`, and read the actual output shape before writing
`qmdSearch`'s parsing logic or any test that asserts field names. Everything below is the shape of
the work, not confirmed field-level code.

**Files:**
- Modify: `scripts/search.mjs` (append `qmdSearch`, `main`)
- Modify: `test/search.test.mjs` (append — real shape TBD per the warning above)

- [ ] **Step 1: Spike — confirm qmd's actual `--json` output shape**

```bash
npm install -g @tobilu/qmd   # requires Node >=22 in whatever shell runs this — unrelated to
                             # wiki-master's own Node >=18, since qmd is invoked as an external
                             # CLI subprocess, never imported in-process (spec §4)
qmd collection add ./test/fixtures/vault --name probe
qmd embed
qmd query "provenance" --json -n 3   # <-- read this output; it decides qmdSearch's parsing code
```

Record the real field names actually seen (expected candidates per the README: a `file` field
holding a `qmd://collection/path`-style URI, and a relevance `score`) before writing Step 3.

- [ ] **Step 2: Write the failing test(s), using the shape confirmed in Step 1**

Sketch only — replace `<field names from Step 1>` before this is real:

```js
test('qmdSearch parses qmd --json output into {path, score} results', () => {
  const fakeExec = () => JSON.stringify({ results: [{ /* <field names from Step 1> */ }] });
  const results = qmdSearch('q', { execImpl: fakeExec });
  assert.ok(results.every((r) => typeof r.path === 'string'));
});
```

Run: `npm test -- test/search.test.mjs` → expect FAIL (`qmdSearch` not exported yet).

- [ ] **Step 3: Implement `qmdSearch` and `main()`**

```js
import { execSync } from 'node:child_process';
// ... (existing imports)

// Shells out to qmd exactly as `obsidian`/`defuddle` are invoked elsewhere in
// this codebase: an external CLI, never an in-process import — qmd's own
// Node >=22 engine requirement is never wiki-master's constraint (spec §4).
// Field-mapping below MUST match Task 3 Step 1's confirmed real output.
export function qmdSearch(query, { execImpl = execSync, limit = 10 } = {}) {
  const out = execImpl(`qmd query ${JSON.stringify(query)} --json -n ${limit}`, { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  return parsed.results.map((r) => ({ path: /* confirmed field */ r.file, score: r.score }));
}

export async function main(query, { vaultPath, limit = 10 } = {}) {
  // Real dependency wiring for the `search()` orchestrator from Task 2:
  //  - qmdProbe:      () => qmdAvailable((cmd) => execSync(cmd, { stdio: 'ignore' }))
  //  - qmdRun:         (q) => qmdSearch(q, { limit })
  //  - keywordSearch:  (q) => obsidian(['search', `query=${q}`, 'path=wiki', `limit=${limit}`, 'format=json']) parsed as JSON
  //  - ollamaAvailable: the existing embed.mjs isAvailable()
  //  - semanticRun:    (q) => semanticSearch(q, <all current wiki/ pages, gathered the same way
  //                     drift.mjs's main() does: obsidian(['files','ext=md']), filtered to
  //                     isContent(path) && path.startsWith('wiki/'), each read via readFileSync>,
  //                     { embedFn: cachedEmbed, cache, topN: limit }), reusing loadCache/saveCache
  //                     from Task 0 exactly as drift.mjs's main() does around its own cachedEmbed.
  // Left as prose here rather than fully-written code: this function is glue over pieces already
  // written and tested (Tasks 0-2) plus drift.mjs's own proven main()-wiring pattern; write it
  // directly against that pattern rather than re-deriving it, and add a thin integration test
  // (stub obsidian()/embed()/execSync) once written.
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , ...args] = process.argv;
  main(args.join(' '), { vaultPath: resolveVault().path }).then((r) => {
    console.log(`(${r.tier})`);
    for (const hit of r.results) console.log(`  ${hit.path}`);
  });
}
```

- [ ] **Step 4: Run to verify pass; then the full suite**

Run: `npm test` — Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add scripts/search.mjs test/search.test.mjs
git commit -m "feat: search.mjs real I/O wiring (qmd CLI, Ollama cache, obsidian keyword search)"
```

---

## Task 4: Point `/wiki-query` at the new script

Prose-only edit (no test — matches how the log-folder plan's Task 3 treats skill-prose changes).

**Files:** `skills/wiki-query/SKILL.md`

- [ ] **Step 1: Replace the retrieval step**

Find:

```
1. Search the wiki: `obsidian search query="..." path=wiki limit=10 format=json`
   (PowerShell — see obsidian-cli skill; never default to `search:context`, and
   probe `total` before trusting an empty result). Read the most relevant pages.
```

Replace with:

```
1. Search the wiki: `node ../../scripts/search.mjs "..."` (resolved relative to this
   skill's own directory). Reports which tier answered (`qmd`/`hybrid`/`keyword`) —
   mention it if it's `keyword` (Ollama/qmd unavailable, results are keyword-only).
   Read the most relevant pages returned.
```

- [ ] **Step 2: Verify no other skill/doc references the now-superseded direct call**

Run: `grep -rn 'obsidian search query=.*path=wiki' skills templates`
Expected: no matches (empty).

- [ ] **Step 3: Commit**

```bash
git add skills/wiki-query/SKILL.md
git commit -m "docs: point /wiki-query at scripts/search.mjs instead of raw obsidian search"
```

---

## Task 5: Full verification + PR

- [ ] **Step 1: Full suite**

Run: `npm test` — Expected: PASS (every existing suite + all new `search.test.mjs` cases; the one
pre-existing unrelated `clip-xlsx.test.mjs` failure, if still present on `main` at implementation
time, is not this task's to fix).

- [ ] **Step 2: Smoke test against the real vault (manual, not automated)**

```bash
node scripts/search.mjs "provenance"
```

Expected: prints a tier line and a handful of ranked `wiki/` paths; confirm the tier matches what's
actually available in the shell (Ollama running with `nomic-embed-text` pulled → `hybrid`; also
`qmd` installed and indexed → `qmd`; neither → `keyword`).

- [ ] **Step 3: Cold-cache honesty check**

On a vault/cache without a prior `drift`/`search` run, time a first `hybrid`-tier call and confirm
it reports progress (per spec §4's "known, honest cost" — do not ship this silent). If `main()` as
written doesn't yet report progress, add it here before calling this task done — this was named
explicitly in the spec as a UX requirement, not a nice-to-have.

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin <branch>
gh pr create --fill
```

---

## Explicit non-goals (carried from the spec, restated so this plan isn't read as silently dropping them)

- No `/wiki-search` skill — this plan only repoints `/wiki-query`'s existing step.
- No `raw/` indexing — `wiki/` pages only.
- No use of `qmd`'s MCP server mode — CLI invocation only.
- No change to `drift.mjs`'s own behavior beyond the Task 0 extraction (same inputs, same outputs,
  same cache file format).
