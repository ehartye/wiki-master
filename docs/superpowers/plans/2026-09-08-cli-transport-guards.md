# CLI transport safeguards implementation plan

**Goal:** Reject unsafe requests, serialize cooperating agent sessions, and route Markdown writing through the filesystem.

**Architecture:** A dependency-free asynchronous transport owns an OS socket reservation and a bounded CLI child. The existing sync wrapper calls a short-lived worker; async search uses the same transport. A small CLI proxy and directly linked skill guidance give agents one supported path.

**Tech stack:** Node.js built-ins, Markdown, node:test. Execute inline using the existing authorized scope; use independent review and paired Yoda probes for validation.

- [ ] Create `test/cli-transport.test.mjs` and fake-process fixtures. Observe rejection, serialization, timeout and cleanup failures before implementing `scripts/lib/cli-transport.mjs`.
- [ ] Extend `test/vault.test.mjs` and search tests for preflight/guard routing. Implement sync adapter, async transport wiring in `scripts/search.mjs`, and `scripts/obsidian.mjs`. Preserve old contracts and avoid raw command bypasses.
- [ ] Update access, authoring and CLI skill instructions/examples. Add frozen focused scenarios with prompt-only actor input; run with/without agents concurrently and grade independently.
- [ ] Run focused tests and full suite; inspect all failures. Obtain independent review of process locking, limits, failure propagation and skill routing; fix substantive findings. Document actual evidence and limitations.
- [ ] Record implemented/unreleased design and roadmap in the wiki through operation helpers; validate, commit and sync scoped changes. Commit feature branch and retain worktree for handoff.

Baseline: `node --test test/vault.test.mjs test/stale.test.mjs test/drift-guard.test.mjs` passes 29 tests on `efa5ea6`. Full Windows triage-auth startup failures are an existing, separately reproduced issue.
