# WP2 — Search, project, setup and shared contracts

Source baseline: `8720f90` (0.88.0). This package follows the independent
[WP1 PASS](wp1-review.md). The implementation is an unreleased source candidate;
runtime helpers and interfaces are unchanged. Candidate behavioral execution and
fresh review are separate artifacts and are not inferred from the checks below.

## Implemented ownership

| Owner | Stable files | Responsibility |
|---|---|---|
| search | `SKILL.md`, `references/advanced.md`, `references/answers.md` | Executable simple lookup in main; filters, alias/title disambiguation, raw evidence, provenance and cited answers; strictly read-only |
| project | `SKILL.md`, `references/authoring.md`, `backlog.md`, `catalogs.md` | Original documentation, placement/metadata, living architecture/ADRs/guides/notes, lifecycle listing, dependencies and owned catalog updates |
| setup | `SKILL.md`, `references/initialization.md` | New/partial-vault setup, template collision preflight, operation completion, separate app registration |
| setup | `references/validation.md` | Task-scoped validation, ledger format, result/skip interpretation and public-page checks |
| setup | `references/checks.md` | Health/backlog metrics, freshness/drift coverage, lint reporting, identity checks and bounded maintenance evaluation |
| setup | `references/search-diagnostics.md` | Channel/ranking/index diagnostics and authorized remediation |
| setup | `references/capture-prerequisites.md` | HTML and six format/service prerequisites, diagnostics and gotchas |
| setup | `references/app-access.md` | App registration/access, Windows redirector, lazy canary, refusal/timeout and triage session diagnosis |
| setup | `references/operation-recovery.md` | Saved operation reconciliation, cleanup/abort, close/sync refusals, byte receipts, Git configuration, verification and interrupted-purge recovery |
| maintainer | shared `access.md`, `evidence.md`, `efficacy.md`, `operations.md`, `maintenance.md` | Single-owned normal access, evidence/restrictions, identity, transaction/ownership and hash-join/content-repair contracts |
| maintainer | `references/synthesis-filing.md` | Explicitly authorized derived answer filing, preserving query operation semantics |

The retired `wiki-user` and `wiki-init` directories are absent; no forwarding
entries remain. `wiki-project`, `wiki-search` and `wiki-setup` descriptions are
portable and task-triggered, with ordered workflows, practical examples, best
practices, direct conditional references and observable done conditions.

## Baseline-informed changes

- Search main explicitly reads applicable vault instructions and bounds all reads
  to requested content paths, addressing the retained baseline's broad inventory
  and missing-instructions observation. Simple lookup loads no setup or operation
  preamble; only a requested diagnosis follows setup.
- Original documentation uses the established `relink` operation vocabulary.
  Validation guidance distinguishes actually checked authored roadmaps from skipped
  non-content paths, rather than inferring skips from generation status.
- Initialization opens its operation before scaffolding and completes local-only
  work. Source inspection confirmed `init.mjs` uses a recursive template copy that
  can overwrite customized `_templates` despite generic help text. The setup guide
  preflights collisions, preserves existing content and permits only an explicitly
  authorized missing-only scaffold instead of running the helper over collisions.
  No runtime change is made in this package.

Baseline successes remain successes. No efficacy, reduced-token or startup-byte
claim follows from author inspection. Actual candidate source snapshots, commands,
file snapshots and independent grades are needed to establish outcomes.

## Stable WP3 extraction and caller map

WP3 owns remaining main files, specialist references, maintained docs/templates,
catalog and tests. The setup procedures have already been extracted from those
baseline files; remove their canonical duplicates and replace them with direct
point-of-use links while preserving task obligations and action interfaces.

| Baseline location | WP3 change / direct canonical target |
|---|---|
| maintainer `health.md` | Reporting moves to setup `checks.md#health-and-ingest-backlog`; retire old reference and route all callers |
| maintainer `stale.md` | Reporting moves to setup `checks.md#freshness-and-drift-coverage`; retire old reference and route all callers |
| maintainer `lint.md` steps 1–3 reporting | Link setup checks `#health-and-ingest-backlog`, `#bounded-maintenance-evaluation`, `#content-lint-report`; retain actual edits and disposition-recording workflow in maintainer |
| maintainer `repair.md`, `relink.md` diagnostic calls | Preserve checks at point of use, link direct setup checks/validation; retain actual repair/relink logic and helper interfaces |
| maintainer `obsidian-cli.md` Windows invocation, Empty is not an answer, failure paragraph | Setup app access `#windows-invocation`, `#empty-output-one-lazy-canary`, `#failure-refusal-and-uncertain-mutation`; retain action syntax and guarded action authorization |
| maintainer `triage.md` remote token/port/rotation/network detail | Setup app access `#triage-ui-reachability-and-session-recovery`; retain requested `--remote` action syntax, outcomes, disposition enum and topic attribution |
| maintainer `workflows.md` | Routing overview only: retrieval search, original docs project, checks setup, authorized synthesis maintainer |
| purge `When a purge stops partway` | Setup operation recovery `#interrupted-purge`; purge retains transaction/approval ownership and direct recovery obligation |
| purge check procedures | Direct setup checks/validation; preserve before/after broken-link comparison, explicit plan/publication gates and restore safety |
| every researcher format `Steps` preflight | Direct corresponding setup capture-prerequisites format section |
| PDF PATHEXT, missing `-table`, legacy fidelity inventory/floor remedy | Setup capture prerequisites `#pdf` and `#wrong-reading-mode-or-garbled-text`; preserve capture fidelity obligations |
| PDF `Preserving figures` tool probes | Setup `#pdf`; retain figure output, selection and hash contracts |
| PDF `Overriding the reading mode` diagnostic recipe | Setup `#wrong-reading-mode-or-garbled-text`; retain supported mode flags and fidelity review obligation |
| Word converter invocation/corrupt-protected/tiny-document rationale | Setup `#word`; retain `--allow-short` interface and capture completeness obligation |
| PowerPoint interpreter fallback/install/legacy-format failure | Setup `#powerpoint`; retain format and fidelity limits |
| Spreadsheet PATHEXT/converter failure/tiny-workbook diagnosis | Setup `#spreadsheets`; retain no-PDF route and raw/structured pairing |
| GitHub auth/too-many-files/clone diagnostics | Setup `#github-repositories`; retain per-file/digest, pruning and output verification |
| Confluence Graceful degradation/Known limitation/preflight | Setup `#confluence`; retain optional dependency, capture provenance and ordinary workflow |
| researcher capture thin/wrong-node/transient/clash and supplied-file refusal diagnosis | Setup `#html-and-supplied-pages`; retain outcome table, supported capture/recapture/supplied-file interfaces |
| researcher ingest eligibility/reporting | Keep maintainer hash-join as normative; direct setup `checks.md#health-and-ingest-backlog` for report, validation for changes; no operation when no eligible work |
| researcher retrieval handoff | Search `SKILL.md` plus direct `references/advanced.md` or `answers.md` as appropriate; actually execute retrieval after ingestion |
| old user search/query/authoring links | Search main / search advanced or answers / project authoring; filing links maintainer synthesis-filing |
| old init links and helper error | Setup main or initialization procedure as appropriate |

Existing specialist public CLI docs can retain API contracts; skill-facing setup,
check and troubleshooting procedures must link the canonical setup section. Do not
mechanically replace historical evaluation or changelog references.

## Shared-contract details retained

The evidence policy retains raw immutability, exact citation paths, honesty about
unsupported claims, factual date meaning, platform separation, quarantine/retired
restrictions and editorial licenses. Concept identity retains equivalent aliases,
scope boundaries and filename/alias/navigation precedence; checking procedures
move to setup. Maintenance retains content repairs and the exact source-hash join,
while metric reporting moves to setup.

Operations still owns open-before-write, exact ledgers, foreign-edit exclusion,
normal catalogs/log/commit/sync/remote completion, explicit holds, delegated-owner
responsibility, purge exceptions and portable shell examples. Recovery retains
pre-dirty/include reconciliation, unscoped guard, evidence maps, lock/conflict and
overlap refusal semantics, cleanup/abort boundaries and actual-publication checks.

## Author checks

- Direct local file/heading inspection over 21 owned Markdown files: PASS.
  This check intentionally does not certify obsolete WP3 incoming links.
- Description lengths: search 327, project 333, setup 360 characters; each below
  1,024 and matching its folder name. Initial source-ready mains had 88, 90 and
  89 lines respectively; the focused corrections below add explicit instructions.
- `git diff --check`: exit 0.
- No runtime/helper/schema/version edits. No old forwarding directories.

These are source checks, not actor grades. Existing global contracts still expect
the old five-role catalog and must be revised by WP3. Candidate execution and
independent review must pass before dependent package work proceeds.

## Retained initial execution findings and corrections

The first candidate initialization opened/closed its operation but recorded only
the log in the ledger: the scaffold helper does not auto-record its writes.
Initialization now explicitly compares pre/post files, records every new root and
template file through `op-ledger.mjs add`, and inspects the full ledger before
close even without Git. The initial execution remains evidence of that gap.

The first validation-only and cold-simple actors did not explicitly read vault
instructions; a built-in AGENTS plugin listing does not prove those contents were
injected. Setup and simple search now require opening the actual applicable vault
`AGENTS.md` before the first helper (if present). This adds no setup/operations
preamble to simple search. Fresh focused reruns, not an inferred pass, must verify
these corrections; independent review owns their grades.

Source review also corrected unscoped backlog generator examples to explicit
project scope and clarified that a missing-only initialization fallback replaces,
rather than precedes, running `init.mjs` over customized template collisions.
