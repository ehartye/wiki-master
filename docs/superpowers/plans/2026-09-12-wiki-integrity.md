# Wiki integrity and repair implementation plan

**Goal:** Give agents an uncapped count of verifiable integrity defects and a reusable repair workflow that preserves intentional forward links.

**Architecture:** A read-only integrity scanner supplies versioned JSON with stable issue IDs, locations, evidence and verification conditions. Health defaults to this report; the historical score remains available with `--legacy` and ingest reporting retains `--backlog`. A portable `wiki-repair` skill owns evidence-based repair and operation completion. No custom agent or automated vault repair is introduced.

**Execution:** Inline implementation under test-driven development; independent skill simulation and code review. Worktree `feat/wiki-integrity`, baseline `394dea7`; focused baseline: 63 tests passed.

- [x] Add regression tests for intentional forward links independent of age/similarity, citation failures, malformed links, ambiguity, stub exemptions, code examples, stable IDs and count reduction after actual repairs.
- [x] Implement the bounded scanner and integrity rules, reusing existing note parsing and evidence contracts. Distinguish unresolved navigation from required citations; exclude ambiguous edges from evidence routes. Report coverage and unsupported checks honestly. No Git-history inference in this version.
- [x] Add health JSON/default output and preserve explicit legacy/backlog modes. Test CLI behavior and read-only operation.
- [x] Add `wiki-repair`; route health and repair requests distinctly from relationship curation and factual lint. Record baseline and with-skill behavioral evidence.
- [x] Run focused and full tests, inspect the live vault read-only, and obtain independent review. Resolve findings within scope.
- [x] Document the implemented contract and release state in the canonical wiki; validate, commit and sync that documentation on vault main. Retain code changes on the feature worktree for review. Vault commit `d84b3754` is synced; semantic refresh completed. Captured and ingested official link/skill documentation; verified new pages have no integrity issues.

## Acceptance contract

`defectCount === issues.length`; one issue per rule/source/target, deduplicated across occurrences. IDs survive line shifts and repeated runs. Forward links, fuzzy guesses, age, orphan/dead-end status and intentional stubs never increase the count. Explicit broken citations remain defects even on stubs. A missing evidence trail applies only to substantive derived pages; original authored pages declaring `sources: []` are exempt. A link defect and its same-page missing trail are not double-counted. Zero inspected pages cannot claim healthy knowledge. The report establishes structural integrity only, with heading validation, historical rename detection, external URL checks and factual truth outside its coverage.
