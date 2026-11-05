---
name: wiki-purge
description: Use when explicitly asked to purge or remove a topic and its evidence from the wiki, preview its removal plan, restore a purge, or reconcile an interrupted removal or another machine's copy. Applying a purge requires a reviewed plan and one explicit approval, which states that Obsidian Git publishes the removal on its next run; content repair belongs to wiki-maintainer and diagnostic checks to wiki-setup.
---

# Preview, purge or restore a topic

Remove only the approved topic and its evidence closure, preserving collateral
knowledge and recoverability. Selecting this skill is not approval to apply a
removal.

## Workflow

1. Read [purge procedure](references/purge.md),
   [access](../wiki-maintainer/references/access.md),
   [evidence](../wiki-maintainer/references/evidence.md) and
   [completion](../wiki-maintainer/references/operations.md). Resolve the
   intended vault and open applicable instructions. Confirm preview, apply,
   restore or authorized reconciliation scope.
2. Before mutation, retain the
   [broken-link baseline](../wiki-setup/references/checks.md#purge-broken-link-verification).
   Preview-only requests do not run mutating reconciliation.
3. Generate the plan, inspect every seed and search coverage, pin corrected seeds,
   then present layer counts, collateral and blocking pages for one explicit approval,
   stating that Obsidian Git publishes the removal on its next run. Nothing else asks
   later. Resolve blocking dependencies before applying. A relevance score is not consent.
4. Apply only the approved plan with the same pinned seeds. The helper owns
   manifest, moves, declines and log, so write no second entry. Repair authorized
   collateral in hand-written text and [validate changed paths](../wiki-setup/references/validation.md);
   a generated fence clears itself at the refresh.
   If interrupted, follow [recovery](../wiki-setup/references/operation-recovery.md#interrupted-purge)
   for the same transaction instead of applying another plan.
5. Run `refresh-index.mjs` once, as [completion](../wiki-maintainer/references/operations.md)
   describes, then verify the broken-link count did not grow: catalogs list purged pages
   until the refresh. Report the transaction ID, actual moved/restored/skipped/missing
   paths and blockers: the work is on disk and Obsidian Git publishes it on its next run.

## Examples

- **Preview:** Request: “Show what removing the obsolete Beacon topic would affect.”
  Action: run `purge.mjs --plan "Beacon"`, inspect matched pages and produce a
  pinned plan if necessary. Result: proposed removals and named collateral/blockers;
  no reconciliation, moves, log or refresh.
- **Approved removal:** Request: “Apply that reviewed plan.” Action: use the same
  seeds, repair authorized collateral, refresh and compare broken-link counts.
  Result: a reversible purge transaction on disk, already covered by the plan's approval.
- **Restore:** Request: “Restore purge `<id>`.” Action: run
  `purge.mjs --restore <id>`, inspect every skipped or missing entry, then refresh.
  Result: restored files without overwriting newer work; report partial restoration
  honestly.
- **Reconcile:** Request: “Finish the interrupted purge `<id>`.” Action: inspect
  the saved transaction through the linked recovery procedure and run the
  authorized reconciliation, then refresh. Result: the original purge is completed
  or an exact blocker remains; a second empty purge is never substituted.

## Best practices

Never hard-delete the recycle bin or use its contents as evidence. Review seeds
by content, not ranking. A better health score does not prove collateral repair;
compare broken-link counts. Preserve newer files on restore, and never turn
missing capture/search coverage into a claim that a topic does not exist.

## Advanced references

The [complete purge procedure](references/purge.md) owns apply/restore approval
and transaction semantics. Setup owns [checks](../wiki-setup/references/checks.md),
[search diagnostics](../wiki-setup/references/search-diagnostics.md) and
[interrupted recovery](../wiki-setup/references/operation-recovery.md#interrupted-purge).
Use [maintainer repair](../wiki-maintainer/references/repair.md) for authorized collateral.

## Done

A preview has a reviewed, scoped plan and no mutation. An applied or restored
transaction is verified, collateral is accounted for, and it is refreshed or reported
as written but not refreshed. Missing files, an unreadable manifest or an incomplete
transaction are reported as blockers.
