# Skill reliability

Approved scope: the user agreed to all five Yoda recommendations on 2026-09-08.

## Outcomes

1. Obsidian calls have bounded timeouts. A known vault root enables supported Markdown reads/writes and filesystem reports when the CLI fails. App-only actions stop with a specific reason; no blind retry after an uncertain mutation. Fallback preserves raw body integrity, exact paths, operation tracking and existing user changes.
2. Every mutating skill names one shared completion contract: resolve scope and authorization, open before writing, edit, validate, refresh affected catalogs, log, commit, sync when already authorized by user or vault instructions, verify. Read-only skills never open operations. Do not implement an automatic always-push policy or weaken purge safeguards.
3. wiki-maintainer becomes a short core (target <=150 lines). Existing domain rules and rationale move into focused direct references; no policy is silently lost. Each operation links directly to needed references. Path examples work from installed plugin locations on PowerShell/POSIX.
4. All nineteen descriptions express concrete user triggers and relevant boundaries. Short routine capabilities stay short. No speculative new skills.
5. A frozen behavior scenario suite covers authored editing/publishing with failed CLI, read-only retrieval, incomplete freshness, near-miss application naming, discovery authorization and cross-host command use. Paired probes run with and without skill bodies; evidence identifies simulation vs execution. Independent grading checks concrete actions, omissions and unnecessary questions. Deterministic tests validate grader failure paths, skill references/contracts and executable operation fixtures. No agent self-score is accepted as proof.

## Constraints and verification

Keep Node/Markdown architecture and existing APIs compatible. Existing triage Windows EACCES failure is baseline, out of scope. Start behavioral fixes with failing tests. Review implementation against this spec, then code quality. Run paired probes, targeted tests and full suite; record limits honestly. Code stays on feat/skill-reliability in the isolated worktree; implementation request does not merge/release it. Update project wiki docs with actual branch status.
