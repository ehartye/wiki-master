# Correct factual claims and record reviewed findings

Read [access](access.md), [evidence](evidence.md), [identity](efficacy.md) and
[completion](operations.md). This procedure owns authorized corrections
and persisted dispositions. A report-only request uses [setup lint reporting](../../wiki-setup/references/checks.md#content-lint-report) and writes nothing.

1. Establish relevant findings through the direct [health check](../../wiki-setup/references/checks.md#health-and-ingest-backlog),
   [bounded maintenance evaluation](../../wiki-setup/references/checks.md#bounded-maintenance-evaluation)
   and [content lint](../../wiki-setup/references/checks.md#content-lint-report).
   Stop for an empty wiki; a clean graph still needs bounded claim review during
   substantive maintenance. Report the actual sample and failed/skipped coverage.
   When verdicts are to be recorded, save the `findings` array of
   `lint.mjs --json` to a file outside the vault now, before any repair in
   step 3; step 5 records from it.
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
   repeatedly presented as new. Read the findings first, repair what needs it,
   then record by quote: a repair that adds a source to a page gives every quote
   finding on that page a new id, so ids read before the repair no longer match.
   - **Quote findings, after the repair:** keep, in the file saved at step 1,
     only the findings that share one verdict, and run:

     ```sh
     node "<absolute-plugin-root>/scripts/lint-disposition.mjs" record --by-quote=<file> --disposition=accepted --reviewer=<name>
     ```

     Each entry needs a string `page` and `quote`; other fields are ignored.
     `record` finds each entry's current id on its page and needs no scope. An
     entry that matches more than one finding is refused, so give each quote in
     full, not shortened with `...`.
   - **Style flags, and findings whose ids are still current:** record by id
     with one authorized scope, `--page=<path>`, `--paths-file=<ledger>` or
     `--whole-vault`:

     ```sh
     node "<absolute-plugin-root>/scripts/lint-disposition.mjs" record --ids=<id>,<id> --disposition=own-wording --reviewer=<name> --page=<path>
     ```

   - **Corrected quotes:** a quote you corrected so it verifies leaves the
     listing on its own and needs no record; leave it out of the file, since its
     old text matches nothing. To keep a record of the correction, record
     `fixed` by id before editing the quote, while its id still matches.
   - **Verdict:** `own-wording`, `mention`, `title`, `markup` or `accepted`;
     `fixed` only for a quote actually corrected; `source-wording` for style
     flags only, when the flagged word or contrast is the cited source's wording
     kept without quotation marks.
   - **Misses:** a call fails whole and writes nothing when any id or entry
     matches nothing or is refused. Add `--skip-missing` to record the rest.

   Done when the `recorded N verdict(s)` line names every finding you decided,
   and each skipped or refused one it names is decided again or reported. A
   changed quote or replaced clipping is a new finding and needs a new reading;
   a finding still present after `fixed` is listed again. Reword a style flag's
   sentence and it is a new flag.
6. Recheck the affected findings, then follow [completion](operations.md) with
   `--op lint`. If no edit or disposition was applied, return the report with no log
   or refresh.

**Done:** applied corrections are supported and verified, reviewed dispositions
match actual inspection, untouched raw evidence and factual dates are preserved,
and the work is logged and refreshed, or reported as written but not refreshed.
