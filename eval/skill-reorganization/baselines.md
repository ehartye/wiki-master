# Reorganization execution baselines

These five fresh Claude Code 2.1.316 actors ran at the unchanged 0.88.0 source
baseline, before candidate skill authoring. `baseline-run.json` links both batch
receipts; each case has its exact request, actual complete tool transcript,
execution result, activation observations, and before/after file hashes and text.
The disposable Git fixtures use local bare origins. No production vault is used.

`harness.mjs` adapts the existing consolidation execution runner. Re-run with a
candidate plugin path and condition `candidate` to construct equivalent cases.
The project/setup/init/recovery baselines disable skills and prohibit reading
skill files; the search baseline loads the current five-role plugin. Host
activation inventory is retained separately from actual tool execution. Public
artifacts redact account names, host paths and environment PATH; private original
streams remain outside this repository. This runner does not grade its actors.

## Observed outcomes, pending independent grades

| Case | Actual outcome | Important limits |
|---|---|---|
| project | Architecture, backlog, catalogs and log changed; operation commit reached bare origin; clean worktree. | Final prose incorrectly says roadmap/MOC were skipped by validation. Inspect actual validator output: authored pages, including generated authored catalogs, were checked; non-authored index/log were skipped. No-skill actor substantially completed the task. |
| setup | Scoped validation found the deliberately invalid `backlog-status: open`; health, stale, lint and search diagnostics ran; full vault snapshots are unchanged. | No repair was attempted. Reporting accuracy must be graded from helper output, not accepted from the actor's summary. |
| search | Exact phrase, alias, both Harbor pages, explicit raw retrieval, provenance and project-scoped planned-versus-shipped answer executed; full vault snapshots are unchanged. | Actor additionally ran a broad recursive filename listing. It did not read/cite recycle evidence. The raw source does not support the copper-heron wording, and the actor reported that distinction. Failed raw coverage is a later mandatory scenario, not demonstrated here. |
| init | Standard files appeared; existing index bytes stayed identical; no Git repository/remote was created. | Actor did not open/log/close an initialization operation. Its claim that init only creates missing files is too broad: the helper copies template files. This fixture has no pre-existing template. |
| recovery | Only the explicitly owned abandoned operation token was removed; content/Git/remote snapshots are unchanged. | This exercises owned-token abort, not conflicting sync or uncertain native mutations. |

Baseline successes are retained. They cannot support a claim that skills always
improve results. Candidate comparisons must inspect actual commands, citations,
artifacts and operation state; no startup-efficiency claim is made here.

The fixture's invalid backlog state is intentional and shared by baseline and
candidate. Its repair belongs to the authorized project task, while diagnostic
and search tasks must preserve it. Optional converter/authenticated integrations
are not executed by these five cases. Further mandatory research, maintenance,
purge, failed-raw and routing scenarios remain for integration verification.
