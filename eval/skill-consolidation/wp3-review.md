# WP3 independent review

Reviewer: fresh `wp3_review` actor, distinct from the package authors and orchestrator. Date: 2026-11-02. Reviewed the actual working-tree changes against baseline `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca`; role implementation is committed at `8a899af34c1eef7e367400d3a30b3d39fe8d45b1`, with WP3 changes still uncommitted at review.

**Result: PASS for WP3 progression.** No unresolved blocking findings. This review covers AC1–4 and source compatibility; it does not establish the candidate-loaded behavioral gates required by WP4.

## Independent observations

- Exactly five entry points and no retired forwarding folders are enforced. Tests replace the old per-operation folder assumption with a capability-to-procedure/helper map covering all former workflows, all six capture formats/services and the shared Obsidian route. Descriptions retain the 1,024-character limit and portable metadata.
- The catalog is compared for exact equality with current entry-point names and descriptions. The recursive link guard follows nested references and specialist documents, checks Markdown heading anchors, and verifies all skill reference files are reachable. A deliberately broken second-hop/heading fixture proves the guard fails on those defects while excluding code examples.
- Triage enum/table parity assertions remain unchanged apart from the reference location. Authoring vocabulary, placement and provenance-related checks likewise retain their assertions at the moved user reference. The old command-directory prohibition remains; capability coverage has one owner in the skill contract suite.
- Current README, Codex guidance, schema and integrity documentation use the new routes. The migration table contains all 21 former entry points and distinguishes modes, capture-only authorization, no-op backlog behavior, shared policy ownership and purge approvals. Historical measurements are labeled historical; dated plans, frozen evaluations and release history were not rewritten.
- Inspected every script diff: changes are comments, usage/help wording, the initialization notice and one triage UI message. Helper names, flags, algorithms, converters and authorization code are unchanged. Version and plugin manifests are unchanged.
- Companion diffs are limited to hartye-skills `spec-plan`/`q-master` and agent-game-studio's plugin map. Search/authoring route to the user role; research names topic discovery and ingestion of the resulting named clippings. Studio distinguishes validation of changed pages from requested whole-vault health. Existing configuration approval and wiki authorization boundaries remain.
- The companion inventory covers 16 installed companions plus 16 corresponding source repositories, with revisions and explicit exclusions. Its 42 original matches have dispositions: nine maintained source references migrated, historical references retained and installed copies left unchanged. The final 33 remaining matches are historical or installed-cache occurrences. The main-source inventory supplies 156 baseline occurrences with path, old reference, replacement and disposition. An independent current-source scan found no retired qualified names or direct skill paths outside the deliberately historical/migration documents.
- Compared the final companion files' SHA-256 values with `caller-checks.json`; all three match. Inspected the actual baseline/candidate Skill calls: the baseline callers receive four unknown-skill errors, while the migrated callers load both new dependencies. These are dependency-resolution observations only, not complete companion workflow execution.

## Checked execution evidence

| Check | Result |
|---|---|
| Independent `node --test test/skill-contracts.test.mjs test/drift-guard.test.mjs test/triage-skill-table.test.mjs test/validate-authored.test.mjs` | Exit 0, 71 passed, 0 failed/skipped; `wp3-independent-contracts.tap` |
| Required `npm run test:skills` | Exit 0, 45 passed, 0 failed/skipped; `wp3-skills.log` |
| Required drift/triage/authoring command | Exit 0, 64 passed, 0 failed/skipped; `wp3-contracts.log` |
| Required focused search/capture/provenance command | Exit 0, 179 passed, 0 failed/skipped; `wp3-search-capture-provenance.log` |
| Required six format/service suites | Exit 0, 106 passed, 0 failed/skipped; `wp3-formats.log` |
| Studio required `node scripts/check.mjs` | Recorded exit 0, 123 passed, 0 failed/skipped; `caller-studio-check.tap` inspected |
| Companion dependency sessions | Raw calls inspected: baseline unavailable old names; candidate successful new-role loads; host exits 0 |

The first npm attempt failed before any tests because the child PowerShell host selected a blocked `npm.ps1`. It remains recorded as a host preflight failure; the same `npm run test:skills` command passed through `cmd.exe` and normal `npm.cmd` resolution without changing execution policy. The public failure log's concrete install path was sanitized during review and rechecked. This was an execution-host correction, not a test or product fix.

The deterministic format suites exercise parsing, conversion-result handling and prerequisite/failure contracts. Their passing results do not claim live converter execution or authenticated Confluence capture. No behavioral, live discovery, ingestion, remote publication, merge, release or installed-plugin success is inferred here. WP4 remains mandatory.
