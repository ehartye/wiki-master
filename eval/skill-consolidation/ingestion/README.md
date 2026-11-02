# Ingestion execution evidence

These are actual fresh Claude Code sessions loading either the unchanged 21-skill baseline (`05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca`) or the five-skill candidate (`082de0b4ee151d51cc504de825d3b92b7590a5b1`) through the session-only plugin loader. They are controlled fixture executions, not live source research or self-scored simulations. No installed plugin, real vault, global configuration or production remote was changed.

## Fixtures and isolation

Each variant/case receives a separate scratch vault, complete baseline scaffold/schema/templates, and its own local bare Git upstream. Both variants start from equivalent content. The existing related concept is `wiki/concepts/Acknowledged Delivery.md`. `wiki/sources/Relay Baseline.md` is already summarized with its correct source hash. A tracked `personal.md` has an unrelated dirty owner draft before the actor starts.

The generic fixture source text explicitly describes a controlled evaluation, not a real field study. Preparation captures it with the actual `clip.mjs --from-file` helper, preserving real supplied-byte and captured-text hashes. The new source's title is `Relay Trial: Phase/7`, while its exact clipping path is `raw/clippings/Relay Trial - Phase-7.md`, exercising provenance that cannot be reconstructed safely from the title. Its supported facts are twelve messages sent, eleven acknowledgements within two seconds, one timeout at five seconds, retries disabled, and explicit limits on generalization.

The mixed fixture also contains `Restricted Relay Claim.md`. Preparation captures its body through the helper, then seeds `citation-status: quarantined` as explicit test metadata before any evaluation snapshot; this is not a claim of a live quarantine conversion. The raw body and source hash are left intact. The fully-ingested empty-backlog fixture contains only the already summarized baseline source and related concept. The actual `health.mjs --backlog` output, before and after each actor, records membership independently of an exit code.

Final runs set `TEMP`, `TMP` and `TMPDIR` to a case-specific directory under that case's scratch root, outside the vault. The actor is told to keep temporary operation files there. All vault writes remain inside the fixture, and publication targets only the local bare upstream. The embedding host is deliberately unavailable; a semantic index refresh notice is recorded honestly and does not stand in for catalog generation or publication.

## Retained initial attempts and correction

`initial-attempts/` retains the original named, named-rerun and mixed-backlog executions for both versions. Their outputs showed successful ingestion and publication, but independent inspection found an isolation flaw in the initial harness: a candidate actor used the inherited system temp directory for generic `tok.txt` and ledger names. The harness had not overridden those variables, creating collision risk. The named actor also omitted the efficacy reference and vault-schema read before editing the concept.

Those attempts are not silently replaced or used to certify final isolation. All affected cases are rerun from equivalent fresh fixtures with the corrected temp environment. The same neutral prompt addition for baseline and candidate asks the actor to follow applicable skill references and vault instructions; it supplies no expected summary, facts or answer. Initial policy omissions remain evidence for independent review.

## Required scenarios

| Case | Request | Artifact observations required |
|---|---|---|
| named | Ingest the exact existing trial clipping | Faithful summary, exact path/hash provenance, unchanged raw bytes and old summary, reuse existing concept, scoped catalog/log/commit, token closure and actual local-remote equality |
| named-rerun | Repeat the identical named request in a fresh session | No duplicate page, new log, operation, commit, catalog or semantic-index mutation |
| backlog | Process new/un-ingested clippings without a filename | Real hash-join selection; process only the eligible trial; preserve existing summary; exclude quarantined evidence as support; actual membership reduces from trial+restricted to restricted |
| empty | Process new/un-ingested clippings in fully-ingested fixture | Actual zero backlog, no file/token/log/commit/index mutation |

## Artifacts and interpretation

Each final case directory retains preparation details where applicable, the exact actor command/prompt/environment/exit, sanitized full transcript, observed skill calls and Read-tool reference loads, host usage, and before/after snapshots. `state.json` contains content hashes, relevant raw/derived text, actual backlog helper output, Git HEAD/status/history and the bare remote HEAD. Shell-based reads and all executed helper commands remain in the transcript. `artifact-checks.json` and the combined `artifact-results.json` check observable invariants; independent grading of source fidelity and instruction compliance is separate.

The helper preparation and snapshots are evaluator actions outside the actor's execution window. For no-op cases, the snapshot compares all vault files including local operation/index state, plus Git HEAD/status and remote HEAD. Git's internal transport bookkeeping is not represented as wiki content. No aggregate result can hide a failing case; final independent review remains the delivery gate.

## Final executed results

| Scenario | Baseline artifact checks | Candidate artifact checks |
|---|---|---|
| Named ingestion | Pass; one scoped operation commit published | Pass; one scoped operation commit published |
| Identical named request rerun | Pass; no file/Git/token/log/index mutation | Pass; no file/Git/token/log/index mutation |
| Default mixed backlog | Pass; eligible trial summarized, restricted capture excluded | Pass; eligible trial summarized, restricted capture excluded |
| Fully-ingested empty backlog | Pass; helper reports zero and snapshots unchanged | Pass; helper reports zero and snapshots unchanged |

All eight final actor processes exited 0 with no permission denials. The paired fixture files are byte-identical before execution (`fixture-equivalence.json`). Both mutating candidate runs actually loaded the efficacy reference and read the vault schema. The final named-rerun candidate did not run the backlog helper itself: it honestly reported not locating the plugin root and used the source page's matching source hash to establish prior ingestion. The evaluator's actual helper outputs independently corroborate that relation before and after. This correct no-op does not establish that the actor resolved the helper path; retain that limitation. The final baseline backlog actor did not separately load efficacy, although its resulting content and concept reuse passed artifact inspection.

The final `artifact-results.json` checks the expected selected ingestion role, isolated temp environment, absence of external research tools, actual helper backlog membership, immutable bytes, prior-summary/draft preservation, exact citation/hash, concept reuse, restricted-evidence exclusion, operation lifecycle commands/artifacts, scoped commit and actual local-remote equality. Source fidelity and policy-compliance findings belong to the separate fresh reviewer.

Final evidence sanitation covers Windows backslash paths, Windows slash paths, Git Bash `/c/Users/...` and WSL `/mnt/c/Users/...` forms. The Git Bash form was added after the reviewer identified a leak in the first redaction pass; all retained initial and final public artifacts were reprocessed and the final concrete-user scan returned no matches. Raw private session output remains only in the isolated scratch area.
