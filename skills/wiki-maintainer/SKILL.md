---
name: wiki-maintainer
description: Use when asked to repair wiki citations or links, correct factual claims, connect concepts and task maps, apply triage decisions, file an authorized provenance-derived synthesis, or perform a native Obsidian action. Read-only health, freshness, lint and backlog reports belong to wiki-setup; original project documentation belongs to wiki-project.
---

# Maintain content and perform requested app actions

Repair the requested knowledge or navigation while preserving its evidence and
other writers' work. A report alone does not authorize edits; a search answer does
not authorize filing. Pure filesystem maintenance needs no running app.

## Workflow

1. Read [access](references/access.md), resolve the known vault and absolute
   installed helpers, and open its applicable instructions. Select the requested
   action below; use [wiki-setup](../wiki-setup/SKILL.md) for report-only work.
2. Inspect the exact pages, current evidence and requested scope. Read
   [evidence](references/evidence.md) before factual changes and
   [identity and relationships](references/efficacy.md) before concept/navigation
   changes. Use the relevant direct setup check to establish the baseline.
3. Before a content or pipeline-state write, read
   [operation completion](references/operations.md), open or reuse the owned
   operation and retain the exact-path ledger. Native actions use the guarded
   adapter; a UI-only action does not require a content operation.
4. Make only justified changes. Preserve raw bodies, restrictions and factual
   review dates on mechanical edits. If support is missing or the intended change
   is uncertain, report the concrete remaining decision instead of inventing it.
5. Recheck the requested effect and [validate the changed paths](../wiki-setup/references/validation.md).
   Refresh affected owned catalogs, log once, close the scoped operation, sync and
   verify publication unless the user holds it. Report actual results and blockers.

## Modes and examples

- **Integrity repair:** read [repair](references/repair.md).
  Request: “Fix this broken citation.” Action: read the citing claim and exact
  source, repair its path within scope, compare issue IDs with the
  [health check](../wiki-setup/references/checks.md#health-and-ingest-backlog).
  Result: a verified citation repair and scoped publication, with unresolved IDs named.
- **Factual correction:** read [factual maintenance](references/lint.md).
  Request: “Correct the unsupported quotation on this page.” Action: inspect the
  [lint finding](../wiki-setup/references/checks.md#content-lint-report) and raw passage,
  correct or mark the claim, then record the reviewed disposition. Result: supported
  text and an honest factual-review date, without changing the raw clipping.
- **Relationships and navigation:** read [relink](references/relink.md).
  Request: “Connect queue ordering to retry budgets.” Action: read both pages,
  accept only an explained relationship and update the relevant task map.
  Result: a useful navigational link with its limits, not an unsupported causal claim.
- **Triage:** read [triage](references/triage.md).
  Request: “Show the capture issues from this research run.” Action: present the
  queue's token-bearing link and topic summary. Result: the user can disposition
  the issues; opening the queue does not apply re-clips or quarantine. When asked
  to apply selected dispositions, act on those selections, validate affected
  content and complete the owned operation.
- **Authorized synthesis filing:** read [synthesis filing](references/synthesis-filing.md).
  Request: “File this cited answer as a synthesis.” Action: verify its provenance,
  reuse or create the proper synthesis and complete a **query** operation.
  Result: a sourced, validated, published page. Original project prose routes to
  [wiki-project](../wiki-project/SKILL.md).
- **Native action:** read [Obsidian actions](references/obsidian-cli.md).
  Request: “Open the Beacon architecture note in Obsidian.” Action: invoke the
  guarded helper with the exact note path. Result: the requested app action, or a
  specific unavailable-action report using [app diagnostics](../wiki-setup/references/app-access.md).
  A filesystem read is never reported as a successful UI action.

## Best practices

Compare resolved, remaining and new issue IDs rather than chasing a score. A
clean graph is not factual verification. Keep checks bounded to the task; skip
empty-vault or unchanged-wiki semantic sweeps. Distinguish preview from apply,
and inspect the target after an uncertain native mutation before retrying.

## Advanced references

Load [repair recipes and the hash-join contract](references/maintenance.md) only
for the indicated repair; [workflow overview](references/workflows.md) only to
compare roles. Required check procedures are directly available in
[checks](../wiki-setup/references/checks.md), [validation](../wiki-setup/references/validation.md)
and [operation recovery](../wiki-setup/references/operation-recovery.md).
Removal retains separate approval boundaries in [wiki-purge](../wiki-purge/SKILL.md).

## Done

The requested effects are verified, remaining issues and coverage limits are
stated, and every owned content mutation is validated and accounted for through
publication or an explicit hold/local-only/blocker. Preview-only work has no
content operation, log, commit or refresh.
