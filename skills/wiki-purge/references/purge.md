Read directly for this operation: [access](../../wiki-maintainer/references/access.md), [evidence](../../wiki-maintainer/references/evidence.md), [operations](../../wiki-maintainer/references/operations.md).
Purge owns its transaction and separate approvals. Only collateral edits use an ordinary scoped operation; retain the shared ownership and evidence rules without wrapping purge in a competing operation.

# Purging a topic

Deleting files does not remove a topic. Four things bring it back. Purge closes the
first three in one transaction, and `--reconcile` closes them again on every other
machine. **It cannot close the fourth** — recognizing that one is on you.

1. **An uncommitted deletion.** A removal that never becomes a commit is not a
   removal anything else can see; the next sync undoes it. Purge owns its whole
   transaction through commit, so this one is closed by construction.
2. **A `raw/` clipping left behind.** The ingest backlog reports it as
   un-summarized forever, and the next researcher ingestion faithfully rebuilds the topic
   from evidence nobody removed.
3. **A source URL nobody declined.** Researcher discovery re-finds and re-clips it.
4. **A removal committed onto a history this clone cannot reach.** This is the
   failure that purge cannot detect. A
   force-push or filter-branch rewrite gives origin a new lineage; a clone that
   never pulls it keeps the old one — every removed file still present — and
   auto-sync can keep committing to it. When the lineages have **no merge base**,
   the clone can retain every removed file even though the remote records removal.

**Check before mutation:** follow the direct [history-connectivity diagnostic](../../wiki-setup/references/operation-recovery.md#purge-history-connectivity). Stop on confirmed unrelated histories. A missing upstream/fetch failure is a distinct condition; non-Git work is local-only. Choosing a canonical history is not a purge decision.

## Steps

1. **Establish the baseline; reconcile only when authorized.**
   Follow the direct [broken-link verification procedure](../../wiki-setup/references/checks.md#purge-broken-link-verification) before any mutation and retain its initial count. For a preview-only request, do not reconcile: proceed directly to the read-only plan. When completing an explicitly authorized prior removal, use [interrupted-purge recovery](../../wiki-setup/references/operation-recovery.md#interrupted-purge); reconciliation moves files and commits, even when it is silent on a clean vault.

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
   and blocking pages specifically, and get an explicit yes. Purge moves many files
   at once and the closure reaches further than expected when a topic is densely
   linked.

4. **Apply** — with the same `--seeds` you approved, if you pinned any.
   `node "<absolute-plugin-root>/scripts/purge.mjs" --apply "<topic>" [--seeds "..."]`
   Writes the manifest, moves the files, records declines, writes the log entry, and
   commits — staging only what the purge touched, never the user's unrelated work.
   Then:
   - open an ordinary relink operation before repairing references on every
     COLLATERAL page (the log entry lists them);
   - regenerate the catalog: `node "<absolute-plugin-root>/scripts/index-gen.mjs"`;
   - [validate changed paths](../../wiki-setup/references/validation.md), log and close that repair operation through the shared contract,
     preserving already-dirty files. Never `git add -A`. The purge transaction
     itself already owns its commit and must not be wrapped in a competing one.
     Defer publication of both commits until the explicit push approval in step 5.

5. **Ask before pushing.** A push publishes the removal to every machine. Ask
   plainly — "publish this purge to the configured upstream?" — and only on a
   yes run `node "<absolute-plugin-root>/scripts/wiki-sync.mjs"` and verify remote
   publication through the shared completion contract. If the vault is not a Git
   repo, say plainly that the purge is local and will not reach other copies.

6. **Verify — on the broken-link count, not the score.**
   Repeat the direct [broken-link check](../../wiki-setup/references/checks.md#purge-broken-link-verification) and compare with the saved baseline. The count must not have grown. Inspect collateral and report actual publication state; a better score never proves a safe purge.

## When a purge stops partway

Use [interrupted-purge recovery](../../wiki-setup/references/operation-recovery.md#interrupted-purge) to inspect and finish the same authorized transaction. Do not rerun `--apply` as a substitute; preserve its original manifest, scope and publication boundary.

## Restoring

`node "<absolute-plugin-root>/scripts/purge.mjs" --restore <purge-id>` puts everything
back and commits.

- It never overwrites a file already at the original path — that is newer work, and
  it is reported as **skipped** instead.
- It clears the declines this purge recorded, so researcher discovery can find those
  sources again. Declines made for other reasons are left alone.
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
- **Never `git add -A` in a vault.** Stage the paths the operation touched. The
  vault carries the user's in-progress writing, and a commit that sweeps it up is
  both mislabelled and impossible to revert cleanly.
- **An empty result is not an answer.** If `--plan` reports no wiki pages for a
  topic, inspect its search diagnostics: the helper refuses to trust an empty
  result when the primary wiki keyword scan failed. Do not reinterpret unavailable
  coverage as "this topic does not exist"; use [search diagnostics](../../wiki-setup/references/search-diagnostics.md) when needed. Healthy search still requires reviewing
  seeds for relevance; it does not authorize applying a plan.
