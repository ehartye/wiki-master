---
name: wiki-repair
description: Use when asked to resolve wiki integrity defects, fix broken citations, or repair the wiki health worklist. For reporting only use wiki-health; useful new relationships belong to wiki-relink and factual review to wiki-lint.
---

# Repairing wiki integrity

Read [the shared core](../wiki-maintainer/SKILL.md) once per session, plus
[access](../wiki-maintainer/references/access.md),
[evidence](../wiki-maintainer/references/evidence.md) and
[operation completion](../wiki-maintainer/references/operations.md).
Read [repair helpers](../wiki-maintainer/references/maintenance.md) only when a
finding calls for one. Helpers resolve from this installed skill's plugin root.

**The deterministic worklist owns the metric.** Run
`node "<absolute-plugin-root>/scripts/health.mjs" --json` and retain the initial
`issues`, their IDs, `defectCount` and coverage. A scan failure is not zero defects.
An empty scan establishes nothing about health. This checks structural integrity,
not factual truth or completeness; see `coverage.notChecked`.

**Preserve intentional forward links.** `forwardLinks` are unscored navigation,
not repair obligations. Age, demand and name similarity never prove a defect.
Do not replace Federalist No. 45 with No. 10 because their names look close.
Do not create empty pages, delete useful links/citations, add unrelated evidence,
or change a page to `stub` / `sources: []` just to reduce the count. A declaration
of a source is a citation contract even on a stub.

1. **Bound the work.** Honor requested issue IDs or page scope; otherwise process
   the worklist in manageable batches. For preview/report-only requests, return
   the findings without writes, logs or commits. Use one writer for a repair run.
   If a parent delegates a batch, agree who owns the enclosing operation and final
   verification; do not open competing operations or commit another worker's files.
2. **Investigate each issue.** Read its current source and surrounding prose; line
   numbers can move. For `unresolved-citation`, locate the intended evidence and
   verify the supported claim. A unique matching source hash can establish the
   clipping's identity; similarity cannot. For `ambiguous-link`, read candidates
   and qualify the intended canonical path. For `malformed-link`, establish the
   intended syntax/target before editing. For `missing-evidence`, inspect substantive
   claims and their provenance; missing support needs evidence work, not invented
   citations. Raw bodies remain immutable. The issue's `verification` gives its
   acceptance condition; recheck that the proposed repair actually satisfies it.
3. **Apply justified repairs.** Before the first authorized write, open
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op relink` and retain its
   token, unless an enclosing operation already owns completion. Edit only the
   assigned pages. Preserve `reviewed` for mechanical edits. If a helper's apply
   mode edits the whole vault, use it only when that full scope is authorized;
   otherwise make the verified edit to the selected page.
4. **Verify progress, then stop or continue.** Rerun health JSON after each batch.
   Compare issue IDs, not just totals: record resolved, remaining and new IDs.
   Inspect the diff and supporting evidence to ensure resolved IDs represent real
   repairs, not removed claims or weakened declarations. Fix any new defects your
   edits introduced. Stop when assigned defects are verified resolved, or when
   remaining issues need unavailable evidence, user judgment or additional scope.
   Explain the concrete blocker per ID; do not loop on a batch with no verified
   progress. Unresolved navigation stays outside the remaining-defect count.
5. **Complete the operation.** For applied changes, validate affected catalogs,
   write one `log-entry.mjs --op relink` narrative and close with
   `op-commit.mjs --op relink --title "<summary>" --since <saved-token>`, using the
   absolute helper paths and shell-safe examples in the completion reference.
   Inspect the actual committed paths and index-refresh notices; sync when already
   authorized. Report before/after defect counts, verified resolved IDs, remaining
   IDs with reasons, new IDs, and commit/sync status. If nothing changed, no operation
   is needed. Never claim zero defects merely because the assigned batch is done.
