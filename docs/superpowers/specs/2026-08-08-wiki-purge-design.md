# `/wiki-purge` — topic removal that survives sync — Design Spec

**Date:** 2026-08-08
**Status:** Designed (not yet implemented)
**Author:** Design conversation with @Eric-Hartye_HON

---

## 1. Summary

Add `/wiki-purge <topic>`: systematically find every artifact belonging to a topic, move it into a
git-tracked recycle bin, record what moved in an append-only manifest, and commit the result so the
removal becomes a fact every machine shares. Add a `--reconcile` mode that re-bins anything that
comes back, and `--restore <id>` that undoes a purge from its manifest.

The user's ask, restated: *"add a purge skill that will systematically search through the wiki and
move all articles on a topic to a recycle bin folder in the wiki. all find and search skills
subsequently need to ignore the contents of that recycle bin. we ran into an issue today where i
tried to delete things but other comps with the files still there kept syncing the files in."*

## 2. Root cause of the reported failure — measured, not assumed

The reported mechanism ("other machines synced the files back in") **is not what happened.** No
commit anywhere in the vault's history has ever deleted the pages in question.

Evidence, against `~/.wiki-master-vault` at `1adcf68`:

```
$ git log --full-history --oneline --name-status -- "wiki/concepts/Conflict Resolution.md"
88a6539 Remove topic cluster at user request; repair cross-references and regenerate catalog
M   wiki/concepts/Conflict Resolution.md
648c263 vault backup: 2026-08-04 23:41:21
A   wiki/concepts/Conflict Resolution.md
```

Two events in the file's entire life: created by an auto-backup on 2026-08-04, **modified** today.
`--full-history` is load-bearing here — default history simplification hides one side of a merge, so
a plain `git log -- <path>` could have concealed a delete that a merge undid. It did not; there is
none. `git log --full-history --diff-filter=D` over `wiki/concepts/` and `wiki/sources/` returns only
unrelated July commits. Today's `88a6539`, despite its subject line, deletes no file — it strips
cross-references and regenerates the catalog. Every page of the cluster is still on disk.

So no other machine pushed the files back, because **there was never a committed deletion for
anything to be pushed back against.** The removal existed only in one working tree and was undone
locally before it became a commit. The vault syncs through obsidian-git, which was at the time
running auto-commit-and-sync with `pullBeforePush: true`; an uncommitted working-tree deletion
sitting next to an incoming merge is exactly the state git resolves by restoring the files.

The local reflog cannot corroborate the precise sequence: `.git/logs/HEAD` is zero bytes with an
mtime of 14:10 today, minutes after `1adcf68 Disable obsidian-git auto-commit and auto-pull-on-boot`.
That is stated as a limit of the investigation, not glossed.

**Design consequence.** A recycle-bin move does not fix this on its own — a rename that is never
committed evaporates exactly like an uncommitted delete. What fixes it is purge owning the whole
transaction through commit, plus being re-runnable so anything that does reappear converges. The bin
is for recoverability and for better merge semantics (a rename/modify collision usually auto-resolves
by applying the edit to the moved path; a delete/modify collision is git's ugliest conflict and the
one humans resolve by keeping the file). The bin is not, by itself, the fix.

### 2.1 The second resurrection vector, internal to wiki-master

Independent of git. Purging `wiki/` pages while leaving `raw/clippings/` in place makes those
clippings `unsummarizedSources` under the hash-join backlog — permanently. The next `/wiki-ingest`
then faithfully rebuilds the topic from evidence nobody removed. Purging the clippings without
recording their URLs lets `/wiki-discover` re-clip the same sources on any future run over an
adjacent topic.

Removing a topic is therefore a **three-layer** operation: `wiki/` pages, `raw/` evidence, and URL
declines. This vector would have surfaced regardless of what git did.

## 3. Prior art already in this repo

No new concepts are introduced. Three existing decisions are extended to a third case:

| Existing | Where | What purge inherits |
|---|---|---|
| Tombstones outlive the artifact | `scripts/lib/decline.mjs` (cites Miniflux; TTL per RFC 2308) | A decision about a source must be recorded outside the source, or it is re-litigated forever |
| One file per operation, never a shared aggregate | `log/`, `wiki-maintainer` SKILL.md | Two machines can never collide on a purge record |
| Append-only per-entry artifacts | `wiki/concepts/Concurrent Writers in a File-Backed Vault.md` | *"A file that only ever gains new siblings has no lost-update mode; a file that gets rewritten does."* |
| Ingest state is a content-hash join, never a file move | `wiki-maintainer` SKILL.md, `graph.mjs` | Identity survives renames and filename drift |

## 4. Decision: where the bin lives

| Option | Pro | Con |
|---|---|---|
| `.recycle/` (dot-prefixed, vault root) | Excluded by every existing reader with **zero code changes**; git-tracked, so purges sync | Relies on dot-folder invisibility (one unverified link — see §8) |
| `recycle-bin/` (visible, vault root) | Nothing unverified; browsable in Obsidian | Every reader needs its own filter; Obsidian indexes it, so purged pages persist in search, backlinks, and graph view; a reader added later that forgets the filter is a silent bug |
| `.wiki-master/recycle/` | Already excluded and already dot-prefixed | **`.wiki-master/` is gitignored** — the purge would not sync, defeating the entire requirement |
| Outside the vault | Fully invisible | No cross-machine convergence, no recovery on other machines |

**Chosen: `.recycle/` at the vault root.**

The exclusion is structural rather than a convention. `scripts/lib/graph.mjs:102` already skips any
entry whose name starts with `.`:

```js
for (const e of readdirSync(dir)) {
  if (e.startsWith('.')) continue;
```

Eleven scripts route through `buildGraph` — `health`, `lint`, `index-gen`, `triage`,
`backfill-source-hashes`, `clip-and-repoint`, `dedupe-clippings`, `repair-missing-hash`,
`repair-provenance-links`, `repair-quote-provenance`, and `graph.mjs` itself. `scripts/search.mjs`
independently filters both retrieval channels to `wiki/`: `wikiFiles()` applies
`rel.startsWith('wiki/')`, and `keywordSearch` passes `path=wiki`. The `obsidian-cli` skill already
documents `path=wiki` as the default scope. The clippers (`clip*.mjs`, `apply-reclips`,
`refresh-fidelity`) scan `raw/clippings` by path and are out of scope.

The two readers that do **not** route through `buildGraph` were checked individually, because they
consume Obsidian's index rather than a filesystem walk. Both turn out to be covered by their own
anchored prefix filters:

| Reader | Enumerates via | Excluded by |
|---|---|---|
| `graph.mjs` + its 10 consumers | `readdirSync` walk | Structural dot-skip (`graph.mjs:102`) |
| `search.mjs` (both channels) | `obsidian files` / `search path=wiki` | `rel.startsWith('wiki/')`, `path=wiki` |
| `drift.mjs` | `obsidian files ext=md` (`drift.mjs:58`) | `if (!/^wiki\/(concepts\|syntheses)\//.test(rel)) continue;` (`drift.mjs:61`) |
| `stale.mjs` | `obsidian base:query file=stale.base` (`stale.mjs:32`) | `file.inFolder("wiki")` in `stale.base` |

**No reader needs a new guard.** Every exclusion is either the leading-dot walk skip or an anchored
`wiki/`-prefix filter, and a bin path beginning `.recycle/` fails both.

**This makes the bin's internal layout load-bearing.** Purged files must be stored at
`.recycle/<id>/<original-path>` — the dot-prefixed segment *first*. The prefix filters above are
anchored with `^` (or `inFolder`), so `.recycle/<id>/wiki/concepts/Foo.md` correctly fails
`/^wiki\//` while a hypothetical layout that hoisted `wiki/` to the front would silently pass it and
re-expose every purged page to drift and stale. This is a constraint on the implementation, not an
incidental detail, and it is tested (§10, test 7).

The requirement that all find and search skills ignore the bin is thus met by construction, and —
more importantly — inherited by readers not yet written, since none of them will walk a dot-folder
or match an anchored `wiki/` prefix against one.

Only `.wiki-master/`, `.obsidian/workspace.json`, and `.obsidian/workspace-mobile.json` appear in the
vault's `.gitignore`, so `.recycle/` is tracked and syncs.

## 5. Selection: hybrid seed, bounded closure

**Seeds** come from `scripts/search.mjs` — the existing RRF merge of keyword and semantic retrieval.
No new retrieval code.

**Closure** walks `buildGraph` under exactly three inclusion rules:

1. the page is a seed;
2. a `raw/` clipping is included when **every** page citing it is already in the set;
3. a `wiki/` page is included when its inbound content links come **only** from pages already in the
   set.

A page with any inbound link from outside the set is **never** auto-included. It goes on a separate
**collateral** list: pages that survive but reference purged content, and therefore need reference
repair. That list is precisely the hand work `88a6539` performed today.

The asymmetry is deliberate and worth stating plainly: over-matching destroys work the user wanted
and is discovered late; under-matching leaves one page to delete by hand and is discovered
immediately. The closure only ever grows through "nothing outside the topic points here."

**Blocking condition.** A surviving page whose entire provenance was purged is a claim with no
evidence — guardrail #2's failure mode. Purge does not guess. It reports such pages and blocks until
the user decides to include them or keep them.

**Confirmation gate.** Purge prints the manifest grouped by layer with counts, plus the collateral
list and any blocking pages, and moves nothing until the user approves. There is no auto-purge mode
and no `--yes` flag in v1.

## 6. Execution order

Ordered so that an interruption never leaves an unexplained state:

1. **Reconcile first** (§7) — sweep any prior purge's resurrections before adding a new one.
2. **Write `.recycle/<YYYY-MM-DD>-<slug>/manifest.json`** — a record of intent survives a crash
   mid-move.
3. **Move files**, mirroring original paths: `wiki/concepts/Foo.md` → `.recycle/<id>/wiki/concepts/Foo.md`.
4. **Repair references** on the collateral pages.
5. **Regenerate the catalog** — `node scripts/index-gen.mjs`.
6. **Append declines** — each purged clipping's URL to `.wiki-master/declined.json`, reason
   `purged:<id>`.
7. **Write the log entry** — `node scripts/log-entry.mjs --op purge`.
8. **Commit** — if the vault is a git repo, stage and commit. **Push only on explicit user
   confirmation** (an outward-facing action). If the vault is not a git repo, state loudly that the
   purge is local-only.

Step 8 is what fixes the reported bug, and it is new surface: no script in this plugin currently
shells out to git. It is confined to a new `scripts/lib/git.mjs` with a hard boundary — no force, no
history rewriting, no branch switching, and a no-op with a clear message when the vault is not a
repo.

## 7. Manifest and reconcile

One `manifest.json` per purge, inside that purge's own bin folder. Never a shared file two machines
could both rewrite.

```json
{
  "id": "2026-08-08-parenting-conflict",
  "topic": "parenting / conflict-resolution self-help cluster",
  "date": "2026-08-08",
  "entries": [
    { "layer": "wiki", "from": "wiki/concepts/Conflict Resolution.md", "sha256": "…" },
    { "layer": "raw",  "from": "raw/clippings/Gottman-a1b2c3d.md", "sha256": "…",
      "source-hash": "a1b2c3d…", "url": "https://…" }
  ],
  "declines": ["https://…"],
  "collateral": ["wiki/syntheses/Family Systems.md"]
}
```

Entries are keyed by **both** path and content hash. Path finds a file that returned where it was;
`source-hash` finds one that returned under a different name — the same join `health.mjs --backlog`
already uses, inheriting a contract proven against filename drift.

**Reconcile** (`--reconcile`, and automatically at the head of every purge) reads every manifest
under `.recycle/` and:

- re-bins any `from` path present in the live vault again, into `<id>/resurrected-<n>/` so the
  original capture is never overwritten;
- re-bins any live clipping whose `source-hash` matches a purged entry, at whatever path it now
  occupies — this catches a re-clip under a new filename;
- re-adds any manifest decline missing from the local `declined.json`.

Reconcile is idempotent and order-independent: whichever machine runs it converges, and running it
twice changes nothing.

The decline replay is more than bookkeeping. `declined.json` lives under `.wiki-master/`, which the
vault's `.gitignore` excludes — **it does not sync today.** Carrying declines in the manifest and
replaying them locally is the only thing that gets a purge's declines to the user's other machines,
and it incidentally narrows a gap that already affects `/wiki-discover`'s dedup.

## 8. The assumption — verified 2026-08-08

Obsidian's own indexer ignores dot-prefixed folders — the behavior that keeps `.obsidian`, `.trash`,
and `.git` out of search results. **Verified live** against the real vault with Obsidian running:

```
planted: .recycle/probe-task1/wiki/concepts/Probe.md  (body: "zzqqxx-purge-probe-token")

obsidian search query="zzqqxx-purge-probe-token"   → No matches found.
obsidian files ext=md  | filter "probe-task1"      → (nothing)
obsidian search query="the" total                  → 2928
```

The third command is the load-bearing one. Per the `obsidian-cli` skill's "Empty is not an answer"
rule, Obsidian publishes no exit-code contract for "no results," so an empty result that is about to
drive a decision needs one cheap canary: a live backend printing a number means the two empties above
are real answers rather than a dead CLI. It printed 2928. The probe folder was then removed.

**The `userIgnoreFilters` fallback is therefore not needed and was not implemented.** Had the probe
found the file, the fallback would have been to add `.recycle` to `userIgnoreFilters` in
`.obsidian/app.json` (Obsidian's "Excluded files" setting) and have `wiki-init` write it.

This closes the last open question in the design. Every channel in §4's table is now confirmed
excluded: three by code that was read, and the Obsidian-side channels by measurement.

Scope of the dependency, precisely: every reader in §4's table is excluded by a filesystem walk skip
or an anchored `wiki/` prefix filter, and holds either way. What genuinely rides on the probe is only
the Obsidian-side channels a human or an agent touches **directly** — `obsidian search` without a
`path=` argument, `obsidian backlinks`, `obsidian files`, and graph view. That is a usability
question (does a purged page still surface when you search by hand?), not a pipeline-correctness one.

## 9. Effect on existing metrics

Because the bin is invisible to `buildGraph`, purged clippings leave `unsummarizedSources` rather
than sitting in the backlog forever inviting the next ingest to rebuild the topic. That closes §2.1.

Reference repair (step 4) is mandatory for content integrity: a surviving page left citing a purged
clipping is a claim whose trail dead-ends, which guardrail #3 calls a defect however well it reads.

**But the health score does not enforce it, and the original claim here that it does was wrong.**
Measured against the end-to-end fixture during implementation: an unrepaired purge moved the score
**up**, 92 → 94. Two effects combine — purging an orphaned page removes an orphan penalty, and the
dangling links left behind land in `classifyBrokenLinks`'s `deferred` bucket, which is unscored. A
broken link escapes `deferred` only if a similarly-named page still exists (impossible: the target was
just purged) or the citing page is over 90 days stale. So on any collateral page touched recently — most
of a live vault — a skipped repair is invisible to the score.

The verification step therefore compares the **broken-link count**, not the score. That is what
`/wiki-purge`'s skill instructs, and it measures the thing directly.

Whether `classifyBrokenLinks` should treat a broken link on an undated or recently-updated page as a
defect candidate rather than defaulting it to `deferred` is a scoring-policy question affecting every
vault operation, not just purge. Recorded here as a follow-up; deliberately not changed as part of
this feature.

## 10. Testing

TDD, against a new fixture vault (`test/fixtures/purge-vault/`) holding a small topic cluster, one
collateral page linking into it from outside, and one clipping cited by both an on-topic and an
off-topic page.

| # | Test | Guards |
|---|---|---|
| 1 | Shared clipping is retained; outside-linked page lands on collateral, not in the bin | Over-match — the destructive failure |
| 2 | Manifest round-trips; `--restore <id>` reproduces the pre-purge tree exactly | Recoverability, the premise of "keep forever" |
| 3 | Reconcile re-bins a file restored at its original path | Cross-machine convergence |
| 4 | Reconcile re-bins a re-clip whose `source-hash` matches under a new filename | Identity across renames |
| 5 | Reconcile replays a decline missing from local `declined.json` | The non-syncing `.wiki-master/` gap |
| 6 | Reconcile run twice is a no-op | Idempotence |
| 7 | `buildGraph` over a vault containing `.recycle/` returns no bin paths, **and** every bin path fails `/^wiki\//` | The exclusion contract, including §4's layout constraint |
| 8 | A page left with zero surviving provenance blocks rather than passing | Guardrail #2 |
| 9 | `health.mjs` score after purge ≥ score before | §9 |

## 11. Documentation changes

- New `skills/wiki-purge/SKILL.md`.
- `wiki-maintainer` SKILL.md — one contract line under the vault contract: *`.recycle/` holds purged
  content. Never read it, never cite it, never count it. It is excluded structurally by its leading
  dot.* Agents can read anything; the skill has to say not to.
- `templates/vault-schema.md` — `.recycle/` in the layout section.
- `README.md` — the command.

No changes to `drift.mjs`, `stale.base`, `search.mjs`, or `graph.mjs`: §4 establishes they already
exclude the bin. Touching them would be unrequested change to code the feature does not need.

## 12. Non-goals, and one named gap

**Out of scope for this spec:** TTL or auto-emptying of the bin (retention is "keep forever, never
auto-empty" by user decision); a separate empty-bin command; purge by author, date, or tag rather
than topic; any UI.

**Named gap — not fixed here.** The root cause in §2 is not specific to deletion. No wiki-master
operation is transactional with respect to sync: ingest, relink, and lint all mutate the vault and
walk away without committing, relying on obsidian-git's timer to notice. Additions survive that
because adding is roughly idempotent; removals do not, which is why deletion is where it surfaced
first. As of `1adcf68` that timer is disabled on this machine, so nothing commits this vault
automatically anymore.

The class fix is a shared `mutate → commit → push` helper that every mutating skill calls. Purge is
its right first customer and `scripts/lib/git.mjs` (§6) falls out of building it. Converting the
other skills is deliberately **not** in this spec's scope — recorded here so the gap is a decision
rather than an oversight.

## 13. Follow-up

Per the design conversation: after purge ships, run `/wiki-discover` on soft-delete and tombstone
prior art (Miniflux tombstones, CRDT deletion semantics, Obsidian sync deletion behavior,
obsidian-git conflict resolution) and ingest it, so the vault holds the topic rather than having it
rediscovered from scratch. The existing page
`wiki/concepts/Concurrent Writers in a File-Backed Vault.md` is the natural page to extend.
