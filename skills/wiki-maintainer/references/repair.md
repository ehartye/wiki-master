# Repairing wiki integrity

Read [access](access.md),
[evidence](evidence.md) and
[completion](operations.md).
Read [repair helpers](maintenance.md) only when a
finding calls for one. Helpers resolve from this installed skill's plugin root.

**Establish the worklist.** Run `node "<absolute-plugin-root>/scripts/health.mjs" --json`
through the direct [health procedure](../../wiki-setup/references/checks.md#health-and-ingest-backlog). Retain initial issue IDs, defect count and coverage; a failed or empty scan proves nothing about health.

**Preserve intentional forward links.** `forwardLinks` are unscored navigation,
not repair obligations. Age, demand and name similarity never prove a defect.
Do not replace one numbered source with another because their names look close.
Do not create empty pages, delete useful links/citations, add unrelated evidence,
or change a page to `stub` / `sources: []` just to reduce the count. A declaration
of a source is a citation contract even on a stub.

1. **Bound the work.** Honor requested issue IDs or page scope; otherwise process
   the worklist in manageable batches. For preview/report-only requests, return
   the findings without writes or logs. Use one writer for a repair run. If a parent
   delegates a batch, the worker keeps its edits to the assigned pages and reports the
   paths it wrote; the enclosing task does the final verification and completion.
2. **Investigate each issue.** Read its current source and surrounding prose; line
   numbers can move. For `unresolved-citation`, locate the intended evidence and
   verify the supported claim. A unique matching source hash can establish the
   clipping's identity; similarity cannot. For `ambiguous-link`, read candidates
   and qualify the intended canonical path; `repair-ambiguous-links.mjs` (dry run first)
   does the one safe case, a project page with a single candidate in its own project,
   and reports the rest with a reason. For `malformed-link`, establish the
   intended syntax/target before editing. For `malformed-frontmatter`, the page's
   metadata was not read: look at the bytes of its fence lines, normalise only the
   damaged line ending (or close the fence) and change no text. For `missing-evidence`, inspect substantive
   claims and their provenance; missing support needs evidence work, not invented
   citations. For `cites-retired-page`, the cited page is marked
   `citation-status: retired` and says it must not be cited as support: find evidence
   that supports the claim or drop the claim, and never clear the issue by removing the
   marker. Raw bodies remain immutable. The issue's `verification` gives its
   acceptance condition; recheck that the proposed repair actually satisfies it.
3. **Apply justified repairs.** Keep your edits to what your task needs: only the
   assigned pages. Preserve `reviewed` for mechanical edits. If a helper's apply
   mode edits the whole vault, use it only when that full scope is authorized;
   otherwise make the verified edit to the selected page.
4. **Verify progress, then stop or continue.** Rerun the direct [health check](../../wiki-setup/references/checks.md#health-and-ingest-backlog) after each batch.
   Compare issue IDs, not just totals: record resolved, remaining and new IDs.
   Inspect the changed text and supporting evidence to ensure resolved IDs represent real
   repairs, not removed claims or weakened declarations. Fix any new defects your
   edits introduced. Stop when assigned defects are verified resolved, or when
   remaining issues need unavailable evidence, user judgment or additional scope.
   Explain the concrete blocker per ID; do not loop on a batch with no verified
   progress. Unresolved navigation stays outside the remaining-defect count.
5. **Finish.** For applied changes, follow [completion](operations.md) with
   `--op relink`, ending at `refresh-index.mjs`. Report before/after defect counts,
   verified resolved IDs, remaining IDs with reasons, new IDs, and whether the refresh
   ran. If nothing changed, no log or refresh is needed. Never claim zero defects
   merely because the assigned batch is done.
