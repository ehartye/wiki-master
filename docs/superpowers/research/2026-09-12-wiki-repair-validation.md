# Wiki repair validation

## Behavioral probe

Two independent fresh agents received the same bounded fixture and request to
resolve wiki health findings. One ran without the new skill before it was written;
the other read the new skill after implementation. Both were simulations with no
live writes. The with-skill agent additionally received a read-only near-miss prompt;
that near-miss is not a paired comparison. No statistical benefit or executed agent
reliability is claimed from this small probe.

Fixture: legacy report suggests Federalist No. 45 → No. 10 despite different subject
matter; Study has a missing citation but a unique matching source hash identifies a
supporting clipping; Methods has a newline-split link to an existing page; Future
Topic is an intentional forward link; Lone Topic is a substantive sourced orphan.

Both agents proposed the two justified edits and rejected the harmful fuzzy rename.
The baseline grouped three different kinds of unresolved work together. Verbatim
baseline final paragraph:

> The final report would state: **Two findings repaired and verified; three remain—Federalist No. 45 needs correct evidence or a destination, Future Topic remains deferred, and Lone Topic still needs a justified inbound connection.** This is a simulation; no files were changed.

The with-skill run explicitly distinguished defect obligations, navigation and
unavailable verification results. Verbatim excerpts:

> The legacy report’s three defect entries are not a verified current defect count.

> **Verification:** Current counts, issue IDs, checker results, commit, and sync status are unavailable in this simulation. None can be claimed as completed.

> For **“Only show wiki health; do not edit,”** I would use wiki-health and report findings and coverage read-only. I would make no edits, open no operation, write no log, commit nothing, and refresh no indexes.

This supports the reporting boundary on this fixture. The baseline already made
sound repair choices; the skill is not credited with inventing that capability.
Actual repair execution remains governed by deterministic fixture tests and the
existing operation lifecycle tests, not these simulated intentions.

## Code verification

Seventeen new integrity tests exercise temporary filesystem vaults and the real
CLI. They cover forward-link invariance, citation obligations, evidence routes,
ambiguity, code/comments, stable IDs, deduplication, real repair count reduction,
coverage, CLI modes and preservation of read-only files.

Independent code review found four issues: YAML-comment citations, body links
borrowing raw evidence through basename collisions, code-example parsing and
unordered locations. Each was reproduced in a failing regression before correction.
Re-review verified the fixes and Related-section navigation semantics; 71 integrity,
graph and note tests passed with no remaining findings in that bounded review.

Focused health/graph/integrity/skill contracts: 80 passed. Final full suite:
1,056 passed, zero failed, one skipped (1,057 tests). An earlier full run had one
triage server startup timeout. The same `server never wrote server-info` failure
also reproduced on unchanged main in a different triage test; it is intermittent
and remains outside this change. The final passing run followed actual scanner
fixes, not repeated retries to obtain a green result.
