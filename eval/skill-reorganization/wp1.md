# WP1 — Baselines and migration inventory

Baseline: `8720f90bee85631b454c88eb4078a8e753b440b8` (0.88.0), 2026-11-02. Candidate skill files have not been authored during this package.

## Artifacts and scope

- [Section migration inventory](migration-inventory.md): every heading outside fences in all 28 baseline references, plus 43 embedded procedure splits and maintained specialist documentation dispositions. Destination labels are proposed functional homes; WP2/WP3 must reconcile final reference paths without changing the ownership contract.
- [Companion inventory before](caller-inventory-before.json): previous sixteen first-party companion identities; current revisions and dirty state for fifteen available sources, latest installed Markdown copies, unavailable agent-draw source explicitly recorded. Source scan covers all Git-tracked text, broader than the preceding Markdown-only scan.
- [Baseline run manifest](baseline-run.json): baseline actor batches for project, setup, search, initialization and recovery. Individual request, execution, observations and snapshots are authoritative. Baseline actor author and independent reviewer own their execution and grading; this inventory author does not self-grade them.

The product checkout is isolated in the sibling `wiki-master-worktrees/separate-skills` on `feat/separate-search-project-setup`. Companion worktrees are `hartye-skills-worktrees/wiki-role-split` (base `89d272d`), `agent-game-studio-worktrees/wiki-role-split` (base `12fcd55`), and `agent-unreal-worktrees/wiki-role-split` (base `ebf5bcc`), each on `feat/wiki-role-split`. Existing source dirt and installed caches remain untouched.

## Findings carried into implementation

Search/query currently mix retrieval, diagnostics, original authoring and synthesis filing. Split by authorization and content provenance: search stays read-only, project owns original documentation, maintainer owns explicitly authorized derived synthesis filing with `query` operation semantics. Setup owns diagnostic recipes while task obligations remain direct and visible.

Do not move normative hash-join identity out of maintainer merely because health reports it. Content repair helpers also remain maintainer actions. Extract reports, checks, prerequisite probes and recovery recipes, including the easily missed material embedded in clipper, app, operation and purge references. Full project procedure belongs in project even when other workflows update an authored page.

The broader caller scan found a fourth maintained file beyond the three known caller files: `agent-unreal/scripts/sibling-skills.json`. Its wiki-master snapshot predates 0.88.0 and contains twenty-one roles; WP3 must replace that entire plugin block with the candidate six-role catalog, preserve other plugin blocks, inspect its documented generator and run `node --test scripts/release-consistency.test.mjs`. The known callers are `hartye-skills/skills/spec-plan/SKILL.md`, `hartye-skills/skills/q-master/SKILL.md` and `agent-game-studio/references/plugin-map.md`.

Historical evidence is not mechanically rewritten. Installed copies require later coordinated delivery. The prior temporary agent-draw source clone was not found in the bounded repository set, so source compatibility there remains unverified; its installed copy was inspected. Unknown third-party callers are outside the claim.

## Structural baseline

The orchestrator independently ran:

```text
node --test test/skill-contracts.test.mjs test/drift-guard.test.mjs test/triage-skill-table.test.mjs
```

Result: exit 0; 24/24 passed; no skips. This is a baseline structural receipt reported by the orchestrator, not behavioral efficacy evidence and not a claim that the six-role acceptance contracts already pass. Existing five-role contracts intentionally precede their WP3 update.

Inventory author ran `git diff --check`: exit 0. An independent reviewer must assess this package and the actual actor outcomes before WP2 begins. No reduced-startup, behavioral-improvement or final-completion claim is made by the inventory alone.
