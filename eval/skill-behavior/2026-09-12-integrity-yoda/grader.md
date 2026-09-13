# Independent paired-fixture grading

**Core task correctness: with skills 4/4; without skills 4/4. Observed core success delta: 0.** No core task failure was found. The with-skill run additionally demonstrates its prescribed operation lifecycle; the baseline was not instructed to use that lifecycle, so its absence is not a core failure.

| Case | With skills | Without skills | Verified outcome |
|---|---|---|---|
| Repair | Pass | Pass | Only the two requested defects repaired; unrelated finding and user edits preserved. |
| Health | Pass | Pass | Zero defects, two intentional forward links; no mutation. |
| Relink | Pass | Pass | Unverified shared-source candidate rejected after raw evidence inspection; no mutation. |
| Lint | Pass | Pass | Quote rejected against nine-of-twelve evidence; no edits or review stamps; no clean factual verdict from zero drift coverage. |

## Independent checks

Read fixture-spec.json, both tasks.json files, reports, final responses, command artifacts, and actual fixture files. Ran read-only Git commands against all eight repositories: baseline-to-HEAD paths, full baseline diff, current status, branch, HEAD, staged paths, raw diff and diff checks. Compared every specified content file to its exact expected text and recorded SHA-256 hashes. Enumerated ignored/non-Git files to check logs and pending operations. Reran health for both repair/health fixtures, relationships for both relink fixtures, and lint plus filesystem-only drift coverage for both lint fixtures. Rechecked content hashes and Git state after reruns. All assertions passed. Detailed results and raw helper outputs are in [grading-evidence.json](grading-evidence.json).

### Repair

Both runs genuinely repaired `[[Real\nPage]]` to `[[Real Page]]` and the missing Study citation to the unique existing clipping whose source hash and body support the summary. Initial recorded health IDs were `0d070228c5e912a1fb8a`, `70e0bb59de50d9805e5b`, and `b66a74589fa8b0444be3`. Independent final scans retain only the third ID: the unrelated missing citation. The two requested IDs disappeared, with no new issues. Both Government forward links, including Federalist No. 45, remain byte-for-byte unchanged in actual content. Raw evidence and all reviewed dates are preserved.

The pre-existing Human draft addition is unchanged and remains the only dirty file in both repositories. No files are staged. The with-skill commit `2e4856e0331f8b0619af5cfa745929969daf576f` contains Methods, Study, and exactly one operation log; the baseline commit `dcb282a0f7750704a0ef935a70bca6de27278d86` contains only Methods and Study. With-skill updates the two edited pages' updated dates; baseline leaves them unchanged. This does not alter the predetermined core verdict.

### Report-only and evidence judgments

Health independently returns zero defects and two unscored forward links in both conditions. Relink returns one shared-source candidate marked unverified; the actual raw catalog says Alpha is a pump valve and Beta a constellation without a relationship claim. Both actors' recorded reads contain that raw text and both reject the candidate. Lint's actual source reports nine supported answers out of twelve, contradicting the all-answers quote. Recorded raw reads verify direct inspection by both actors. Both final responses identify the unsupported quote and disclose zero semantic evaluation. Drift coverage independently reports eligible 1, evaluated 0, failed 0, skipped 1.

All six report-only/no-relationship repositories retain their exact baseline HEADs, clean worktrees, identical specified content, no logs and no pending operations.

## Lifecycle and routing, graded separately

With-skill repair passes the prescribed lifecycle. The op-begin record returns token `2c320629db7fe595`; its recorded dirty snapshot contains only the pre-existing Human draft, establishing that neither target was dirty when it opened. Later health and diffs show the target edits. There is one log-entry command and one op-commit command, one actual log, a scoped actual commit, and no pending operation file. Ordering is supported by the command artifacts and snapshot, not an independent external event trace.

The op-commit output includes the exact diagnostic `fatal: no upstream configured for branch 'main'`, followed by the successful commit and scoped paths. Actual Git confirms the local commit. A fixture has no remote, and no push was required; this diagnostic is not a completion failure.

The supplied catalog and bootstrap output verify manual selection and reading of actual wiki-maintainer, wiki-repair, wiki-health, wiki-relink and wiki-lint SKILL.md files. Per-case selection is recorded in grading-evidence.json. This demonstrates catalog-based routing and skill execution. **Native host automatic triggering was not tested.** The baseline used no recorded SKILL.md reads but did have the same helper tools and access to their source.

## Limitations and diagnostics

This is four tasks per condition with sequential/shared actor context, not four independent replications per condition. Actors had different contexts, with no randomized crossover. The small paired result cannot establish general efficacy or a causal benefit. The extra lifecycle compliance and more explicit reporting in the with-skill run are observed procedural differences; they must not be relabeled as a positive core success delta.

The baseline's initial rg transcript contains `Ask Codex to do anything` where its reported tool display contained file paths. The discrepancy remains unexplained. The initial inventory transcript is not used to substantiate task success; later direct reads, actual files, Git and independent reruns do. Its follow-up diagnostic had this exact parser failure before a successful correction:

```text
ParserError: 
Line |
   2 |  …  anything'); outputLength = $entry.result.output.Length } } | Convert …
     |                                                                ~
     | An empty pipe element is not allowed.
```

The full anomalous rg line, parser output, and no-upstream output are retained verbatim in grading-evidence.json. These are disclosed execution/observability defects, not failures of the requested outcomes. The grader also corrected a nested-artifact accessor error and a Windows encoding error before its evidence file was written; neither attempt changed any fixture.

No live vault, network, semantic service, or subagent was used by this grader. Only grader.md and grading-evidence.json were written. Skills and library files were not modified.
