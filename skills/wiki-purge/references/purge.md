Read directly for this task: [access](../../wiki-maintainer/references/access.md), [evidence](../../wiki-maintainer/references/evidence.md), [completion](../../wiki-maintainer/references/operations.md).
A purge has one approval, for its reviewed plan. `purge.mjs` writes its own log entry, so the skill writes no second entry.

# Purging a topic

Deleting files does not remove a topic. Three things bring it back. Purge closes the
first two in one transaction, and `--reconcile` closes them again on another machine.
**It cannot close the third** — recognizing that one is on you.

1. **A `raw/` clipping left behind.** The ingest backlog reports it as
   un-summarized forever, and the next researcher ingestion faithfully rebuilds the topic
   from evidence nobody removed.
2. **A source URL nobody declined.** Researcher discovery re-finds and re-clips it.
3. **A machine on an old history.** A history rewrite is the owner's decision. A machine
   still on the old history can bring removed files back on its next run, and purge cannot
   detect it. If a removed file reappears, tell the owner.

## Steps

1. **Establish the baseline; reconcile only when authorized.**
   Follow the direct [broken-link verification procedure](../../wiki-setup/references/checks.md#purge-broken-link-verification) before any mutation and retain its initial count. For a preview-only request, do not reconcile: proceed directly to the read-only plan. When completing an explicitly authorized prior removal, use [interrupted-purge recovery](../../wiki-setup/references/operation-recovery.md#interrupted-purge); reconciliation moves files, even when it is silent on a clean vault.

2. **Plan.**
   `node "<absolute-plugin-root>/scripts/purge.mjs" --plan "<topic>"`
   Moves nothing. Prints the seeds it matched, every file it would bin, and two
   lists that need a human decision:
   - **COLLATERAL** — pages that survive but link into the purge set. Their
     references need repairing in step 4.
   - **BLOCKING** — pages whose every cited source is inside the set. `--apply`
     refuses while any exist. Either add them to the purge or keep their sources;
     a claim with no evidence is a defect (guardrail #2), so purge will not decide
     this silently in either direction.

3. **Check the seeds before the plan, then get explicit approval.** Never skip
   either half.

   **Read the seed list first.** Search ranks by relevance but has no notion of
   "relevant enough" — the scores come from RRF fusion and carry no absolute
   meaning, so the tail of a ranked seed list can drift into adjacent topics, and
   every off-topic seed drags its exclusive evidence into the bin with it.
   Inspect the actual pages; topical similarity alone does not authorize removal.

   Strike anything that does not belong and re-run pinned:
   `--plan "<topic>" --seeds "wiki/concepts/A.md,wiki/concepts/B.md"`
   Paths are vault-relative and validated — a typo is refused rather than silently narrowing
   the purge.

   **Then read the plan back** grouped by layer with counts, naming the collateral
   and blocking pages specifically, and get one explicit yes. Purge moves many files
   at once and the closure reaches further than expected when a topic is densely
   linked. Say in the same request that Obsidian Git publishes the removal on its next
   run, which carries it to every machine. Nothing else asks later, so this is the decision.

4. **Apply** — with the same `--seeds` you approved, if you pinned any.
   `node "<absolute-plugin-root>/scripts/purge.mjs" --apply "<topic>" [--seeds "..."]`
   Writes the manifest first, moves the files, records declines and writes the log entry,
   which lists the COLLATERAL pages. An empty closure writes nothing. A file it could not
   move exits 1: see [when a purge stops partway](#when-a-purge-stops-partway). Then repair
   references in the hand-written text of the COLLATERAL pages and
   [validate the changed paths](../../wiki-setup/references/validation.md). A generated fence,
   such as a project map's list, clears itself at the refresh in step 5.

5. **Refresh.** `node "<absolute-plugin-root>/scripts/refresh-index.mjs"`, once, as
   [completion](../../wiki-maintainer/references/operations.md) describes. It drops the
   purged pages from the catalogs and the search index.

6. **Verify — on the broken-link count, not the score.**
   Repeat the direct [broken-link check](../../wiki-setup/references/checks.md#purge-broken-link-verification) and compare with the saved baseline. The count must not have grown. If the refresh did not finish, generated catalogs still link to purged pages, so say the count is provisional. Inspect collateral and report the result; a better score never proves a safe purge.

A page changed on another machine and purged here is a conflict Obsidian Git stops on: tell
the owner, as [its conflict file](../../wiki-setup/references/operation-recovery.md#conflict-files-obsidian-gitmd) says.

## When a purge stops partway

Use [interrupted-purge recovery](../../wiki-setup/references/operation-recovery.md#interrupted-purge) to inspect and finish the same authorized transaction. **Do not rerun `--apply`:** it starts a second purge under a new id. Files that moved stay moved and logged; the declines wait until every move has succeeded, and `--reconcile` replays them from the manifest.

## On another machine

Obsidian Git carries the moved files, but its timer never runs `--reconcile`, and declines live in `.wiki-master/`, on one machine. So when asked, run `node "<absolute-plugin-root>/scripts/purge.mjs" --reconcile` by hand on each other machine. It re-bins any purged file that came back, by path or source hash, and replays the manifests' declines.

- A run that changed nothing writes no log. One that changed something writes its own entry.
- After re-binning files, run `refresh-index.mjs`. A run that only replayed declines needs no refresh.
- Exit 1 means a file could not move: close whatever holds it open and run `--reconcile` again.
- Read stderr. An `UNREADABLE manifest` line does not change the exit code, but that manifest's files never re-bin and its declines never replay. Report it as a blocker.

## Restoring

`node "<absolute-plugin-root>/scripts/purge.mjs" --restore <purge-id>` puts everything
back and writes its log entry. A run that moved nothing writes no log and needs no refresh;
otherwise finish with `refresh-index.mjs`.

- It never overwrites a file already at the original path — that is newer work, and
  it is reported as **skipped** instead.
- It clears the declines this purge recorded, so researcher discovery can find those
  sources again. Declines made for other reasons are left alone. A file that could not
  move holds them back: close whatever holds it open and run `--restore` again.
- Anything the manifest claims but the bin cannot supply is reported as **MISSING**
  with a non-zero exit. **Never read a bare `restored N file(s)` as success** without
  checking that line.

## Rules

- **Never read, cite, or count `.recycle/`.** It is excluded from every metric and
  every search by design — `graph.mjs` skips dot-prefixed entries during its walk,
  supported readers exclude that scope. A page in the bin is not evidence, not a
  source, and not backlog.
- **Never hard-delete the bin.** Retention is deliberate and unbounded: purge is
  reversible, and that is the only reason it is safe to run at all.
- **Never `--apply` without showing the plan and getting approval first.**
- **An empty result is not an answer.** If `--plan` reports no wiki pages for a
  topic, inspect its search diagnostics: the helper refuses to trust an empty
  result when the primary wiki keyword scan failed. Do not reinterpret unavailable
  coverage as "this topic does not exist"; use [search diagnostics](../../wiki-setup/references/search-diagnostics.md) when needed. Healthy search still requires reviewing
  seeds for relevance; it does not authorize applying a plan.
