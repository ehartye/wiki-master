---
name: wiki-setup
description: Use when asked to initialize a wiki vault, check prerequisites, validate authored paths, report health, freshness, lint or ingest-backlog counts, diagnose search/index/app access failures, troubleshoot capture tools, or recover an explicitly authorized setup or operation failure. Reports and diagnosis are read-only; content repairs belong to wiki-maintainer.
---

# Set up, check and diagnose the wiki

Run the smallest procedure that answers the request. Reports, validation and
diagnosis are read-only: no operation, log, commit, index refresh or repair.
Initialization and recovery require the requested scope; a diagnostic result does
not authorize installing tools, rebuilding indexes, editing content or adding a remote.

## Workflow

1. Resolve the vault and absolute installed helpers from
   [access](../wiki-maintainer/references/access.md). Read the actual applicable
   vault `AGENTS.md` before the first helper; do not infer its contents from a
   helper's output or skip it for validation-only work.
   Confirm the intended target and whether the request is report-only or authorizes
   a particular setup/recovery action. No app is needed for filesystem checks.
2. Select the matching procedure below. Run bounded checks and retain their actual
   exit codes, coverage and output. Distinguish no findings from failed coverage.
3. Explain the diagnosed state and its limits. If repair was not requested, stop
   with the report. Content defects route to
   [wiki-maintainer](../wiki-maintainer/SKILL.md); original documentation to
   [wiki-project](../wiki-project/SKILL.md).
4. Before an authorized mutation, read
   [operation completion](../wiki-maintainer/references/operations.md) and
   [evidence](../wiki-maintainer/references/evidence.md); inspect existing operation
   state, preserve foreign edits and execute only the requested remedy. Verify
   its result using the relevant check and complete its owned transaction.

## Procedures and examples

- **Initialize:** read [initialization](references/initialization.md).
  Request: “Set up this new vault.” Action: preflight existing files and templates,
  open an operation, run `init.mjs` only when it cannot overwrite customized
  templates, inspect scaffold/health, log and close. Result: usable filesystem
  layout, existing content preserved, app registration and local-only status stated.
- **Validate changed pages:** read [scoped validation](references/validation.md).
  Request: “Validate these authored paths only.” Action:
  `node "<absolute-plugin-root>/scripts/validate-authored.mjs" --paths-file "<ledger>" --json`.
  Result: checked/skipped counts and exact defects; no repairs or writes.
- **Health and backlog:** read [checks and metrics](references/checks.md#health-and-ingest-backlog).
  Request: “How healthy is the wiki, and how many captures need ingestion?” Action:
  run `health.mjs --json` and `health.mjs --backlog`. Result: open integrity defects,
  coverage and the unsummarized-source count; no ingestion.
- **Freshness or lint:** read [freshness](references/checks.md#freshness-and-drift-coverage)
  or [content lint](references/checks.md#content-lint-report).
  Request: “Report stale pages and unsupported quotations.” Action: run read-only
  stale, drift coverage and scoped lint checks. Result: missing-review/stale pages,
  quote findings and coverage; dates, dispositions and content remain unchanged.
- **Search diagnosis:** read [search diagnostics](references/search-diagnostics.md).
  Request: “Why is search lexical only?” Action: run `search.mjs --health`, inspect
  backend/index state and report the cause. Result: an evidence-based diagnosis;
  displayed remediation commands are not executed without authorization.
- **Capture prerequisites:** read [capture prerequisites](references/capture-prerequisites.md).
  Request: “Check whether this machine can clip a presentation.” Action: inspect
  the PowerPoint converter prerequisites. Result: available/missing tools and
  supported fallback, with no invented capture or automatic installation.
- **App access:** read [app access](references/app-access.md).
  Request: “The native note-open action failed.” Action: inspect the guarded
  adapter's failure and canary result once. Result: the unavailable app action is
  reported honestly; independent filesystem work can continue.
- **Authorized recovery:** read [operation recovery](references/operation-recovery.md).
  Request: “Recover my failed scoped publication.” Action: reconcile the saved
  token, ledger and actual commit, retry only the unfinished step and verify the
  remote. Result: recovered publication or an exact blocker without duplicate edits.

## Best practices

Read-only means no cache-producing embedding evaluation either: use drift
`--coverage` for reports. A healthy graph is not factual verification; index
freshness is not a review date. Preserve failed checks and partial coverage in the
report. Check the current target before retrying an uncertain mutation. Never
remove another writer's token or Git lock to make a command succeed.

## Advanced references

The procedures above are conditional: load only the one the requested check needs.
Bounded embedding evaluation and verification cadence are in
[checks](references/checks.md#bounded-maintenance-evaluation); operation refusals,
Git settings and interrupted purge reconciliation are in
[recovery](references/operation-recovery.md). Follow the original action owner's
authorization boundaries even when setup supplies its diagnostic recipe.

## Done

A report states actual findings, checked scope, skipped/failed coverage and makes
no changes. Authorized setup/recovery verifies the requested effect and accounts
for its transaction/publication state; unresolved work has a precise next action.
