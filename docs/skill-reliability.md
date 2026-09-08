# Skill reliability

Version 0.36.0 makes wiki-master workflows resilient when the Obsidian CLI is unavailable, reduces the always-loaded instructions, and adds behavioral checks. Update installed plugin copies to activate the revised skills. Existing vaults need no content migration; factual-review gaps still require checking claims against evidence.

## Runtime and completion

The shared Obsidian wrapper defaults to a 10-second timeout. Callers can choose a finite bound for known longer commands. It never automatically retries: a timed-out write may already have happened. Inspect the exact target before continuing.

Freshness prefers valid Obsidian Bases results. If unavailable, invalid or empty, it checks Markdown metadata under the known vault's `wiki/` directory and discloses the filesystem backend and reason. It excludes raw evidence, maps, logs, hidden directories, templates and symlinks. A missing vault is an error, not an empty successful report. `reviewed` remains factual verification; `updated` remains editing.

The skills' shared access policy permits ordinary Markdown reads and scoped edits at known paths with normal filesystem tools when the CLI fails. Live workspace/graph UI, Obsidian plugins and other app-only state still require an available app interface. Authoring and ingestion preserve the operation lifecycle and raw evidence contract in either mode.

Writing workflows share scope/authorization, operation-open, edit, validation, affected catalog refresh, log, operation-commit and authorized sync. Existing session instructions and the vault's own sync rules count as authorization. Read-only requests never open write operations. The operation helpers still do not push automatically.

The maintainer core is 76 lines, down from 444. Detailed access, operations, evidence, authoring, maintenance and workflow policies live in focused references linked directly from applicable entry points. All 19 descriptions now name natural user triggers and adjacent workflow boundaries. Existing provenance and purge safeguards remain in force.

## Behavioral suite

```sh
npm run test:skills
node scripts/evaluate-skill-behavior.mjs --scenarios eval/skill-behavior/scenarios.json --with with.json --without without.json --output comparison.json
```

The frozen eight scenarios cover offline authored publishing, pure retrieval, incomplete freshness, an application-naming near miss, explicitly authorized discovery/ingest, discovery awaiting review, uncertain writes and app-only actions.

Launch the with-skill and without-skill runs together with identical scenario facts and tool access. For the former, supply the actual skill bodies and directly relevant references; for the latter, do not supply those bodies. Record the host/model, loaded files, duration/context measurements if available, exact outputs and tool/artifact evidence. An independent observer then labels action evidence using exact transcript spans. The actor must not grade itself. Preserve all failures and near misses, not only the examples that improve.

Trace contract: version1, condition `with` or `without`, mode `simulation` or `execution`, `scenarioHash` from `scenarioHash(dataset)`, independent observer identity, and one complete run per scenario. Each run carries its original transcript and actions `{name,evidence}`; execution runs also require tool-output/file-diff/git-state artifact references. Optional nonnegative `contextCharacters` and `durationMs` must be measured, not guessed. Do not mark a truncated run complete.

The grader measures required action coverage and forbidden actions, reports missing scenarios as incomplete (exit2), and fails a with-skill regression (exit1). It checks that labels quote the supplied transcript; it cannot authenticate an observer or infer all unlabeled actions. Artifact references need independent inspection. Simulations measure proposed behavior, never successful execution. Reports cannot substitute for fresh runs after material skill changes.

`test/skill-workflow.test.mjs` separately executes the documented lifecycle against temporary local Git repositories from an unrelated working directory. It verifies that the authored edit preserves the factual review date, the log and edit are committed, a pre-existing user draft and raw source remain untouched, a local remote receives the commit, and filesystem freshness makes no content changes. This tests executable commands and resulting artifacts; it does not claim an LLM independently chose them.

`test/skill-contracts.test.mjs` checks metadata, direct reference integrity, access/completion routing and portable examples. The code suite validates timeout and fallback failures. These deterministic checks run in normal CI; paid/model behavior probes remain explicit, reproducible evaluation runs rather than an implied unattended service.

The original Yoda audit responses are preserved in `eval/skill-behavior/baseline/`. They used four earlier prompts, so they are qualitative provenance and are not numerically compared with the new eight-scenario suite.

## Verification on 2026-09-08

The focused suite passes all 31 tests. The complete Windows run reports 1,025 passed, two failed and one skipped. Both failures are the previously reproduced triage-auth server startup problem (`server never wrote server-info`); they are outside this change. This is not a claim that the full suite is green.

A live read-only freshness call used the filesystem backend when the Obsidian CLI reported the app unavailable. It completed in 273 ms and reported 1,922 fresh, 1,786 aging, zero stale and 66 rotten pages, with 66 missing factual review dates. Missing review remains visible instead of being inferred from recent edits.

The [fresh full-pair grading](../eval/skill-behavior/current/grading.md) records 7/8 scenarios with skill bodies and 5/8 without them. The skilled run omitted claim/evidence inspection for a currentness question. The evaluator correctly exits 1 despite the positive score difference. The freshness skill was subsequently corrected to distinguish a metadata review queue from an evidence-based assessment; the original failure remains in the report.

The [earlier exposed pair](../eval/skill-behavior/rubric-exposed/grading.md) scored 8/8 in both conditions, but both actors briefly saw the rubric. It is preserved as disclosed evidence and is not pooled with the fresh pair. Both conditions in every pair inherited skill names/descriptions and general host instructions; “without” means without skill bodies. These simulations do not establish activation reliability, production success rates or a measured total-context saving.

The [targeted freshness retest](../eval/skill-behavior/freshness-recheck/grading.md) passes 1/1 in each condition after the correction, with all three required actions observed. It uses the unchanged freshness scenario and separate reports; it is not a new eight-scenario pass. The with actor saw all scenario prompts while the without actor saw only freshness, so this retest is not a strict matched-context comparison. Neither saw the rubric. Run it with `--scenarios eval/skill-behavior/freshness-recheck/scenarios.json` and the paired trace files in that directory. All 31 focused tests also pass after the correction.
