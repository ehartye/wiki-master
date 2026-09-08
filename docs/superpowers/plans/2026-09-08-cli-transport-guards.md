# CLI transport safeguards implementation plan

**Goal:** Reject unsafe requests, serialize cooperating agent sessions, and route Markdown writing through the filesystem.

**Architecture:** A dependency-free asynchronous transport owns an OS socket reservation and a bounded CLI child. The existing sync wrapper calls a short-lived worker; async search uses the same transport. A small CLI proxy and directly linked skill guidance give agents one supported path.

**Tech stack:** Node.js built-ins, Markdown, node:test. Execute inline using the existing authorized scope; use independent review and paired Yoda probes for validation.

- [x] Create `test/cli-transport.test.mjs` and fake-process fixtures. Observe rejection, serialization, timeout and cleanup failures before implementing `scripts/lib/cli-transport.mjs`.
- [x] Extend `test/vault.test.mjs` and search tests for preflight/guard routing. Implement sync adapter, async transport wiring in `scripts/search.mjs`, and `scripts/obsidian.mjs`. Preserve old contracts and avoid raw command bypasses.
- [x] Update access, authoring and CLI skill instructions/examples. Add frozen focused scenarios with prompt-only actor input; run with/without agents concurrently and grade independently.
- [x] Run focused tests and full suite; inspect all failures. Obtain independent review of process locking, limits, failure propagation and skill routing; fix substantive findings. Document actual evidence and limitations.
- [x] Record implemented/unreleased design and roadmap in the wiki through operation helpers; validate, commit and sync scoped changes. Commit feature branch and retain worktree for handoff.

Baseline: `node --test test/vault.test.mjs test/stale.test.mjs test/drift-guard.test.mjs` passes 29 tests on `efa5ea6`. Full Windows triage-auth startup failures are an existing, separately reproduced issue.

## Verification record

- Red checks: transport import failed before implementation; wrapper and search rejection checks each demonstrated that the old path invoked its fake executor with an oversized request. One initial timeout test assumed the fake script would start within 100 ms; Windows process startup can exceed that. The corrected test counts one actual launch attempt and permits termination before the script's first instruction.
- Focused runtime, search, freshness, skill contracts, drift guard and init: 68 passed, zero failed. `npm run test:skills` after adding transport coverage: 42 passed, zero failed.
- `npm test`: 1,039 tests, 1,038 passed, zero failed, one skipped, exit 0 on Windows Node 24.18.0. The previously observed triage startup failures did not occur in this run; this change does not claim to fix them. No large or parallel live Obsidian requests were used.
- Independent transport review found no blocker and independently passed 62 tests. Its raw init-command finding was corrected, along with the README and wiki-init instructions. See `eval/cli-safeguards/current/grading.md` for review scope and limits.
- Paired simulations used frozen prompt-only inputs and independently labeled exact spans: with skills 3/3, without bodies 1/3. Neither proposed forbidden behavior. The baseline omitted explicit operation bookkeeping and filesystem write selection. This is a small simulation of intentions, not production execution or causal proof.
- Wiki capture `795c524a`, ingest `93a71351`, authored design/roadmap `adb6a06a` were committed through scoped operations and pushed. Source hash, metadata, exact links, affected catalog and project MOC were validated; semantic refresh completed. Vault upstream comparison was `0 0` and worktree clean.
- Code remains on `fix/cli-transport-guards`; main and installed 0.36.0 are unchanged. No version bump, release or merge is part of this implementation handoff.
