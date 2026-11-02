---
name: wiki-purge
description: Use when explicitly asked to purge or remove a topic and its evidence from the wiki, preview its removal plan, restore a purge, or reconcile interrupted removal. Applying a purge requires a reviewed plan and explicit publication approval; content repair belongs to wiki-maintainer and diagnostic checks to wiki-setup.
---

# Preview, purge or restore a topic

Remove only the approved topic and its evidence closure, preserving collateral
knowledge and recoverability. Selecting this skill is not approval to apply or
publish a removal. Purge owns its transaction; do not wrap it in an ordinary one.

## Workflow

1. Read [purge procedure](references/purge.md),
   [access](../wiki-maintainer/references/access.md),
   [evidence](../wiki-maintainer/references/evidence.md) and
   [operation completion](../wiki-maintainer/references/operations.md). Resolve the
   intended vault and open applicable instructions. Confirm preview, apply,
   restore or authorized reconciliation scope.
2. Before mutation, check [actual history connectivity](../wiki-setup/references/operation-recovery.md#purge-history-connectivity) and retain the
   [broken-link baseline](../wiki-setup/references/checks.md#purge-broken-link-verification).
   Missing coverage/upstream differs from unrelated histories; never guess a new
   remote or canonical history. Preview-only requests do not run mutating reconciliation.
3. Generate the plan, inspect every seed and search coverage, pin corrected seeds,
   then present layer counts, collateral and blocking pages for explicit approval.
   Resolve blocking dependencies before applying. A relevance score is not consent.
4. Apply only the approved plan with the same pinned seeds. The helper owns
   manifest, moves, declines, log and commit. Repair authorized collateral in a
   separate scoped relink operation; [validate changed paths](../wiki-setup/references/validation.md).
   Hold both commits until explicit publication approval, then sync and verify.
5. Verify the broken-link count did not grow and report the transaction ID,
   actual moved/restored/skipped/missing paths and publication state. If interrupted,
   follow [recovery](../wiki-setup/references/operation-recovery.md#interrupted-purge)
   for the same transaction instead of applying another empty plan.

## Examples

- **Preview:** Request: “Show what removing the obsolete Beacon topic would affect.”
  Action: run `purge.mjs --plan "Beacon"`, inspect matched pages and produce a
  pinned plan if necessary. Result: proposed removals and named collateral/blockers;
  no reconciliation, moves, operation, log or commit.
- **Approved removal:** Request: “Apply that reviewed plan.” Action: use the same
  seeds, repair authorized collateral and compare broken-link counts. Result:
  a reversible local purge transaction; ask for publication approval if it has
  not already been explicitly supplied.
- **Restore:** Request: “Restore purge `<id>`.” Action: run
  `purge.mjs --restore <id>` and inspect every skipped or missing entry.
  Result: restored files without overwriting newer work; report partial restoration
  honestly and honor the transaction's publication authorization.
- **Reconcile:** Request: “Finish the interrupted purge `<id>`.” Action: inspect
  the saved transaction through the linked recovery procedure and run the
  authorized reconciliation. Result: the original purge is completed or an exact
  blocker remains; a second empty purge is never substituted.

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

A preview has a reviewed, scoped plan and no mutation. An applied/restored
transaction is verified, collateral is accounted for, and publication is either
explicitly approved and verified or truthfully held/local-only. Missing files,
unrelated history or an incomplete transaction are reported as blockers.
