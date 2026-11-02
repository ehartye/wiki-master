# Coordinated release preparation

Prepared versions: wiki-master 0.89.0, hartye-skills 0.9.5,
agent-game-studio 0.4.1 and agent-unreal 0.38.2.

The four feature branches were rebased onto their current default branches before
publication. Studio's new 0.4.0 advisory workflow is preserved: the conflict was
resolved by changing only wiki routing in its current plugin map. Its structural
regression now checks search, project and setup routes, rejects retired names,
and retains optional wiki use. The first post-rebase check failed on the old
wiki-user assertion; the corrected full Studio check passes all 80 tests.

Wiki release metadata was updated through the supported bump-version helper.
Post-bump skill tests pass 46/46 and authored/drift/triage checks pass 64/64.
The implementation's retained full-suite result is 2309 passes, zero failures,
and one private-dictionary skip. PDF converter verification passes 72/72.
Unreal's complete `node scripts/check.mjs` passes its Node tests and 15 skill
lints; its release-consistency subset also passes 17/17. The final wiki
contract/drift rerun after the migration-guide edit passes 21/21.

The implementation handoff and prior receipts remain historical evidence.
Release tags, merged pull requests and the coordinated marketplace pins establish
publication; this preparation record alone does not establish a shipped release.
Host installation is a separate action.
