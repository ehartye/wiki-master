# `/wiki-purge` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use h-superpowers:subagent-driven-development, h-superpowers:team-driven-development, or h-superpowers:executing-plans to implement this plan (ask user which approach). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/wiki-purge <topic>` — find every artifact belonging to a topic, move it to a git-tracked `.recycle/` bin, record the move in an append-only manifest, commit it, and re-bin anything that comes back.

**Architecture:** Pure planning functions in `scripts/lib/purge.mjs` (closure computation, manifest building, reconcile planning) take plain data and return plans — no filesystem, no git. `scripts/purge.mjs` owns all side effects (moves, restore, CLI) and `scripts/lib/git.mjs` owns the commit. This mirrors `scripts/lib/backfill.mjs` + `scripts/backfill-source-hashes.mjs`, the closest existing pair in the repo.

**Tech Stack:** Node 20+ ESM, `node --test` (built-in runner, no framework), `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-08-wiki-purge-design.md`

---

## Background an engineer needs before starting

**What this vault is.** An Obsidian vault at `$WIKI_MASTER_VAULT` (default `~/.wiki-master-vault`) holding markdown. `raw/clippings/` holds immutable captured sources; `wiki/{sources,entities,concepts,syntheses,authored}` holds pages derived from them; `moc/` holds navigational hubs; `index.md` is a generated catalog; `log/` holds one file per operation. Pages cite provenance as `sources: [[raw/clippings/Foo.md]]` in frontmatter.

**The two link channels — this trips people up.** `buildGraph` gives each page `outTargets` (wikilinks found in the body) and `fmTargets` (wikilinks found in frontmatter). They resolve differently: body links use `resolveLinkTarget(byName, t, { nav: true })` and frontmatter links use `resolveLinkTarget(byName, t)` (nav defaults false). See `graph.mjs:315-316` for the existing precedent — copy that convention exactly, do not pick one for both.

**Page shape** returned by `buildGraph(vaultPath)` — a flat array, each entry:
```
{ path, name, title, type, status, created, updated, sourceHash, sourceHashes,
  words, outTargets, fmTargets, declaresNoSources }
```
`path` is vault-relative with forward slashes. `name` is the lowercased basename without `.md`.

**Run the tests** with `npm test` (which is `node --test`). A single file: `node --test test/purge.test.mjs`.

**Never run the `obsidian` binary from the Bash tool on Windows** — use the PowerShell tool. Git Bash does not apply `PATHEXT` and silently selects the GUI binary, which prints nothing and exits 0. Only Task 1 runs `obsidian` at all.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/purge.mjs` (create) | Pure. `isStructural`, `inboundMap`, `planPurge`, `binPathFor`, `buildManifest`, `planReconcile`. No `node:fs`, no `child_process`. |
| `scripts/lib/git.mjs` (create) | Pure-ish wrapper: `isGitRepo`, `commitAll`, `push`. The only place this repo shells out to git. |
| `scripts/purge.mjs` (create) | Side effects + CLI: `applyPurge`, `applyRestore`, `main`. |
| `test/purge.test.mjs` (create) | Closure, manifest, bin-path tests. |
| `test/purge-reconcile.test.mjs` (create) | Reconcile tests. |
| `test/purge-apply.test.mjs` (create) | Move/restore/e2e tests against temp vaults. |
| `test/git.test.mjs` (create) | `lib/git.mjs` against a temp repo. |
| `skills/wiki-purge/SKILL.md` (create) | The skill. |
| `skills/wiki-maintainer/SKILL.md` (modify) | One contract line for `.recycle/`. |
| `templates/vault-schema.md` (modify) | `.recycle/` in the layout list. |
| `README.md` (modify) | Command list. |
| `CHANGELOG.md`, `package.json`, `plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (modify) | Version 0.9.0. |

**Explicitly not modified:** `drift.mjs`, `stale.base`, `search.mjs`, `graph.mjs`. Spec §4 establishes they already exclude the bin via anchored `wiki/` prefix filters and the leading-dot walk skip. Do not add guards to them.

---

### Task 1: Verify the Obsidian dot-folder assumption

The whole exclusion design assumes Obsidian's indexer ignores dot-prefixed folders. This was never confirmed live (Obsidian was not running during design). Confirm it before anything depends on it.

**Files:** none — this is a measurement.

- [ ] **Step 1: Make sure Obsidian is running**

Open Obsidian with the wiki-master vault loaded. The CLI launches it if absent, but launching mid-probe muddies the result.

- [ ] **Step 2: Plant a probe file**

Use the **PowerShell tool**:

```powershell
$v = "$env:USERPROFILE\.wiki-master-vault"
New-Item -ItemType Directory -Force "$v\.recycle\probe-task1\wiki\concepts" | Out-Null
Set-Content "$v\.recycle\probe-task1\wiki\concepts\Probe.md" "# Probe`n`nzzqqxx-purge-probe-token"
Start-Sleep -Seconds 5
```

- [ ] **Step 3: Ask Obsidian three questions**

```powershell
obsidian vault=.wiki-master-vault search query="zzqqxx-purge-probe-token"
(obsidian vault=.wiki-master-vault files ext=md) -split "`n" | Where-Object { $_ -like "*probe-task1*" }
obsidian vault=.wiki-master-vault search query="the" total
```

Expected if the assumption holds: the first two print nothing, the third prints a number (proving the backend is alive, so the empties are real answers rather than a dead CLI — see the `obsidian-cli` skill's "Empty is not an answer" rule).

- [ ] **Step 4: Remove the probe**

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.wiki-master-vault\.recycle"
```

- [ ] **Step 5: Record the result**

If both queries were empty: note "verified 2026-08-08" in the spec's §8 and continue to Task 2. Nothing else changes.

If either query returned the probe: Obsidian **does** index dot-folders. Add Task 1b before continuing.

- [ ] **Step 6 (Task 1b, only if the probe was found): Write the userIgnoreFilters fallback**

Modify `scripts/init.mjs` to merge `.recycle` into `userIgnoreFilters` in `.obsidian/app.json`, and add the same one-time instruction to `skills/wiki-init/SKILL.md`. Test:

```js
test('init adds .recycle to userIgnoreFilters without clobbering existing entries', () => {
  const app = mergeIgnoreFilter({ userIgnoreFilters: ['Archive/'] });
  assert.deepEqual(app.userIgnoreFilters, ['Archive/', '.recycle']);
});
```

- [ ] **Step 7: Commit the result either way**

```bash
git add docs/superpowers/specs/2026-08-08-wiki-purge-design.md
git commit -m "docs: verify Obsidian dot-folder indexing for .recycle bin"
```

---

### Task 2: `isStructural` and `inboundMap`

**Files:**
- Create: `scripts/lib/purge.mjs`
- Create: `test/purge.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStructural, inboundMap } from '../scripts/lib/purge.mjs';
import { buildNameIndex } from '../scripts/lib/graph.mjs';

// Structural pages link everything (index.md catalogs the vault; a MOC exists to
// point at pages). If they counted as "an outside page references this", nothing
// would ever qualify for the closure and purge would only ever move its seeds.
test('isStructural covers the catalog, MOCs, the log and templates', () => {
  assert.equal(isStructural('index.md'), true);
  assert.equal(isStructural('log.md'), true);
  assert.equal(isStructural('vault-schema.md'), true);
  assert.equal(isStructural('moc/audio-moc.md'), true);
  assert.equal(isStructural('log/2026-08-08-120000-ingest-foo.md'), true);
  assert.equal(isStructural('_templates/source-note.md'), true);
});

test('isStructural excludes real content and evidence', () => {
  assert.equal(isStructural('wiki/concepts/Alpha.md'), false);
  assert.equal(isStructural('raw/clippings/Src-abc1234.md'), false);
  assert.equal(isStructural('raw/attachments/fig-9f8e7d6.png'), false);
});

test('inboundMap credits a body link to its target, following nav resolution', () => {
  const pages = [
    { path: 'wiki/concepts/A.md', name: 'a', outTargets: ['B'], fmTargets: [] },
    { path: 'wiki/concepts/B.md', name: 'b', outTargets: [], fmTargets: [] },
  ];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('wiki/concepts/B.md')], ['wiki/concepts/A.md']);
  assert.deepEqual([...inbound.get('wiki/concepts/A.md')], []);
});

test('inboundMap credits a frontmatter sources: link to the raw clipping it cites', () => {
  const pages = [
    { path: 'wiki/sources/S.md', name: 's', outTargets: [], fmTargets: ['raw/clippings/Src-abc1234.md'] },
    { path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', outTargets: [], fmTargets: [] },
  ];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('raw/clippings/Src-abc1234.md')], ['wiki/sources/S.md']);
});

// A page linking to itself must not make itself look externally referenced.
test('inboundMap ignores self-links', () => {
  const pages = [{ path: 'wiki/concepts/A.md', name: 'a', outTargets: ['A'], fmTargets: [] }];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('wiki/concepts/A.md')], []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/purge.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/lib/purge.mjs'`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/purge.mjs`:

```js
import { resolveLinkTarget } from './graph.mjs';

// Pages that exist to point at other pages. index.md catalogs everything and a
// MOC's whole job is linking, so an inbound edge from one carries no evidence
// that the target belongs to a topic. They are excluded from the "is anything
// outside the set referencing this?" test — never from being purged, which a
// seed can still do explicitly.
const STRUCTURAL_FILES = new Set(['index.md', 'log.md', 'vault-schema.md']);
const STRUCTURAL_PREFIXES = ['moc/', 'log/', '_templates/'];

export function isStructural(path) {
  return STRUCTURAL_FILES.has(path) || STRUCTURAL_PREFIXES.some((p) => path.startsWith(p));
}

// Inverts the graph: target path -> set of page paths linking to it. The two
// link channels resolve differently and mixing them up silently mis-attributes
// provenance edges — body wikilinks ask the navigation question (nav: true),
// `sources:` frontmatter asks the provenance question (nav: false). Same
// convention as graph.mjs:315-316.
export function inboundMap(pages, byName) {
  const inbound = new Map(pages.map((p) => [p.path, new Set()]));
  const add = (from, target, nav) => {
    const to = resolveLinkTarget(byName, target, { nav });
    if (to && to !== from && inbound.has(to)) inbound.get(to).add(from);
  };
  for (const p of pages) {
    for (const t of p.outTargets ?? []) add(p.path, t, true);
    for (const t of p.fmTargets ?? []) add(p.path, t, false);
  }
  return inbound;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/purge.test.mjs`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/purge.mjs test/purge.test.mjs
git commit -m "feat(purge): structural-page classification and inbound link map"
```

---

### Task 3: `planPurge` — the bounded closure

This is the task where a mistake destroys the user's work. The closure only grows through "every non-structural page referencing this is already in the set."

**Files:**
- Modify: `scripts/lib/purge.mjs`
- Modify: `test/purge.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `test/purge.test.mjs`:

```js
import { planPurge } from '../scripts/lib/purge.mjs';

// The shape a closure test needs: a topic cluster, a clipping shared with an
// off-topic page, a page outside the topic that links in, and an unrelated orphan.
function topicVault() {
  return [
    { path: 'index.md', name: 'index', outTargets: ['Topic Concept', 'Outside Page', 'Unrelated'], fmTargets: [] },
    { path: 'wiki/concepts/Topic Concept.md', name: 'topic concept', outTargets: [], fmTargets: ['raw/clippings/Only-aaa1111.md'] },
    { path: 'wiki/sources/Topic Source.md', name: 'topic source', outTargets: ['Topic Concept'], fmTargets: ['raw/clippings/Shared-bbb2222.md'] },
    { path: 'raw/clippings/Only-aaa1111.md', name: 'only-aaa1111', outTargets: [], fmTargets: [], sourceHash: 'aaa1111' },
    { path: 'raw/clippings/Shared-bbb2222.md', name: 'shared-bbb2222', outTargets: [], fmTargets: [], sourceHash: 'bbb2222' },
    { path: 'wiki/syntheses/Offtopic.md', name: 'offtopic', outTargets: [], fmTargets: ['raw/clippings/Shared-bbb2222.md'] },
    { path: 'wiki/concepts/Outside Page.md', name: 'outside page', outTargets: ['Topic Concept'], fmTargets: [] },
    { path: 'wiki/concepts/Unrelated.md', name: 'unrelated', outTargets: [], fmTargets: [] },
  ];
}

test('a clipping cited only by purged pages joins the set', () => {
  const r = planPurge({ pages: topicVault(), seedPaths: ['wiki/concepts/Topic Concept.md'] });
  assert.ok(r.purge.includes('raw/clippings/Only-aaa1111.md'));
});

// The destructive failure this whole rule exists to prevent.
test('a clipping shared with an off-topic page is NEVER purged', () => {
  const r = planPurge({
    pages: topicVault(),
    seedPaths: ['wiki/concepts/Topic Concept.md', 'wiki/sources/Topic Source.md'],
  });
  assert.ok(!r.purge.includes('raw/clippings/Shared-bbb2222.md'));
  assert.ok(!r.purge.includes('wiki/syntheses/Offtopic.md'));
});

test('a page linked from outside the set lands on collateral, not in the bin', () => {
  const r = planPurge({ pages: topicVault(), seedPaths: ['wiki/concepts/Topic Concept.md'] });
  assert.ok(!r.purge.includes('wiki/concepts/Outside Page.md'));
  // Two survivors, for different reasons, and BOTH are collateral:
  //   Outside Page  — links [[Topic Concept]] from outside the topic.
  //   Topic Source  — nothing links to it, so refs.length === 0 and it is never
  //                   admitted; but its body links [[Topic Concept]], which IS
  //                   purged, so it is left holding a dangling link.
  // Collateral is "survives but references purged content" (spec §5) — how a
  // page came to survive is irrelevant to whether it needs repair.
  assert.deepEqual(r.collateral, ['wiki/concepts/Outside Page.md', 'wiki/sources/Topic Source.md']);
});

// index.md links everything. If it counted as an outside referent the closure
// would never grow past its seeds; if it counted as collateral every purge would
// report the catalog as needing repair. It is regenerated, not repaired.
test('the catalog is neither a referent nor collateral', () => {
  const r = planPurge({ pages: topicVault(), seedPaths: ['wiki/concepts/Topic Concept.md'] });
  assert.ok(!r.collateral.includes('index.md'));
  assert.ok(!r.purge.includes('index.md'));
});

// A MOC is excluded from the REFERENT test (it links everything, so an edge from
// one proves nothing about topic membership) but must still appear as collateral:
// isContent('moc/x.md') is true, so health.mjs counts its broken links, and
// nothing regenerates a MOC the way index-gen.mjs regenerates the catalog. The
// log and templates stay out — the log is an immutable audit trail.
test('a MOC linking into the set is collateral; the catalog, log and templates are not', () => {
  const pages = [
    { path: 'index.md', name: 'index', outTargets: ['Topic'], fmTargets: [] },
    { path: 'moc/Topic MOC.md', name: 'topic moc', outTargets: ['Topic'], fmTargets: [] },
    { path: 'log/2026-08-08-120000-ingest-topic.md', name: '2026-08-08-120000-ingest-topic', outTargets: ['Topic'], fmTargets: [] },
    { path: 'wiki/concepts/Topic.md', name: 'topic', outTargets: [], fmTargets: [] },
  ];
  const r = planPurge({ pages, seedPaths: ['wiki/concepts/Topic.md'] });
  assert.deepEqual(r.collateral, ['moc/Topic MOC.md']);
});

// Guardrail #1: raw/ bodies are immutable, so a raw clipping citing a purged
// page is never ours to repair and must not be reported as repair work.
test('a raw clipping is never collateral', () => {
  const pages = [
    { path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', outTargets: ['Topic'], fmTargets: [], sourceHash: 'abc1234' },
    { path: 'wiki/concepts/Topic.md', name: 'topic', outTargets: [], fmTargets: [] },
  ];
  const r = planPurge({ pages, seedPaths: ['wiki/concepts/Topic.md'] });
  assert.deepEqual(r.collateral, []);
});

test('an unreferenced page unrelated to the topic is not swept in', () => {
  const r = planPurge({ pages: topicVault(), seedPaths: ['wiki/concepts/Topic Concept.md'] });
  assert.ok(!r.purge.includes('wiki/concepts/Unrelated.md'));
});

// Guardrail #2: a page whose entire provenance was purged is a claim with no
// evidence. Purge must not decide that silently in either direction.
test('a page losing all provenance is reported as blocking', () => {
  const pages = [
    { path: 'wiki/sources/S.md', name: 's', outTargets: [], fmTargets: ['raw/clippings/E-ccc3333.md'] },
    { path: 'raw/clippings/E-ccc3333.md', name: 'e-ccc3333', outTargets: [], fmTargets: [], sourceHash: 'ccc3333' },
  ];
  const r = planPurge({ pages, seedPaths: ['raw/clippings/E-ccc3333.md'] });
  assert.deepEqual(r.blocking, ['wiki/sources/S.md']);
});

test('a page keeping at least one source is not blocking', () => {
  const pages = [
    { path: 'wiki/sources/S.md', name: 's', outTargets: [],
      fmTargets: ['raw/clippings/E-ccc3333.md', 'raw/clippings/Keep-ddd4444.md'] },
    { path: 'raw/clippings/E-ccc3333.md', name: 'e-ccc3333', outTargets: [], fmTargets: [], sourceHash: 'ccc3333' },
    { path: 'raw/clippings/Keep-ddd4444.md', name: 'keep-ddd4444', outTargets: [], fmTargets: [], sourceHash: 'ddd4444' },
  ];
  const r = planPurge({ pages, seedPaths: ['raw/clippings/E-ccc3333.md'] });
  assert.deepEqual(r.blocking, []);
});

// A clipping's wikilink counts as an outside referent and protects its target.
// Deliberately NOT graph.mjs:309's source-side exclusion: an edge from immutable
// captured text is weak evidence, but ignoring it purges a page graph.mjs would
// have left alone — the over-match direction this design refuses. 78 of the 1100
// clippings in the live vault carry [[...]], so this is a real condition.
test('a raw clipping linking to a page protects it from the closure', () => {
  const pages = [
    { path: 'wiki/concepts/Seed.md', name: 'seed', outTargets: ['Length'], fmTargets: [] },
    { path: 'wiki/concepts/Length.md', name: 'length', outTargets: [], fmTargets: [] },
    { path: 'raw/clippings/Spec-abc1234.md', name: 'spec-abc1234', outTargets: ['Length'], fmTargets: [] },
  ];
  const r = planPurge({ pages, seedPaths: ['wiki/concepts/Seed.md'] });
  assert.ok(!r.purge.includes('wiki/concepts/Length.md'));
});

// Comparing two runs over the SAME array order is trivially equal for any pure
// function and tests nothing. What matters is that a vault enumerated in a
// different order — NTFS is alphabetical, ext4 is hash-ordered — yields the same
// purge set, or two machines bin different files. Use a fixture with a real
// bare-name collision across the content/evidence line, which is the only case
// buildNameIndex's first-writer-wins behavior can expose.
test('the plan is order-independent and sorted, across every array order of a colliding fixture', () => {
  const base = [
    { path: 'raw/clippings/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'wiki/sources/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'wiki/concepts/Citer.md', name: 'citer', outTargets: [], fmTargets: ['Foo'] },
  ];
  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  const results = permutations.map((order) =>
    planPurge({ pages: order.map((i) => base[i]), seedPaths: ['wiki/concepts/Citer.md'] }).purge
  );
  for (const r of results) {
    assert.deepEqual(r, results[0], 'array order must not change which files are purged');
    assert.deepEqual(r, [...r].sort());
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/purge.test.mjs`
Expected: FAIL — `planPurge is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/lib/purge.mjs`:

```js
import { buildNameIndex, resolveLinkTarget, isContent } from './graph.mjs';

// Grows a purge set from explicit seeds by repeatedly admitting any page whose
// every non-structural referent is already inside. Deliberately asymmetric:
// over-matching destroys work and is discovered late, under-matching leaves one
// page to delete by hand and is discovered immediately. So a page with ANY
// outside referent is never admitted — it becomes collateral instead.
//
// Returns { purge, collateral, blocking }, all sorted vault-relative paths.
//   purge      — move these
//   collateral — survive, but link into the set; their references need repair
//   blocking   — survive, but ALL their provenance is inside the set. Guardrail
//                #2 says a claim with no evidence is a defect, so purge stops
//                and asks rather than guessing.
export function planPurge({ pages: inputPages, seedPaths }) {
  // Sorted before indexing, not for tidiness: buildNameIndex is first-writer-wins
  // on the plain key, so array order decides which file a bare `sources: [[Foo]]`
  // citation resolves to — and therefore which files get binned. readdirSync is
  // alphabetical on NTFS but hash-ordered on ext4, so without this two machines
  // compute different purge sets from the same vault, defeating the cross-machine
  // convergence this feature exists for. Sorting puts raw/ before wiki/, so a bare
  // provenance citation resolves to the clipping — which is what the vault's
  // documented `sources: [[raw/clippings/X.md]]` convention means anyway.
  const pages = [...inputPages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const byName = buildNameIndex(pages);
  const inbound = inboundMap(pages, byName);
  const known = new Set(pages.map((p) => p.path));
  const set = new Set(seedPaths.filter((p) => known.has(p)));

  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pages) {
      if (set.has(p.path) || isStructural(p.path)) continue;
      const refs = [...inbound.get(p.path)].filter((r) => !isStructural(r));
      // No referent at all is not evidence of topic membership — an orphan
      // unrelated to the topic would otherwise be swept in by vacuous truth.
      if (refs.length === 0) continue;
      if (refs.every((r) => set.has(r))) {
        set.add(p.path);
        grew = true;
      }
    }
  }

  const targetsOf = (p) => [
    ...(p.outTargets ?? []).map((t) => resolveLinkTarget(byName, t, { nav: true })),
    ...(p.fmTargets ?? []).map((t) => resolveLinkTarget(byName, t)),
  ].filter(Boolean);

  // The collateral/blocking pool asks a DIFFERENT question from the refs filter
  // above ("does this page need reference repair?" vs "is this an outside
  // referent?"), so it uses a different predicate. isContent excludes index.md
  // (regenerated by index-gen.mjs, never repaired), log/ (an immutable audit
  // trail — you do not rewrite history), _templates/, and raw/ (guardrail #1:
  // raw bodies are immutable, so a dangling link there is never ours to fix).
  // It KEEPS moc/, which isStructural would have dropped — a MOC linking into
  // the purged set has real broken links, isContent('moc/x.md') is true so
  // health.mjs counts them, and nothing regenerates a MOC.
  const survivors = pages.filter((p) => !set.has(p.path) && isContent(p.path));

  const collateral = survivors
    .filter((p) => targetsOf(p).some((t) => set.has(t)))
    .map((p) => p.path)
    .sort();

  const blocking = survivors
    .filter((p) => {
      const evidence = (p.fmTargets ?? []).map((t) => resolveLinkTarget(byName, t)).filter(Boolean);
      return evidence.length > 0 && evidence.every((e) => set.has(e));
    })
    .map((p) => p.path)
    .sort();

  return { purge: [...set].sort(), collateral, blocking };
}
```

Note: merge this `import` line with the one already at the top of the file from Task 2 — one import statement from `./graph.mjs`, not two.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/purge.test.mjs`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/purge.mjs test/purge.test.mjs
git commit -m "feat(purge): bounded topic closure with collateral and blocking sets"
```

---

### Task 4: Bin paths and manifest building

**Files:**
- Modify: `scripts/lib/purge.mjs`
- Modify: `test/purge.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import { binPathFor, buildManifest, purgeId } from '../scripts/lib/purge.mjs';

// Spec §4: the dot segment must come FIRST. Every reader that is not a
// filesystem walk excludes the bin with an anchored ^wiki/ style filter
// (search.mjs, drift.mjs:61, stale.base). A layout that hoisted wiki/ to the
// front would pass those filters and re-expose every purged page.
test('binPathFor nests the original path under the dot-prefixed bin', () => {
  assert.equal(
    binPathFor('2026-08-08-topic', 'wiki/concepts/Foo.md'),
    '.recycle/2026-08-08-topic/wiki/concepts/Foo.md'
  );
});

test('every bin path fails the anchored wiki/ filters the other readers use', () => {
  const p = binPathFor('2026-08-08-topic', 'wiki/concepts/Foo.md');
  assert.equal(/^wiki\//.test(p), false);
  assert.equal(/^wiki\/(concepts|syntheses)\//.test(p), false);
  assert.equal(p.startsWith('.'), true);
});

test('binPathFor keeps raw paths distinct from wiki paths', () => {
  assert.equal(
    binPathFor('id1', 'raw/clippings/Src-abc1234.md'),
    '.recycle/id1/raw/clippings/Src-abc1234.md'
  );
});

test('purgeId slugifies the topic behind the date', () => {
  assert.equal(purgeId('Parenting / Conflict Resolution!', new Date('2026-08-08T12:00:00')),
    '2026-08-08-parenting-conflict-resolution');
});

test('buildManifest records path, hash, layer, and url per entry', () => {
  const pages = [
    { path: 'wiki/concepts/Foo.md', name: 'foo', outTargets: [], fmTargets: [] },
    { path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', outTargets: [], fmTargets: [],
      sourceHash: 'abc1234deadbeef', url: 'https://example.com/a' },
  ];
  const m = buildManifest({
    id: '2026-08-08-topic',
    topic: 'topic',
    date: '2026-08-08',
    purge: ['wiki/concepts/Foo.md', 'raw/clippings/Src-abc1234.md'],
    collateral: ['wiki/syntheses/Keep.md'],
    pages,
    hashes: { 'wiki/concepts/Foo.md': 'sha-foo', 'raw/clippings/Src-abc1234.md': 'sha-src' },
  });
  assert.equal(m.id, '2026-08-08-topic');
  assert.deepEqual(m.collateral, ['wiki/syntheses/Keep.md']);
  assert.deepEqual(m.entries[0], { layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'sha-foo' });
  assert.deepEqual(m.entries[1], {
    layer: 'raw', from: 'raw/clippings/Src-abc1234.md', sha256: 'sha-src',
    'source-hash': 'abc1234deadbeef', url: 'https://example.com/a',
  });
  assert.deepEqual(m.declines, ['https://example.com/a']);
});

test('buildManifest omits declines for clippings with no url', () => {
  const pages = [{ path: 'raw/clippings/Local-eee5555.md', name: 'local-eee5555', outTargets: [], fmTargets: [], sourceHash: 'eee5555' }];
  const m = buildManifest({
    id: 'id', topic: 't', date: '2026-08-08',
    purge: ['raw/clippings/Local-eee5555.md'], collateral: [], pages,
    hashes: { 'raw/clippings/Local-eee5555.md': 'sha' },
  });
  assert.deepEqual(m.declines, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/purge.test.mjs`
Expected: FAIL — `binPathFor is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/lib/purge.mjs`:

```js
export const BIN_DIR = '.recycle';

// The dot segment comes first, always. See the test — three readers exclude the
// bin with anchored ^wiki/ filters, and only leading-dot placement satisfies
// them together with graph.mjs's readdir dot-skip.
export function binPathFor(id, originalPath) {
  return `${BIN_DIR}/${id}/${originalPath}`;
}

export function purgeId(topic, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const slug = String(topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${day}-${slug || 'purge'}`;
}

// Keyed by BOTH path and content hash: path finds a file that came back where it
// was, `source-hash` finds one that came back under a different name. Same join
// health.mjs --backlog already uses, so it inherits a contract already proven
// against filename drift.
export function buildManifest({ id, topic, date, purge, collateral, pages, hashes }) {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const entries = purge.map((from) => {
    const page = byPath.get(from) ?? {};
    const entry = {
      layer: from.startsWith('raw/') ? 'raw' : 'wiki',
      from,
      sha256: hashes[from],
    };
    if (page.sourceHash) entry['source-hash'] = page.sourceHash;
    if (page.url) entry.url = page.url;
    return entry;
  });
  return {
    id,
    topic,
    date,
    entries,
    declines: entries.map((e) => e.url).filter(Boolean),
    collateral,
  };
}
```

`page.url` comes from the clipping's `source:` frontmatter. `buildGraph` does not currently read it — Task 7 reads it at apply time and passes enriched pages in. `buildManifest` stays pure and simply uses the field when present.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/purge.test.mjs`
Expected: PASS, 19 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/purge.mjs test/purge.test.mjs
git commit -m "feat(purge): bin path layout and manifest construction"
```

---

### Task 5: `planReconcile` — convergence across machines

**Files:**
- Modify: `scripts/lib/purge.mjs`
- Create: `test/purge-reconcile.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReconcile } from '../scripts/lib/purge.mjs';

const manifest = {
  id: '2026-08-08-topic',
  entries: [
    { layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'sha-foo' },
    { layer: 'raw', from: 'raw/clippings/Src-abc1234.md', sha256: 'sha-src',
      'source-hash': 'abc1234deadbeef', url: 'https://example.com/a' },
  ],
  declines: ['https://example.com/a'],
};

test('a file back at its original path is re-binned', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{ path: 'wiki/concepts/Foo.md', name: 'foo' }],
    declines: ['https://example.com/a'],
  });
  assert.deepEqual(r.rebin, [{ id: '2026-08-08-topic', from: 'wiki/concepts/Foo.md', reason: 'path' }]);
});

// The case a path-only ledger misses: /wiki-discover re-clips the same source
// and clip.mjs gives it a fresh -<hash7> suffix, so it returns under a new name.
test('a re-clip under a different filename is caught by source-hash', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{ path: 'raw/clippings/Src-zzz9999.md', name: 'src-zzz9999', sourceHash: 'abc1234deadbeef' }],
    declines: ['https://example.com/a'],
  });
  assert.deepEqual(r.rebin, [
    { id: '2026-08-08-topic', from: 'raw/clippings/Src-zzz9999.md', reason: 'source-hash' },
  ]);
});

// declined.json lives under .wiki-master/, which the vault's .gitignore
// excludes — it does not sync. Replaying manifest declines locally is the only
// thing that carries a purge's declines to another machine.
test('a decline missing from the local store is replayed', () => {
  const r = planReconcile({ manifests: [manifest], pages: [], declines: [] });
  assert.deepEqual(r.replayDeclines, ['https://example.com/a']);
});

test('a decline already present is not replayed', () => {
  const r = planReconcile({ manifests: [manifest], pages: [], declines: ['https://example.com/a'] });
  assert.deepEqual(r.replayDeclines, []);
});

test('a clean vault yields an empty plan', () => {
  const r = planReconcile({ manifests: [manifest], pages: [], declines: ['https://example.com/a'] });
  assert.deepEqual(r.rebin, []);
  assert.deepEqual(r.replayDeclines, []);
});

// Applying a plan removes rebinned files from the live set (they land in
// dot-skipped .recycle/) and adds replayed declines to the store. Convergence
// means re-planning after that yields nothing — the spec's actual sentence.
// Hand-building a second input instead would pass even if applying the first
// plan produced something reconcile disagreed with.
function apply({ pages, declines }, plan) {
  const moved = new Set(plan.rebin.map((r) => r.from));
  return {
    pages: pages.filter((p) => !moved.has(p.path)),
    declines: [...declines, ...plan.replayDeclines],
  };
}

function roundsToConverge(state, manifests, max = 5) {
  const counts = [];
  for (let i = 0; i < max; i += 1) {
    const plan = planReconcile({ ...state, manifests });
    counts.push(plan.rebin.length);
    if (!plan.rebin.length && !plan.replayDeclines.length) break;
    state = apply(state, plan);
  }
  return counts;
}

test('reconcile converges in one application — path match', () => {
  const state = { pages: [{ path: 'wiki/concepts/Foo.md', name: 'foo' }], declines: [] };
  assert.deepEqual(roundsToConverge(state, [manifest]), [1, 0]);
});

test('reconcile converges in one application — hash match', () => {
  const state = {
    pages: [{ path: 'raw/clippings/Src-zzz9999.md', name: 'src-zzz9999', sourceHash: 'abc1234deadbeef' }],
    declines: [],
  };
  assert.deepEqual(roundsToConverge(state, [manifest]), [1, 0]);
});

// Two live clippings sharing a source-hash is a real condition — dedupe.mjs
// groups on exactly this key, and the live vault has two such groups. A
// last-write-wins hash index binned only one per pass, so reconcile reported
// success while the vault still disagreed with its manifest.
test('duplicate source-hash clippings all bin in ONE pass', () => {
  const state = {
    pages: [
      { path: 'raw/clippings/Src-dup1111.md', name: 'src-dup1111', sourceHash: 'abc1234deadbeef' },
      { path: 'raw/clippings/Src-dup2222.md', name: 'src-dup2222', sourceHash: 'abc1234deadbeef' },
    ],
    declines: [],
  };
  assert.deepEqual(roundsToConverge(state, [manifest]), [2, 0]);
});

test('duplicate source-hash rebin order is identical across input orders', () => {
  const a = { path: 'raw/clippings/Src-dup1111.md', name: 'src-dup1111', sourceHash: 'abc1234deadbeef' };
  const b = { path: 'raw/clippings/Src-dup2222.md', name: 'src-dup2222', sourceHash: 'abc1234deadbeef' };
  const forward = planReconcile({ manifests: [manifest], pages: [a, b], declines: [] });
  const reverse = planReconcile({ manifests: [manifest], pages: [b, a], declines: [] });
  assert.deepEqual(forward.rebin, reverse.rebin);
});

// Files already inside the bin are not live pages coming back.
test('bin contents are never treated as resurrections', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{ path: '.recycle/2026-08-08-topic/wiki/concepts/Foo.md', name: 'foo' }],
    declines: manifest.declines,
  });
  assert.deepEqual(r.rebin, []);
});

test('one entry never yields two rebin rows when path and hash both match', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{ path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', sourceHash: 'abc1234deadbeef' }],
    declines: manifest.declines,
  });
  assert.equal(r.rebin.length, 1);
  assert.equal(r.rebin[0].reason, 'path');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/purge-reconcile.test.mjs`
Expected: FAIL — `planReconcile is not a function`

- [ ] **Step 3: Write the implementation**

Append to `scripts/lib/purge.mjs`:

```js
// Convergence, not cleanup. A purge is a fact recorded in a manifest; a vault
// that disagrees with the manifest is a vault that has drifted — on any machine,
// for any reason (an uncommitted restore, a merge that kept a modified file, a
// re-clip). Reconcile makes the vault agree again, and says nothing when it
// already does.
export function planReconcile({ manifests, pages, declines }) {
  // Belt-and-braces, not load-bearing: buildGraph's walk skips every dot-prefixed
  // entry, so pages from the real collector can never contain a .recycle/ path —
  // measured from the other side too, since Obsidian's own indexer ignores the
  // bin. Kept because planReconcile is a pure function whose caller could pass
  // anything, and because a future collector that forgets to dot-skip would
  // otherwise make reconcile treat its own bin as a vault full of resurrections.
  const live = sortedByPath(pages.filter((p) => !p.path.startsWith(`${BIN_DIR}/`)));
  const byPath = new Map(live.map((p) => [p.path, p]));
  // A MULTIMAP, not last-write-wins: two live clippings can genuinely share a
  // source-hash (dedupe.mjs exists to find exactly that, and the live vault has
  // two such groups today). Keeping only one made reconcile need a second pass
  // to bin the other — so it reported success while the vault still disagreed
  // with its manifest — and made the choice of which one depend on filesystem
  // order. sortedByPath then fixes the row order across machines.
  const byHash = new Map();
  for (const p of live) {
    if (!p.sourceHash) continue;
    const h = p.sourceHash.toLowerCase();
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(p);
  }

  const rebin = [];
  const seen = new Set();
  const knownDeclines = new Set((declines ?? []).map((d) => d.toLowerCase()));
  const replayDeclines = [];

  // Earliest purge claims a contested path. Sorted here, not trusted from the
  // caller: ids are date-prefixed, and `seen` makes iteration order decide which
  // bin a resurrected file returns to. A page purged, restored, and purged again
  // appears in two manifests by construction — the exact resurrection scenario
  // this feature exists for. Relational comparator, not localeCompare, for the
  // same reason sortedByPath uses one: locale-dependent collation would put
  // cross-machine divergence back in a form no single-machine test can catch.
  for (const m of [...manifests].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    for (const e of m.entries ?? []) {
      // Path first: it is the exact identity. Only fall through to the hash when
      // nothing sits at the original path, or a re-clip and its original would
      // both report and the caller would move one file twice.
      if (byPath.has(e.from) && !seen.has(e.from)) {
        seen.add(e.from);
        rebin.push({ id: m.id, from: e.from, reason: 'path' });
        continue;
      }
      const h = e['source-hash']?.toLowerCase();
      for (const hit of (h ? byHash.get(h) ?? [] : [])) {
        if (seen.has(hit.path)) continue;
        seen.add(hit.path);
        rebin.push({ id: m.id, from: hit.path, reason: 'source-hash' });
      }
    }
    for (const url of m.declines ?? []) {
      if (!knownDeclines.has(url.toLowerCase())) {
        knownDeclines.add(url.toLowerCase());
        replayDeclines.push(url);
      }
    }
  }
  return { rebin, replayDeclines };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/purge-reconcile.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/purge.mjs test/purge-reconcile.test.mjs
git commit -m "feat(purge): reconcile planner for cross-machine convergence"
```

---

### Task 6: `scripts/lib/git.mjs`

The only place this repo shells out to git. Hard boundary: no force, no history rewriting, no branch switching.

**Files:**
- Create: `scripts/lib/git.mjs`
- Create: `test/git.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isGitRepo, commitAll } from '../scripts/lib/git.mjs';

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-git-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

test('isGitRepo is true inside a repo and false outside one', () => {
  const repo = tempRepo();
  const plain = mkdtempSync(join(tmpdir(), 'wm-plain-'));
  try {
    assert.equal(isGitRepo(repo), true);
    assert.equal(isGitRepo(plain), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  }
});

// The bug this feature exists to fix: a working-tree change that never becomes a
// commit is not a change anything else can see. A purge stages a MOVE — a
// deletion at the original path and an addition under .recycle/ — and the bin's
// leading dot must not hide it from staging.
test('commitPaths stages a move, including into a dot-prefixed folder', () => {
  const repo = tempRepo();
  try {
    writeFileSync(join(repo, 'a.md'), 'hello\n');
    commitPaths(repo, ['a.md'], 'initial');
    mkdirSync(join(repo, '.recycle', 'id', 'wiki'), { recursive: true });
    writeFileSync(join(repo, '.recycle', 'id', 'wiki', 'a.md'), 'hello\n');
    rmSync(join(repo, 'a.md'));
    const r = commitPaths(repo, ['a.md', '.recycle/id/wiki/a.md'], 'purge: topic');
    assert.equal(r.committed, true);
    const files = execFileSync('git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' });
    assert.match(files, /a\.md/);
    assert.match(files, /\.recycle\/id\/wiki\/a\.md/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// The reason this is commitPaths and not commitAll. A vault with auto-commit
// disabled carries the user's in-progress work; a purge must not label it as
// part of the purge.
test('commitPaths leaves unrelated working-tree changes alone', () => {
  const repo = tempRepo();
  try {
    writeFileSync(join(repo, 'a.md'), 'hello\n');
    writeFileSync(join(repo, 'unrelated.md'), 'draft\n');
    commitPaths(repo, ['a.md', 'unrelated.md'], 'initial');
    writeFileSync(join(repo, 'unrelated.md'), 'draft, still being written\n');
    writeFileSync(join(repo, 'a.md'), 'purged\n');
    const r = commitPaths(repo, ['a.md'], 'purge: topic');
    assert.equal(r.committed, true);
    const files = execFileSync('git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' });
    assert.match(files, /a\.md/);
    assert.equal(/unrelated\.md/.test(files), false, 'the user\'s draft must not ride along');
    assert.deepEqual(uncommittedElsewhere(repo), ['unrelated.md']);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// This vault has filenames with em-dashes and quotes, and a topic purge can move
// hundreds of files. NUL-delimited stdin sidesteps both quoting and argv limits.
test('commitPaths handles filenames with spaces, em-dashes and quotes', () => {
  const repo = tempRepo();
  try {
    const odd = 'Gottman — R is for "Repair".md';
    writeFileSync(join(repo, odd), 'x\n');
    const r = commitPaths(repo, [odd], 'add odd name');
    assert.equal(r.committed, true);
    assert.deepEqual(uncommittedElsewhere(repo), []);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('commitPaths reports committed:false when the named paths are unchanged', () => {
  const repo = tempRepo();
  try {
    writeFileSync(join(repo, 'a.md'), 'hello\n');
    commitPaths(repo, ['a.md'], 'initial');
    assert.deepEqual(commitPaths(repo, ['a.md'], 'again'), { committed: false, reason: 'nothing to commit' });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('commitPaths refuses politely when the directory is not a repo', () => {
  const plain = mkdtempSync(join(tmpdir(), 'wm-plain-'));
  try {
    assert.deepEqual(commitPaths(plain, ['a.md'], 'x'), { committed: false, reason: 'not a git repository' });
    assert.deepEqual(uncommittedElsewhere(plain), []);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/git.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/lib/git.mjs'`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/git.mjs`:

```js
import { execFileSync } from 'node:child_process';

// The single place wiki-master touches git. Deliberately narrow: stage, commit,
// push. No force, no history rewriting, no branch switching, no merge conflict
// resolution — a vault is a user's knowledge base, and an automated tool that
// rewrites its history is a worse failure than the one this feature fixes.
function git(cwd, args, { input } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input }).trim();
}

export function isGitRepo(cwd) {
  try {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

// Stages ONLY the paths purge touched — never `git add -A`. A vault whose
// obsidian-git auto-commit is disabled accumulates unrelated edits, and sweeping
// those into a commit titled "purge: <topic>" both mislabels the user's own work
// and makes the purge non-atomic to revert, which is the recoverability the whole
// design rests on.
//
// Paths arrive NUL-delimited on stdin rather than as argv: a topic purge can move
// hundreds of files, and this vault has filenames carrying em-dashes and quotes.
// --pathspec-file-nul sidesteps both the argv length ceiling and every quoting
// question. Requires git 2.25+ (2020).
//
// `git add -- <path>` stages deletions as well as additions, which is essential
// here — half of what a purge stages is a MOVE: a deletion at the original path
// and an addition under .recycle/.
export function commitPaths(cwd, paths, message) {
  if (!isGitRepo(cwd)) return { committed: false, reason: 'not a git repository' };
  if (!paths.length) return { committed: false, reason: 'nothing to commit' };
  git(cwd, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: paths.join('\0') });
  if (git(cwd, ['diff', '--cached', '--name-only']) === '') {
    return { committed: false, reason: 'nothing to commit' };
  }
  git(cwd, ['commit', '-q', '-m', message]);
  return { committed: true, sha: git(cwd, ['rev-parse', 'HEAD']) };
}

// What purge deliberately did NOT commit, so the CLI can say so rather than
// leaving the user to discover it. Silence here would read as "the purge
// committed everything," which is exactly the wrong impression to give in a
// feature built because an uncommitted change failed to survive a sync.
export function uncommittedElsewhere(cwd) {
  if (!isGitRepo(cwd)) return [];
  return git(cwd, ['status', '--porcelain'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ''));
}

export function push(cwd) {
  if (!isGitRepo(cwd)) return { pushed: false, reason: 'not a git repository' };
  try {
    git(cwd, ['push']);
    return { pushed: true };
  } catch (err) {
    return { pushed: false, reason: (err.stderr || err.message || '').toString().trim() };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/git.test.mjs`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/git.mjs test/git.test.mjs
git commit -m "feat(purge): narrow git wrapper for committing vault mutations"
```

---

### Task 7: `applyPurge` and `applyRestore`

**Files:**
- Create: `scripts/purge.mjs`
- Create: `test/purge-apply.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPurge, applyRestore, readManifests, enrichPages } from '../scripts/purge.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

function tempVault() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-vault-'));
  mkdirSync(join(dir, 'wiki', 'concepts'), { recursive: true });
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  writeFileSync(join(dir, 'wiki', 'concepts', 'Foo.md'),
    '---\ntype: concept\nsources: ["[[raw/clippings/Src-abc1234.md]]"]\n---\n# Foo\n\nbody\n');
  writeFileSync(join(dir, 'raw', 'clippings', 'Src-abc1234.md'),
    '---\ntitle: "Src"\nsource: https://example.com/a\nsource-hash: abc1234deadbeef\n---\ntext\n');
  return dir;
}

test('applyPurge moves files under .recycle preserving their original paths', () => {
  const v = tempVault();
  try {
    const r = applyPurge(v, {
      id: '2026-08-08-topic',
      entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }],
    });
    assert.equal(existsSync(join(v, 'wiki', 'concepts', 'Foo.md')), false);
    assert.equal(existsSync(join(v, '.recycle', '2026-08-08-topic', 'wiki', 'concepts', 'Foo.md')), true);
    assert.equal(r.moved, 1);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Spec §7: a resurrection must never overwrite the original capture.
test('applyPurge parks a resurrection in resurrected-N rather than overwriting', () => {
  const v = tempVault();
  try {
    const manifest = { id: 'id', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] };
    applyPurge(v, manifest);
    writeFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'came back different\n');
    applyPurge(v, manifest);
    assert.equal(
      readFileSync(join(v, '.recycle', 'id', 'wiki', 'concepts', 'Foo.md'), 'utf8').includes('# Foo'),
      true, 'original capture untouched');
    assert.equal(
      readFileSync(join(v, '.recycle', 'id', 'resurrected-1', 'wiki', 'concepts', 'Foo.md'), 'utf8'),
      'came back different\n');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// A hash-matched resurrection is a re-clip under a NEW filename, so it never
// collides with the original capture. Without the flag it lands at the bin's top
// level, indistinguishable from a file the original purge moved there and absent
// from that folder's manifest.json — and anything auditing resurrections by
// scanning resurrected-*/ misses every re-clip.
test('a hash-matched resurrection lands in resurrected-N even though it does not collide', () => {
  const v = tempVault();
  try {
    applyPurge(v, { id: 'id', entries: [{ layer: 'raw', from: 'raw/clippings/Src-abc1234.md', sha256: 'x' }] });
    // The source returns re-clipped under a different filename.
    writeFileSync(join(v, 'raw', 'clippings', 'Src-zzz9999.md'),
      '---\ntitle: "Src"\nsource-hash: abc1234deadbeef\n---\ntext\n');
    applyPurge(v, { id: 'id', entries: [{ from: 'raw/clippings/Src-zzz9999.md' }] }, { asResurrection: true });
    assert.equal(
      existsSync(join(v, '.recycle', 'id', 'resurrected-1', 'raw', 'clippings', 'Src-zzz9999.md')), true);
    assert.equal(
      existsSync(join(v, '.recycle', 'id', 'raw', 'clippings', 'Src-zzz9999.md')), false,
      'must not sit at the bin top level beside the original capture');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('the bin is invisible to buildGraph', () => {
  const v = tempVault();
  try {
    applyPurge(v, { id: 'id', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] });
    const pages = buildGraph(v);
    assert.equal(pages.some((p) => p.path.includes('.recycle')), false);
    assert.equal(pages.some((p) => p.path === 'wiki/concepts/Foo.md'), false);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('applyRestore puts every entry back where it came from', () => {
  const v = tempVault();
  try {
    const before = readFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'utf8');
    const manifest = { id: 'id', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] };
    applyPurge(v, manifest);
    const r = applyRestore(v, manifest);
    assert.equal(readFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'utf8'), before);
    assert.equal(r.restored, 1);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('applyRestore refuses to clobber a file already at the original path', () => {
  const v = tempVault();
  try {
    const manifest = { id: 'id', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] };
    applyPurge(v, manifest);
    writeFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'newer work\n');
    const r = applyRestore(v, manifest);
    assert.equal(r.restored, 0);
    assert.deepEqual(r.skipped, ['wiki/concepts/Foo.md']);
    assert.equal(readFileSync(join(v, 'wiki', 'concepts', 'Foo.md'), 'utf8'), 'newer work\n');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

test('readManifests returns every manifest in the bin', () => {
  const v = tempVault();
  try {
    applyPurge(v, { id: 'a', entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'x' }] });
    assert.deepEqual(readManifests(v).map((m) => m.id), ['a']);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Two topics that slugify identically on the same day must not share a folder.
test('claimPurgeId suffixes rather than reusing an occupied bin folder', () => {
  const v = tempVault();
  try {
    assert.equal(claimPurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety');
    writeManifest(v, { id: '2026-08-08-ai-safety', topic: 'AI safety', entries: [] });
    assert.equal(claimPurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety-2');
    writeManifest(v, { id: '2026-08-08-ai-safety-2', topic: 'AI-safety', entries: [] });
    assert.equal(claimPurgeId(v, '2026-08-08-ai-safety'), '2026-08-08-ai-safety-3');
    // Both manifests survive — neither overwrote the other.
    assert.deepEqual(readManifests(v).map((m) => m.topic).sort(), ['AI safety', 'AI-safety']);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// The date the manifest reports must survive the suffix.
test('a suffixed id still yields the right date via slice(0, 10)', () => {
  assert.equal('2026-08-08-ai-safety-2'.slice(0, 10), '2026-08-08');
});

test('readManifests on a vault with no bin returns an empty list', () => {
  const v = tempVault();
  try {
    assert.deepEqual(readManifests(v), []);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// buildGraph does not read `source:`; the manifest needs the URL to record a
// decline, so apply-time enrichment reads it off the clipping.
test('enrichPages reads the source url off a clipping', () => {
  const v = tempVault();
  try {
    const pages = enrichPages(v, buildGraph(v));
    const clip = pages.find((p) => p.path === 'raw/clippings/Src-abc1234.md');
    assert.equal(clip.url, 'https://example.com/a');
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/purge-apply.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/purge.mjs'`

- [ ] **Step 3: Write the implementation**

Create `scripts/purge.mjs` (the CLI `main` arrives in Task 8; this task adds only the exported side-effecting functions):

```js
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { BIN_DIR, binPathFor } from './lib/purge.mjs';

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// buildGraph reads the frontmatter keys the graph needs; `source:` is not one of
// them. The manifest records a decline per purged clipping, which needs the URL,
// so read it here rather than widening the graph for one consumer.
export function enrichPages(vaultPath, pages) {
  return pages.map((p) => {
    if (!p.path.startsWith('raw/') || !p.path.endsWith('.md')) return p;
    try {
      const head = readFileSync(join(vaultPath, p.path), 'utf8').slice(0, 2000);
      const url = head.match(/^source:\s*"?(\S+?)"?\s*$/m)?.[1];
      return url ? { ...p, url } : p;
    } catch {
      return p;
    }
  });
}

function moveInto(vaultPath, from, to) {
  const dest = join(vaultPath, to);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(join(vaultPath, from), dest);
}

// Moves every manifest entry into the bin. Re-running is safe and is how
// reconcile re-bins a resurrection: when the bin slot is taken, the returning
// copy parks in resurrected-N so the original capture is never overwritten.
export function applyPurge(vaultPath, manifest, { asResurrection = false } = {}) {
  let moved = 0;
  const touched = [];
  for (const e of manifest.entries) {
    const src = join(vaultPath, e.from);
    if (!existsSync(src)) continue;
    let to = binPathFor(manifest.id, e.from);
    // `asResurrection` is set by reconcile, and it matters for the hash-matched
    // case specifically. A path-matched resurrection collides with the original
    // capture and gets diverted here anyway; a HASH-matched one is a re-clip
    // under a new filename, so it never collides — without this flag it would
    // land at the top level of the bin, indistinguishable from a file the
    // original purge moved there and absent from that folder's manifest.json.
    // Anything auditing resurrections by scanning resurrected-*/ would then
    // silently miss every re-clip.
    if (asResurrection || existsSync(join(vaultPath, to))) {
      let n = 1;
      while (existsSync(join(vaultPath, `${BIN_DIR}/${manifest.id}/resurrected-${n}/${e.from}`))) n += 1;
      to = `${BIN_DIR}/${manifest.id}/resurrected-${n}/${e.from}`;
    }
    moveInto(vaultPath, e.from, to);
    moved += 1;
    // Both sides of every move, so the caller can stage exactly what changed.
    // The destination is only known here — a resurrection diverts to
    // resurrected-<n>/ — so returning it is what lets Task 8 avoid `git add -A`.
    touched.push(e.from, to);
  }
  return { moved, touched };
}

// The inverse. A file that exists at the original path is NEVER overwritten —
// it is newer work someone did after the purge, and silently clobbering it would
// make restore the destructive operation purge was designed not to be.
export function applyRestore(vaultPath, manifest) {
  let restored = 0;
  const skipped = [];
  for (const e of manifest.entries) {
    const from = binPathFor(manifest.id, e.from);
    if (!existsSync(join(vaultPath, from))) continue;
    if (existsSync(join(vaultPath, e.from))) {
      skipped.push(e.from);
      continue;
    }
    moveInto(vaultPath, from, e.from);
    restored += 1;
  }
  return { restored, skipped };
}

// Sorted, for the same reason planPurge sorts its pages. planReconcile shares
// one `seen` set across all manifests, so when two manifests list the same path
// — a file purged, restored, and purged again — the manifest iterated FIRST
// claims it, and the resurrected copy is filed under that purge's id. Left to
// readdirSync that is filesystem order, so two machines would bin the same file
// under different ids. Sorting by id is chronological (ids begin with the date),
// so the earliest purge claiming a path wins, identically everywhere.
export function readManifests(vaultPath) {
  const binRoot = join(vaultPath, BIN_DIR);
  if (!existsSync(binRoot)) return [];
  const out = [];
  for (const id of readdirSync(binRoot).sort()) {
    const f = join(binRoot, id, 'manifest.json');
    if (!existsSync(f) || !statSync(join(binRoot, id)).isDirectory()) continue;
    try {
      out.push(JSON.parse(readFileSync(f, 'utf8')));
    } catch {
      console.error(`purge: skipping unreadable manifest ${BIN_DIR}/${id}/manifest.json`);
    }
  }
  return out;
}

export function writeManifest(vaultPath, manifest) {
  const dir = join(vaultPath, BIN_DIR, manifest.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

// purgeId slugifies free text, so "AI safety", "AI-safety" and "ai_safety" all
// yield the same id on the same day — and an all-punctuation or all-non-ASCII
// topic yields the bare `<date>-purge` fallback. Two such purges sharing a
// folder is silent data loss: writeManifest would overwrite the first manifest,
// and applyPurge's per-file guard would file the second purge's files under
// resurrected-<n>/ — reconcile's vocabulary for "this came back" — inside the
// first purge's folder. A lost manifest costs exactly what manifests are for:
// its entries never re-bin on resurrection and its declines never replay, so
// those URLs get re-discovered and re-clipped, the "re-litigated forever"
// failure decline.mjs exists to prevent.
//
// Never reuse an occupied id, even for the same topic — a second purge of one
// topic is still a second purge with its own entries. id.slice(0, 10) still
// yields the date with a suffix attached, so the manifest's `date` is unaffected.
export function claimPurgeId(vaultPath, id) {
  let candidate = id;
  let n = 2;
  while (existsSync(join(vaultPath, BIN_DIR, candidate))) candidate = `${id}-${n++}`;
  return candidate;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/purge-apply.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Run the whole suite — nothing else may regress**

Run: `npm test`
Expected: PASS, all files

- [ ] **Step 6: Commit**

```bash
git add scripts/purge.mjs test/purge-apply.test.mjs
git commit -m "feat(purge): move, restore, and manifest I/O against the bin"
```

---

### Task 8: The CLI

**Files:**
- Modify: `scripts/purge.mjs`
- Modify: `test/purge-apply.test.mjs`

Four modes: `--plan <topic>` (default — computes and prints, moves nothing), `--apply <topic>`, `--reconcile`, `--restore <id>`.

Seeds come from `scripts/search.mjs`. **Two things about its contract that are easy to get wrong:**

- `main(query, { limit })` returns **`{ tier, results }`**, not a bare array. Destructure `results`.
- Those `score` values come from **Reciprocal Rank Fusion** (`mergeRRF`, `RRF_K = 60`), so a rank-1 hit scores about `1/61 ≈ 0.016`. They are **not** cosine similarities and carry no absolute meaning — only the ordering does. Never filter them against a fixed threshold; a floor like `0.5` silently discards every result and purge does nothing. Take the top N by rank instead.

- [ ] **Step 1: Write the failing test**

```js
import { collectSeeds } from '../scripts/purge.mjs';

test('collectSeeds takes wiki pages by rank and drops raw hits', async () => {
  const fakeSearch = async () => ({
    tier: 'test',
    results: [
      { path: 'wiki/concepts/Topic.md', score: 0.0163 },
      { path: 'raw/clippings/Src-abc1234.md', score: 0.0161 },
      { path: 'wiki/concepts/Second.md', score: 0.0158 },
    ],
  });
  const seeds = await collectSeeds('topic', { searchImpl: fakeSearch });
  assert.deepEqual(seeds, ['wiki/concepts/Topic.md', 'wiki/concepts/Second.md']);
});

// RRF scores sit near 1/(60+rank). A threshold that looks reasonable for a
// cosine similarity discards everything and purge reports "nothing to plan",
// which reads like an empty topic rather than a broken filter.
test('collectSeeds does not threshold on score', async () => {
  const fakeSearch = async () => ({ tier: 'test', results: [{ path: 'wiki/concepts/A.md', score: 0.0164 }] });
  assert.deepEqual(await collectSeeds('topic', { searchImpl: fakeSearch }), ['wiki/concepts/A.md']);
});

test('collectSeeds caps the seed count', async () => {
  const results = Array.from({ length: 50 }, (_, i) => ({ path: `wiki/concepts/P${i}.md`, score: 1 / (61 + i) }));
  const seeds = await collectSeeds('topic', { searchImpl: async () => ({ tier: 't', results }), maxSeeds: 3 });
  assert.equal(seeds.length, 3);
  assert.equal(seeds[0], 'wiki/concepts/P0.md');
});
```

The `raw/` hit is dropped deliberately: clippings enter the set through the closure (rule 2, "cited only by purged pages"), never through their own keyword match, or one shared clipping ranking well would drag out evidence another topic depends on.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/purge-apply.test.mjs`
Expected: FAIL — `collectSeeds is not a function`

- [ ] **Step 3: Write `collectSeeds` and `main`**

Append to `scripts/purge.mjs`:

```js
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { planPurge, buildManifest, purgeId, planReconcile } from './lib/purge.mjs';
import { loadDeclines, recordDecline } from './lib/decline.mjs';
import { writeLogEntry } from './log-entry.mjs';
import { commitPaths, push, isGitRepo, uncommittedElsewhere } from './lib/git.mjs';
import { main as searchMain } from './search.mjs';

const MAX_SEEDS = 25;

// Seeds are wiki pages only, taken by RANK. A clipping joins through the closure
// — "every page citing it is already inside" — never through its own keyword
// score, or one shared source ranking well would drag out evidence another topic
// still needs.
//
// No score threshold, deliberately: search.mjs fuses its channels with RRF
// (mergeRRF, k=60), so a rank-1 hit scores ~1/61. Those numbers order results
// and mean nothing in absolute terms; thresholding them drops everything.
export async function collectSeeds(topic, { searchImpl = searchMain, maxSeeds = MAX_SEEDS, limit = 40 } = {}) {
  const { results = [] } = (await searchImpl(topic, { limit })) ?? {};
  return results
    .filter((h) => h.path.startsWith('wiki/'))
    .slice(0, maxSeeds)
    .map((h) => h.path);
}

function report(plan) {
  const layer = (p) => (p.startsWith('raw/') ? 'raw' : 'wiki');
  console.log(`\nPURGE PLAN — ${plan.purge.length} files\n`);
  for (const group of ['wiki', 'raw']) {
    const rows = plan.purge.filter((p) => layer(p) === group);
    if (!rows.length) continue;
    console.log(`  ${group}/ (${rows.length})`);
    for (const r of rows) console.log(`    ${r}`);
  }
  if (plan.collateral.length) {
    console.log(`\n  COLLATERAL — survive, but reference purged content (${plan.collateral.length}):`);
    for (const c of plan.collateral) console.log(`    ${c}`);
    console.log('  These need their references repaired after the move.');
  }
  if (plan.blocking.length) {
    console.log(`\n  BLOCKING — every source these cite is inside the purge set (${plan.blocking.length}):`);
    for (const b of plan.blocking) console.log(`    ${b}`);
    console.log('  A claim with no evidence is a defect (guardrail #2). Include them or keep their sources.');
  }
}

export async function main(argv) {
  const { path: vaultPath } = resolveVault();
  const mode = argv[0] ?? '--plan';
  const arg = argv.slice(1).join(' ').trim();

  if (mode === '--restore') {
    const manifest = readManifests(vaultPath).find((m) => m.id === arg);
    if (!manifest) {
      console.error(`purge: no manifest with id "${arg}"`);
      process.exitCode = 1;
      return;
    }
    const r = applyRestore(vaultPath, manifest);
    console.log(`restored ${r.restored} file(s)` + (r.skipped.length ? `; skipped ${r.skipped.length} (a file already sits at the original path)` : ''));
    for (const s of r.skipped) console.log(`  skipped: ${s}`);
    return;
  }

  if (mode === '--reconcile') {
    const manifests = readManifests(vaultPath);
    const pages = buildGraph(vaultPath);
    const plan = planReconcile({ manifests, pages, declines: loadDeclines(vaultPath).map((d) => d.url) });
    for (const r of plan.rebin) {
      // asResurrection regardless of match reason: a hash-matched re-clip has a
      // new filename and would otherwise not collide, landing at the bin's top
      // level as though the original purge had put it there.
      applyPurge(vaultPath, { id: r.id, entries: [{ from: r.from }] }, { asResurrection: true });
      console.log(`re-binned ${r.from} (matched by ${r.reason})`);
    }
    for (const url of plan.replayDeclines) recordDecline(vaultPath, url, 'purge-manifest-replay');
    console.log(`reconcile: ${plan.rebin.length} re-binned, ${plan.replayDeclines.length} decline(s) replayed`);
    return;
  }

  if (!arg) {
    console.error('purge: a topic is required — node scripts/purge.mjs --plan "<topic>"');
    process.exitCode = 1;
    return;
  }

  const pages = enrichPages(vaultPath, buildGraph(vaultPath));
  const seedPaths = await collectSeeds(arg);
  if (!seedPaths.length) {
    console.log(`purge: search returned no wiki pages for "${arg}" — nothing to plan.`);
    return;
  }
  console.log(`seeds (${seedPaths.length}):`);
  for (const s of seedPaths) console.log(`  ${s}`);
  const plan = planPurge({ pages, seedPaths });
  report(plan);

  if (mode !== '--apply') {
    console.log('\n(plan only — re-run with --apply to move these files)');
    return;
  }
  if (plan.blocking.length) {
    console.error('\npurge: refusing to apply while pages would be left with no provenance.');
    process.exitCode = 1;
    return;
  }

  const id = claimPurgeId(vaultPath, purgeId(arg));
  const hashes = Object.fromEntries(
    plan.purge.map((p) => [p, sha256(readFileSync(join(vaultPath, p), 'utf8'))])
  );
  const manifest = buildManifest({
    id, topic: arg, date: id.slice(0, 10),
    purge: plan.purge, collateral: plan.collateral, pages, hashes,
  });

  writeManifest(vaultPath, manifest);          // intent first — survives a crash mid-move
  const { moved, touched } = applyPurge(vaultPath, manifest);
  for (const url of manifest.declines) recordDecline(vaultPath, url, `purged:${id}`);
  const logPath = writeLogEntry({
    vaultPath, op: 'purge', title: arg,
    body: `Purged ${moved} file(s) to \`.recycle/${id}/\`.\n\n` +
          (manifest.collateral.length ? `Collateral needing reference repair:\n${manifest.collateral.map((c) => `- [[${c}]]`).join('\n')}\n` : ''),
  });

  console.log(`\nmoved ${moved} file(s) to .recycle/${id}/`);
  if (manifest.collateral.length) {
    console.log('NEXT: repair references on the collateral pages, then run node scripts/index-gen.mjs');
  }
  if (isGitRepo(vaultPath)) {
    // Exactly what this purge touched, and nothing else. index.md is included
    // because the catalog is regenerated after a purge; the log entry because it
    // is the audit record of it. `.wiki-master/declined.json` is deliberately
    // absent — it is gitignored and does not sync, which is precisely why the
    // manifest carries declines for reconcile to replay.
    const paths = [...new Set([
      ...touched,
      `${BIN_DIR}/${id}/manifest.json`,
      'index.md',
      logPath,
    ])];
    const c = commitPaths(vaultPath, paths, `purge: ${arg} (${id})`);
    console.log(c.committed ? `committed ${c.sha.slice(0, 7)}` : `not committed: ${c.reason}`);
    const others = uncommittedElsewhere(vaultPath);
    if (others.length) {
      console.log(`\n${others.length} other file(s) in the vault have uncommitted changes. Purge did NOT`);
      console.log('commit them — they are your work, not part of this purge:');
      for (const o of others.slice(0, 10)) console.log(`  ${o}`);
      if (others.length > 10) console.log(`  … and ${others.length - 10} more`);
    }
    console.log('\nRun `git push` from the vault (or ask the skill to) to make this purge visible to your other machines.');
  } else {
    console.log('WARNING: this vault is not a git repository — the purge is local to this machine only.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
```

Note the push: `main` never pushes on its own. Spec §6 step 8 makes pushing an outward-facing action requiring explicit confirmation, and that confirmation lives in the skill (Task 9), not in a script that could be run unattended.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/purge-apply.test.mjs`
Expected: PASS, 9 tests

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/purge.mjs test/purge-apply.test.mjs
git commit -m "feat(purge): CLI with plan, apply, reconcile and restore modes"
```

---

### Task 9: The skill

**Files:**
- Create: `skills/wiki-purge/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: wiki-purge
description: Remove a topic from the wiki for good — move its pages, its evidence, and its source URLs into a git-tracked recycle bin, commit the removal so it reaches every machine, and re-bin anything that comes back.
---

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location, the provenance guardrails,
> and the `.recycle/` contract these steps assume.

# Purging a topic

Deleting files does not remove a topic. Three things bring it back: an uncommitted
deletion that the next sync undoes, a `raw/` clipping left behind that the ingest
backlog reports forever, and a source URL that `/wiki-discover` re-finds. Purge
closes all three, and `--reconcile` closes them again on every machine.

## Steps

1. **Reconcile first.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/purge.mjs --reconcile`
   Sweeps anything an earlier purge lost. Cheap on a clean vault.

2. **Plan.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/purge.mjs --plan "<topic>"`
   Prints what would move, plus two lists that need your judgment:
   - **COLLATERAL** — pages that survive but link into the purge set. You repair
     their references in step 4.
   - **BLOCKING** — pages whose every cited source is inside the set. `--apply`
     refuses while any exist. Either add them to the purge or keep their sources.

3. **Show the user the plan and get explicit approval.** Never skip this. Purge
   moves many files at once, and the closure can reach further than expected when
   a topic is densely linked. Read the plan back grouped by layer with counts.

4. **Apply.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/purge.mjs --apply "<topic>"`
   Writes the manifest, moves the files, records declines, writes the log entry,
   and commits. Then:
   - repair references on every COLLATERAL page (the log entry lists them);
   - regenerate the catalog: `node ${CLAUDE_PLUGIN_ROOT}/scripts/index-gen.mjs`;
   - commit the repairs: `git -C <vault> add -A && git -C <vault> commit -m "purge: repair references"`.

5. **Ask before pushing.** A push publishes the removal to every machine. Ask
   plainly — "push this purge to origin?" — and run `git -C <vault> push` only on
   a yes. If the vault is not a git repo, say the purge is local to this machine.

6. **Verify.** `node ${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs` — the score must not
   drop. A fall means references were left dangling; repair them before finishing.

## Restoring

`node ${CLAUDE_PLUGIN_ROOT}/scripts/purge.mjs --restore <purge-id>` puts everything
back. It never overwrites a file that already exists at the original path — that is
newer work, and it is reported as skipped instead.

## Rules

- **Never read, cite, or count `.recycle/`.** It is excluded from every metric and
  every search by design. A page in the bin is not evidence and not a source.
- **Never hard-delete the bin.** Retention is deliberate: purge is reversible, and
  that is the only reason it is safe to run.
- **Never `--apply` without showing the plan first.**
```

- [ ] **Step 2: Verify the skill loads**

Run: `node --test` (the suite must still pass — skills are markdown, but a malformed frontmatter block breaks plugin load)

Then confirm the frontmatter parses by eye: `name` and `description` present, `---` fences on their own lines, no tabs.

- [ ] **Step 3: Commit**

```bash
git add skills/wiki-purge/SKILL.md
git commit -m "feat(purge): /wiki-purge skill"
```

---

### Task 10: Documentation and the `.recycle/` contract

**Files:**
- Modify: `skills/wiki-maintainer/SKILL.md`
- Modify: `templates/vault-schema.md`
- Modify: `README.md`

- [ ] **Step 1: Add the contract line to `wiki-maintainer`**

In the "Vault contract" section, after the `raw/` … `log/` layout bullet, add:

```markdown
- **`.recycle/`** holds purged content — pages, clippings, and a `manifest.json`
  per purge. **Never read it, never cite it, never count it.** It is excluded
  structurally: `graph.mjs`'s walk skips leading-dot entries, and every other
  reader filters on an anchored `wiki/` prefix. A page in the bin is not evidence,
  not a source, and not backlog. `/wiki-purge` owns it; nothing else writes there.
```

- [ ] **Step 2: Add `.recycle/` to the vault schema layout**

In `templates/vault-schema.md`, in the `## Layout` list, after the `moc/` line:

```markdown
- `.recycle/` — purged topics, one folder per purge with a `manifest.json`. Git-tracked so a
  removal reaches every machine; dot-prefixed so no search, metric, or graph walk ever sees it.
  Never emptied automatically.
```

- [ ] **Step 3: Add the command to the README**

In the command list, alongside the other `/wiki-*` entries:

```markdown
- `/wiki-purge <topic>` — remove a topic for good: pages, evidence, and source URLs move to a
  git-tracked `.recycle/` bin, the removal is committed so it reaches every machine, and
  `--reconcile` re-bins anything that comes back. Reversible with `--restore <id>`.
```

- [ ] **Step 4: Commit**

```bash
git add skills/wiki-maintainer/SKILL.md templates/vault-schema.md README.md
git commit -m "docs(purge): .recycle contract, vault schema entry, README command"
```

---

### Task 11: End-to-end test against a fixture vault

**Files:**
- Create: `test/fixtures/purge-vault/` (7 files)
- Modify: `test/purge-apply.test.mjs`

- [ ] **Step 1: Build the fixture**

Create these files verbatim.

`test/fixtures/purge-vault/index.md`:
```markdown
---
type: index
---
# Catalog

- [[Topic Concept]]
- [[Outside Page]]
```

`test/fixtures/purge-vault/wiki/concepts/Topic Concept.md`:
```markdown
---
type: concept
status: maintained
sources: ["[[raw/clippings/Only-aaa1111.md]]"]
source-hashes: [aaa1111]
ai-generated: true
---
# Topic Concept

A concept that belongs to the topic being purged.
```

`test/fixtures/purge-vault/wiki/sources/Topic Source.md`:
```markdown
---
type: source
status: maintained
sources: ["[[raw/clippings/Shared-bbb2222.md]]"]
source-hashes: [bbb2222]
ai-generated: true
---
# Topic Source

Summarizes a clipping that an off-topic page also cites. Links to [[Topic Concept]].
```

`test/fixtures/purge-vault/wiki/syntheses/Offtopic.md`:
```markdown
---
type: synthesis
status: maintained
sources: ["[[raw/clippings/Shared-bbb2222.md]]"]
source-hashes: [bbb2222]
ai-generated: true
---
# Offtopic

Rests on the shared clipping and has nothing to do with the purged topic.
```

`test/fixtures/purge-vault/wiki/concepts/Outside Page.md`:
```markdown
---
type: concept
status: maintained
sources: []
ai-generated: true
---
# Outside Page

Mentions [[Topic Concept]] but is not part of the topic.
```

`test/fixtures/purge-vault/raw/clippings/Only-aaa1111.md`:
```markdown
---
title: "Only"
source: https://example.com/only
tags: [clippings]
source-hash: aaa1111
---
Cited by the topic concept alone.
```

`test/fixtures/purge-vault/raw/clippings/Shared-bbb2222.md`:
```markdown
---
title: "Shared"
source: https://example.com/shared
tags: [clippings]
source-hash: bbb2222
---
Cited by both a topic page and an off-topic page.
```

- [ ] **Step 2: Write the failing end-to-end test**

Append to `test/purge-apply.test.mjs`:

```js
import { cpSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planPurge, buildManifest } from '../scripts/lib/purge.mjs';
import { computeGraphMetrics } from '../scripts/lib/graph.mjs';

// Repo idiom for test-relative paths — see test/graph.test.mjs:9.
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'purge-vault');

function fixtureCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-fixture-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

test('end to end: purging the topic keeps the shared clipping and its off-topic dependent', () => {
  const v = fixtureCopy();
  try {
    const pages = enrichPages(v, buildGraph(v));
    const plan = planPurge({
      pages,
      seedPaths: ['wiki/concepts/Topic Concept.md', 'wiki/sources/Topic Source.md'],
    });
    const hashes = Object.fromEntries(plan.purge.map((p) => [p, sha256(readFileSync(join(v, p), 'utf8'))]));
    const manifest = buildManifest({
      id: '2026-08-08-topic', topic: 'topic', date: '2026-08-08',
      purge: plan.purge, collateral: plan.collateral, pages, hashes,
    });
    writeManifest(v, manifest);
    applyPurge(v, manifest);

    assert.equal(existsSync(join(v, 'raw', 'clippings', 'Shared-bbb2222.md')), true, 'shared evidence survives');
    assert.equal(existsSync(join(v, 'wiki', 'syntheses', 'Offtopic.md')), true, 'off-topic page survives');
    assert.equal(existsSync(join(v, 'raw', 'clippings', 'Only-aaa1111.md')), false, 'exclusive evidence is purged');
    assert.ok(manifest.declines.includes('https://example.com/only'));
    assert.ok(!manifest.declines.includes('https://example.com/shared'));
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});

// Spec §9: reference repair is mandatory, so the raw purge must LOWER the score
// until repair happens. This pins the reason repair is a required step and not a
// nicety — if this ever passes without repair, the collateral list is not working.
test('end to end: the purged clipping leaves the backlog rather than lingering as un-ingested', () => {
  const v = fixtureCopy();
  try {
    const pages = enrichPages(v, buildGraph(v));
    const plan = planPurge({ pages, seedPaths: ['wiki/concepts/Topic Concept.md'] });
    const hashes = Object.fromEntries(plan.purge.map((p) => [p, sha256(readFileSync(join(v, p), 'utf8'))]));
    const manifest = buildManifest({
      id: 'id', topic: 't', date: '2026-08-08',
      purge: plan.purge, collateral: plan.collateral, pages, hashes,
    });
    applyPurge(v, manifest);
    // unsummarizedSources is an array of path STRINGS — health.mjs:87 prints it
    // with .join(), which only works on strings.
    const { unsummarizedSources } = computeGraphMetrics({ pages: buildGraph(v) });
    assert.equal(unsummarizedSources.some((p) => p.includes('Only-aaa1111')), false);
  } finally {
    rmSync(v, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `node --test test/purge-apply.test.mjs`

The first run should fail only if the fixture is missing or misnamed; the implementation already exists. A failure in the *assertions* means the closure is wrong — fix `planPurge`, not the test.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/purge-vault test/purge-apply.test.mjs
git commit -m "test(purge): end-to-end fixture covering shared-evidence retention"
```

---

### Task 12: Version bump and changelog

**Files:**
- Modify: `package.json`, `plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump the version to 0.9.0 in all four manifests**

All four currently read `"version": "0.8.3"`. Change each to `"version": "0.9.0"`. Minor bump: new feature, no breaking change to existing vaults.

- [ ] **Step 2: Add the changelog entry**

At the top of `CHANGELOG.md`, matching the existing entry format:

```markdown
## 0.9.0 — /wiki-purge

Remove a topic for good. `/wiki-purge <topic>` seeds from search, grows a bounded
closure along the link graph, and moves the topic's pages, its exclusive evidence,
and its source URLs into a git-tracked `.recycle/` bin — then commits, so the
removal reaches every machine instead of evaporating on the next sync.

- Purge spans three layers. Taking `wiki/` pages alone leaves clippings that the
  ingest backlog reports forever and that the next `/wiki-ingest` rebuilds the
  topic from; taking clippings without recording their URLs lets `/wiki-discover`
  re-clip them.
- The closure never admits a page that anything outside the topic references.
  Those become *collateral* (references to repair) or *blocking* (every source
  they cite is inside the set — `--apply` refuses until you decide).
- `--reconcile` re-bins anything that came back, matching by path and by
  `source-hash`, so a re-clip under a new filename is caught too. Idempotent.
- `--restore <id>` puts a purge back, never overwriting newer work.
- The bin is excluded structurally, with no changes to any existing reader:
  `graph.mjs` skips leading-dot entries, and `search.mjs`, `drift.mjs`, and
  `stale.base` all filter on an anchored `wiki/` prefix a `.recycle/` path fails.
```

- [ ] **Step 3: Run the full suite one last time**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md
git commit -m "chore: 0.9.0 — /wiki-purge"
```

---

### Task 13: Verify against the real vault

Everything so far ran against temp vaults. This proves it on the user's actual data, without committing anything.

**Files:** none.

- [ ] **Step 1: Plan a purge of the cluster the user tried to remove**

```bash
node scripts/purge.mjs --plan "parenting conflict resolution self-help"
```

Expected: a plan naming pages including `wiki/concepts/Conflict Resolution.md`, `wiki/concepts/Communication Skills.md`, and `wiki/sources/Gottman — R is for Repair.md`. Read the COLLATERAL and BLOCKING lists.

- [ ] **Step 2: Sanity-check the closure by hand**

Pick two pages from the plan and one from collateral. For each, run `obsidian vault=<name> backlinks file="<name>" counts` (**PowerShell tool**, never Bash) and confirm the classification matches: purged pages should have inbound links only from other purged pages; the collateral page should have at least one from outside.

- [ ] **Step 3: Report to the user, do not apply**

Present the plan. Applying against the real vault is the user's call, and it is the first genuinely destructive step in this whole plan.

- [ ] **Step 4: Confirm reconcile is a no-op on a clean vault**

```bash
node scripts/purge.mjs --reconcile
```

Expected: `reconcile: 0 re-binned, 0 decline(s) replayed`

---

## Self-review notes

Checked against the spec, section by section:

- §2 root cause → Task 6 (`lib/git.mjs`) and Task 8 (commit in `--apply`).
- §2.1 three layers → Task 3 (closure reaches `raw/`), Task 4 (`declines` in manifest), Task 8 (`recordDecline`).
- §3 prior art → per-purge manifest files (Task 4/7), never a shared aggregate.
- §4 bin location and the layout constraint → Task 4, tested explicitly.
- §5 selection → Task 3; seeds → Task 8 `collectSeeds`; confirmation gate → Task 9 step 3.
- §6 execution order → Task 8 `main`, in the spec's order (manifest before move).
- §7 manifest and reconcile → Tasks 4 and 5.
- §8 unverified assumption → Task 1, which gates nothing else and has a written fallback.
- §9 metrics → Task 11's second test.
- §10 test table → tests 1–7 in Tasks 3/5/7/11; test 8 (blocking) in Task 3; test 9 (health score) in Task 11.
- §11 docs → Task 10.
- §12 non-goals → no TTL, no empty-bin command, no UI anywhere in this plan.

Two deliberate deviations from a literal spec reading, both narrowing:

1. The spec's §6 step 8 says purge commits and pushes on confirmation. The plan puts the commit in the script and the **push in the skill** — a script that could run unattended must not publish to a remote by itself.
2. `--plan` is the default mode rather than `--apply`. The spec requires a confirmation gate; making the destructive mode opt-in enforces it at the CLI rather than trusting the skill's prose.

Three API contracts were verified against the source while writing this plan, because getting any of them wrong produces a silent no-op rather than a crash:

- `search.mjs`'s `main()` returns `{ tier, results }` (`search.mjs:219`), not an array.
- Its `score` values come from `mergeRRF` with `RRF_K = 60` (`search.mjs:65-77`), so they cluster near `1/61`. **Any absolute threshold on them is a bug.** Task 8 pins this with a test.
- `computeGraphMetrics().unsummarizedSources` is an array of path strings (`health.mjs:87` joins it directly).
