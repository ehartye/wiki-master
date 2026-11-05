# Skill reliability

The source now exposes six roles with task-specific references. See the
[migration mapping](skill-migration.md) and [current catalog](../eval/skill-catalog.md).
Ordinary search executes from the search main file, plus applicable vault
instructions; advanced references load only when needed. Evidence and mutation policies load when needed.
All six capture routes remain researcher modes; ingestion and capture retain
separate authorization.

Reorganization evidence is retained under `eval/skill-reorganization/`; prior
consolidation evidence remains unchanged under `eval/skill-consolidation/`. Package
reviews and structural tests establish only their stated scope; candidate-loaded
behavior must be judged from its separate execution artifacts.

Earlier version-specific measurements below are historical evidence. They do not
describe the current skill count, entry-point names or reference-loading path.
Frozen transcripts under other `eval/` directories, `docs/superpowers/` plans and
specifications, and release history are retained unchanged.

## Runtime and completion

[Setup checks](../skills/wiki-setup/references/checks.md),
[app diagnosis](../skills/wiki-setup/references/app-access.md) and
[recovery](../skills/wiki-setup/references/operation-recovery.md)
own the agent procedures. The contracts and historical measurements below
remain reference material.


The shared Obsidian wrapper defaults to a 10-second timeout. Callers can choose a finite bound for known longer commands. It never automatically retries: a timed-out write may already have happened. Inspect the exact target before continuing.

Freshness prefers valid Obsidian Bases results. If unavailable, invalid or empty, it checks Markdown metadata under the known vault's `wiki/` directory and discloses the filesystem backend and reason. It excludes raw evidence, maps, logs, hidden directories, templates and symlinks. A missing vault is an error, not an empty successful report. `reviewed` remains factual verification; `updated` remains editing.

The skills' shared access policy permits ordinary Markdown reads and scoped edits at known paths with normal filesystem tools when the CLI fails. Live workspace/graph UI, Obsidian plugins and other app-only state still require an available app interface. Authoring and ingestion keep the completion and raw evidence contracts in either mode, and finishing an authoring task needs the running app and Ollama.

Writing workflows share one [completion contract](../skills/wiki-maintainer/references/operations.md): scope and authorization, edit, validation, one log entry and `refresh-index.mjs`, once per task. Obsidian Git handles all git operations. Nothing isolates two writers on the same file, so agents keep their edits to what their task needs. Read-only requests write nothing.

Historically, version 0.36.0 reduced the maintainer core from 444 to 76 lines and
gave the then-19 descriptions natural triggers. The 0.88.0 five-role layout replaced
that universal core with shared policy references and a maintenance router;
the current six-role source preserves that shared-policy ownership.
Existing provenance and purge safeguards remain in force.

## Behavioral suite

```sh
npm run test:skills
node scripts/evaluate-skill-behavior.mjs --scenarios eval/skill-behavior/scenarios.json --with with.json --without without.json --output comparison.json
```

The frozen eight scenarios cover offline authoring, pure retrieval, incomplete freshness, an application-naming near miss, explicitly authorized discovery/ingest, discovery awaiting review, uncertain writes and app-only actions.

Launch the with-skill and without-skill runs together with identical scenario facts and tool access. For the former, supply the actual skill bodies and directly relevant references; for the latter, do not supply those bodies. Record the host/model, loaded files, duration/context measurements if available, exact outputs and tool/artifact evidence. An independent observer then labels action evidence using exact transcript spans. The actor must not grade itself. Preserve all failures and near misses, not only the examples that improve.

Trace contract: version1, condition `with` or `without`, mode `simulation` or `execution`, `scenarioHash` from `scenarioHash(dataset)`, independent observer identity, and one complete run per scenario. Each run carries its original transcript and actions `{name,evidence}`; execution runs also require tool-output/file-diff/git-state artifact references. Optional nonnegative `contextCharacters` and `durationMs` must be measured, not guessed. Do not mark a truncated run complete.

The grader measures required action coverage and forbidden actions, reports missing scenarios as incomplete (exit2), and fails a with-skill regression (exit1). It checks that labels quote the supplied transcript; it cannot authenticate an observer or infer all unlabeled actions. Artifact references need independent inspection. Simulations measure proposed behavior, never successful execution. Reports cannot substitute for fresh runs after material skill changes.

`test/skill-workflow.test.mjs` separately executes the documented workflow against a temporary local Git repository from an unrelated working directory: write, validate, log once and refresh, with the refresh's app and embedder stubbed. It verifies that the authored edit preserves the factual review date, one log entry is written, the catalog and search index update, a pre-existing user draft and raw source remain untouched, the repository's history and index do not change, and filesystem freshness makes no content changes. This tests executable commands and resulting artifacts; it does not claim an LLM independently chose them.

`test/skill-contracts.test.mjs` checks metadata, direct reference integrity, access/completion routing and portable examples. The code suite validates timeout and fallback failures. These deterministic checks run in normal CI; paid/model behavior probes remain explicit, reproducible evaluation runs rather than an implied unattended service.

The original Yoda audit responses are preserved in `eval/skill-behavior/baseline/`. They used four earlier prompts, so they are qualitative provenance and are not numerically compared with the new eight-scenario suite.

## Historical skill audit on 2026-09-11

A structural audit of the library plus three independently graded paired runs. Inspection
results: all skill `name` fields match their directories, every description is far under
the 1,536-character listing cap, references are exactly one level deep with no broken
links, every referenced helper resolves, no `$N`/`$ARGUMENTS` placeholder sits inside a
fenced code block, and no invisible Unicode codepoints were found. Reading a skill cannot
certify it is safe; provenance here is the repository's own history.

The [frozen-eight pair](../eval/skill-behavior/2026-09-11-pre/grading.md) records 8/8 with
skill bodies and 4/8 without, the first full eight-scenario run since the freshness
correction, which it shows holding. The [new five-scenario coverage
pair](../eval/skill-coverage/2026-09-11-pre/grading.md) covers the spreadsheet clip path,
purge, triage, query and relink — skills the frozen eight never exercised — and records 5/5
with bodies against 1/5 without, with three forbidden actions in the without arm: a
hand-written clipping, a binary stored into the vault, and direct file deletion in place of
a recoverable purge transaction.

That pair also recorded a coverage defect in the library itself. `scripts/clip-xlsx.mjs`
shipped, maintained and separately tested, with no `skills/clip-xlsx/`. Metadata is the only
tier loaded for every installed skill, so the clipper had no trigger and was reachable only
from inside `wiki-discover`, whose body names its script. The skill now exists, and a
contract test requires every document-format clipper to have one. The [targeted
recheck](../eval/skill-coverage/recheck-spreadsheet/grading.md) confirms the route is now
selected from metadata rather than deduced, with `wiki-discover` deliberately withheld.

Known limits of all three pairs: single samples in simulation mode, no executed vault, Git
or converter work, and **no measurement of activation**. Both conditions receive skill
bodies from the harness rather than a live loader choosing from a user's phrasing, so
nothing here establishes that a real request would load the right skill. Description
quality, trigger competition between skills, and the unconditional reference loading in each
spoke's preamble remain unmeasured by this method.

## Historical conditional reference loading on 2026-09-11

Twelve spoke skills opened by instructing an unconditional read of three to five shared
references, overriding the core's own rule to load only what the operation needs. Each of
those references now carries the condition under which it is read; `access.md` stays
unconditional because every skill touches the vault, and the seven skills whose references
all genuinely fire were left on the unconditional wording so the difference stays meaningful.

Cold-start instruction load on the common path, in words (skill body + core + references
actually read): `wiki-ingest` 5,445 to 3,573, `wiki-relink` 5,204 to 3,259, `wiki-query`
3,988 to 2,543, `wiki-lint` 5,151 to 3,946, each clipper down by 740, `wiki-search` 3,214 to
2,474. `wiki-stale` was deliberately left unchanged to protect the evidence-inspection
behavior corrected in 0.36.0.

The [post-change verification](../eval/skill-coverage/2026-09-11-post/grading.md) re-ran both
suites' with-condition and records 8/8 and 5/5 with zero forbidden actions — unchanged from
before the edit. Actors were given read access to every reference and told to follow the
preamble conditions honestly; across thirteen scenarios one conditional reference was read
because its condition fired, seven were skipped with the condition quoted, and none was read
speculatively. The without condition loads no skill bodies and is unaffected by this change
by construction, so it was not re-run.

Two limits worth carrying forward. Per-session savings are smaller than the per-invocation
figures suggest, because references accumulate across scenarios in one session exactly as the
core itself does. And `references/workflows.md` is reachable only from the core's routing
table under the trigger "when needed"; no spoke links it and it went unread across all
thirteen scenarios.

## Historical verification on 2026-09-08

The focused suite passes all 31 tests. The complete Windows run reports 1,025 passed, two failed and one skipped. Both failures are the previously reproduced triage-auth server startup problem (`server never wrote server-info`); they are outside this change. This is not a claim that the full suite is green.

A live read-only freshness call used the filesystem backend when the Obsidian CLI reported the app unavailable. It completed in 273 ms and reported 1,922 fresh, 1,786 aging, zero stale and 66 rotten pages, with 66 missing factual review dates. Missing review remains visible instead of being inferred from recent edits.

The [fresh full-pair grading](../eval/skill-behavior/current/grading.md) records 7/8 scenarios with skill bodies and 5/8 without them. The skilled run omitted claim/evidence inspection for a currentness question. The evaluator correctly exits 1 despite the positive score difference. The freshness skill was subsequently corrected to distinguish a metadata review queue from an evidence-based assessment; the original failure remains in the report.

The [earlier exposed pair](../eval/skill-behavior/rubric-exposed/grading.md) scored 8/8 in both conditions, but both actors briefly saw the rubric. It is preserved as disclosed evidence and is not pooled with the fresh pair. Both conditions in every pair inherited skill names/descriptions and general host instructions; “without” means without skill bodies. These simulations do not establish activation reliability, production success rates or a measured total-context saving.

The [targeted freshness retest](../eval/skill-behavior/freshness-recheck/grading.md) passes 1/1 in each condition after the correction, with all three required actions observed. It uses the unchanged freshness scenario and separate reports; it is not a new eight-scenario pass. The with actor saw all scenario prompts while the without actor saw only freshness, so this retest is not a strict matched-context comparison. Neither saw the rubric. Run it with `--scenarios eval/skill-behavior/freshness-recheck/scenarios.json` and the paired trace files in that directory. All 31 focused tests also pass after the correction.
