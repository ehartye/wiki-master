# Correct factual claims and record reviewed findings

Read [access](access.md), [evidence](evidence.md), [identity](efficacy.md) and
[completion](operations.md). This procedure owns authorized corrections
and persisted dispositions. A report-only request uses [setup lint reporting](../../wiki-setup/references/checks.md#content-lint-report) and writes nothing.

1. Establish relevant findings through the direct [health check](../../wiki-setup/references/checks.md#health-and-ingest-backlog),
   [bounded maintenance evaluation](../../wiki-setup/references/checks.md#bounded-maintenance-evaluation)
   and [content lint](../../wiki-setup/references/checks.md#content-lint-report).
   Stop for an empty wiki; a clean graph still needs bounded claim review during
   substantive maintenance. Report the actual sample and failed/skipped coverage.
2. Read flagged pages and exact supporting clippings. Check the citation trail
   before correcting a quote: an ambiguous or misrouted citation can produce the
   apparent mismatch. Inspect contradictions, superseded claims, unwritten
   concepts and missing connections. Similarity is never truth verification.
3. Decide each finding from evidence. Restore omitted clauses or add an honest
   ellipsis for real gaps; correct actual drift against the clipping. Own wording,
   mention/title quotes and retracted claims may be conventions to ignore. Mark
   claims unsourced when support is absent; never invent evidence or edit raw
   text to agree with the summary. Route structural repairs to [repair](repair.md)
   within the authorized scope. Propose unresolved changes without applying them.
4. Keep your edits to what your task needs. Set `updated` on edited pages; set
   `reviewed` only for claims actually checked against evidence or project behavior. Mechanical links, aliases and formatting preserve factual dates.
   For original authored documentation, use [project authoring](../../wiki-project/references/authoring.md).
5. Persist reviewed dispositions when requested, so the same finding is not
   repeatedly presented as new. Obtain IDs through the linked lint procedure,
   then run:

   ```sh
   node "<absolute-plugin-root>/scripts/lint-disposition.mjs" record --ids=<id>,<id> --disposition=own-wording --reviewer=<name> --page=<path>
   ```

   Select the actual verdict: `own-wording`, `mention`, `title`, `markup` or
   `accepted`; use `fixed` only for a quote actually corrected. The supported
   scope choices are `--page=<path>`, `--paths-file=<ledger>` or `--whole-vault`;
   select only the authorized scope. A changed quote or replaced clipping is a new finding and needs a new
   reading; a finding still present after `fixed` is listed again. A style flag takes
   the same command with its own id; reword its sentence and it is a new flag.
6. Recheck the affected findings, then follow [completion](operations.md) with
   `--op lint`. If no edit or disposition was applied, return the report with no log
   or refresh.

**Done:** applied corrections are supported and verified, reviewed dispositions
match actual inspection, untouched raw evidence and factual dates are preserved,
and the work is logged and refreshed, or reported as written but not refreshed.
