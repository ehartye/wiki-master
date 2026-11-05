---
name: wiki-setup
description: Use when asked to initialize a wiki vault, install or configure Obsidian Git, check prerequisites, validate authored paths, report health, freshness, lint or ingest-backlog counts, diagnose search/index/app access failures, troubleshoot capture tools, or recover from a failed setup, a vault written but not refreshed, an Obsidian Git error or a conflict-files-obsidian-git.md file. Reports and diagnosis are read-only; content repairs belong to wiki-maintainer.
---

# Set up, check and diagnose the wiki

Obsidian Git handles all git operations. It is a prerequisite: without it a vault can
be read and searched, but `refresh-index.mjs`, the last step of every authoring task,
refuses to run. `setup-obsidian-git.mjs --check` reports where the vault stands. When setup, a check or a refresh finds it falling short,
offer to install, enable and configure it. The owner's yes is the permission, and
`setup-obsidian-git.mjs --apply` then does it. Existing settings are reported, never
overwritten: a setting that differs is the owner's to change in Obsidian Git's settings.

Run the smallest procedure that answers the request. Reports, validation and
diagnosis are read-only: no log, index refresh, repair or install, and no git command
that changes the repository. Initialization and recovery require the requested scope;
a diagnostic result does not authorize installing tools, rebuilding indexes, editing content or adding a remote.

## Workflow

1. Resolve the vault and absolute installed helpers from
   [access](../wiki-maintainer/references/access.md). Read the actual applicable
   vault `AGENTS.md` before the first helper; do not infer its contents from a
   helper's output or skip it for validation-only work.
   Confirm the intended target and whether the request is report-only or authorizes
   a particular setup/recovery action. No app is needed for filesystem checks.
   For a vault other than the default, every command of the task names it, in the
   named form under First run, or it acts on the default vault instead. This skill
   writes its commands by short name.
2. Select the matching procedure below. Run bounded checks and retain their actual
   exit codes, coverage and output. Distinguish no findings from failed coverage.
3. Explain the diagnosed state and its limits. If repair was not requested, stop
   with the report. Content defects route to
   [wiki-maintainer](../wiki-maintainer/SKILL.md); original documentation to
   [wiki-project](../wiki-project/SKILL.md).
4. Before an authorized change, read
   [completion](../wiki-maintainer/references/operations.md) and
   [evidence](../wiki-maintainer/references/evidence.md); preserve other writers' edits
   and execute only the requested remedy. Verify its result using the relevant check.
   A change to vault content ends: validate, log once, run `refresh-index.mjs`. Only a
   declined install stops short of the refresh.

## First run

The order for a new vault; [initialization](references/initialization.md) has the detail.
Every command in it names the vault, in the named form for your shell. Only the default
vault can leave `WIKI_MASTER_VAULT` off.

- PowerShell: `if ($env:WIKI_MASTER_VAULT='<root>') { node "<absolute-plugin-root>/scripts/<script>.mjs" <args> }`
- POSIX shell: `WIKI_MASTER_VAULT='<root>' node "<absolute-plugin-root>/scripts/<script>.mjs" <args>`

1. State the prerequisites: Obsidian with its command line interface on, Obsidian Git,
   Ollama with the embedding model, and a git repository with an upstream.
2. Run `init.mjs`.
3. The owner sets up the git repository and upstream. This skill does not create either.
4. Have the owner open the vault in Obsidian, trust it, and turn off restricted mode
   under Settings > Community plugins. Every new vault starts with it on.
5. Offer the install. On a yes, run `setup-obsidian-git.mjs --apply`.
6. Run `refresh-index.mjs` last.

If the owner declines the install, stop there. A decline given up front counts: run
`init.mjs` and stop. Report that the vault can be read and searched (keyword search,
until a refresh builds the semantic index), that authoring cannot complete, and to
rerun setup later. `refresh-index.mjs` is not run.

## Procedures and examples

- **Initialize:** read [initialization](references/initialization.md).
  Request: “Set up this new vault.” Action: preflight existing files and templates,
  then follow the first-run order above. Result: usable filesystem layout, existing
  content preserved, and Obsidian Git and refresh state stated.
- **Install Obsidian Git:** read [initialization](references/initialization.md#install-obsidian-git).
  Request: “Set up Obsidian Git in this vault.” Action: run `--check`, offer, and run
  `--apply` on a yes. Result: the plugin enabled with its settings met, differences
  reported, or the block and its manual steps.
- **Validate changed pages:** read [scoped validation](references/validation.md).
  Request: “Validate these authored paths only.” Action:
  `validate-authored.mjs --paths-file "<ledger>" --json`.
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
- **Authorized recovery:** read [recovery](references/operation-recovery.md).
  Request: “The refresh failed after my edits.” Action: read what `refresh-index.mjs`
  named, offer each fix, and rerun it once fixed. An Obsidian Git error or a
  `conflict-files-obsidian-git.md` file goes to the owner. Result: a current index,
  or an exact blocker reported as written but not refreshed.

## Best practices

Read-only means no cache-producing embedding evaluation either: use drift
`--coverage` for reports. A healthy graph is not factual verification; index
freshness is not a review date. Preserve failed checks and partial coverage in the
report. Check the current target before retrying an uncertain change.

## Advanced references

The procedures above are conditional: load only the one the requested check needs.
Bounded embedding evaluation and verification cadence are in
[checks](references/checks.md#bounded-maintenance-evaluation); refresh failures,
Obsidian Git errors and interrupted purge reconciliation are in
[recovery](references/operation-recovery.md). Follow the original action owner's
authorization boundaries even when setup supplies its diagnostic recipe.

## Done

A report states actual findings, checked scope, skipped/failed coverage and makes
no changes. Authorized setup or recovery verifies the requested effect and says it
is on disk and that Obsidian Git publishes it on its next run; unresolved work has a
precise next action.
