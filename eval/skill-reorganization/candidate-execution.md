# Search, project and setup candidate execution

The initial nine fresh Claude Code actors ran against the source captured in
`candidate-source-project-setup-search-init-recovery-simple-validation-only-raw-failed-init-custom.json`.
The matching run receipt records the host and cases. This is executor evidence;
independent review and grades are separate artifacts, not inferred from exit zero.

Each `candidate-<case>/` contains the exact request and command, host activation,
complete sanitized tool transcript, exit result, and full before/after vault
file contents and hashes, including ignored operation state. Git fixtures also
record local and bare-remote HEAD and worktree status. Private original streams
remain in disposable scratch outside the repository.

`candidate-execution-observations.json` collects mechanical state differences and
actual tool calls for inspection. Four paired input snapshots exactly match the
baseline file hashes; recovery differs only in the freshly created owned token's
random identifier and contents. Git commit identifiers differ by fixture creation
time and are not content-equivalence assertions.

## Initial observations

| Case | Observed artifact result |
|---|---|
| Project | Architecture/backlog plus roadmap/MOC/index/log changed; scoped validation reported four checked, zero defects, two skipped; six-file relink commit reached the local bare origin with clean worktree. |
| Setup diagnostics | Validation, health, freshness, lint and search-health commands executed; all vault files and Git/remote state unchanged. |
| Advanced search | Exact phrase, alias, ambiguous titles, explicit raw/provenance and project-scoped planned-versus-shipped lookups executed; all vault state unchanged. |
| Initialization | Existing index unchanged; scaffold and log appeared; operation closed; no Git repository/remote created. **Reviewer found the ledger recorded only the log, omitting scaffold paths. Initial evidence is retained; a corrected-source rerun is required.** |
| Owned recovery | Only the explicitly owned abandoned token was removed; all content and Git/remote state unchanged. |
| Cold simple search | One bounded lookup and opened passages produced citations and lexical-coverage disclosure; no vault changes. |
| Validation only | Exact two-path validation reported the invalid backlog state; no vault changes. **Actor explicitly stated it did not read vault AGENTS. Built-in plugin presence does not establish automatic instruction injection. Corrected-source rerun is required.** |
| Failed raw coverage | The unchanged helper encountered a real ENOTDIR raw-store fixture; actor reported raw evidence not searched, not zero evidence; no vault changes or repair. |
| Customized-template initialization | Actor avoided the overwriting helper and created only missing scaffold files; index and customized template remained byte-identical; full ledger and operation lifecycle recorded, local-only outcome. |

All initial actor processes exited zero. That does not erase the two reviewer
findings. Baseline successes remain valid comparison evidence. This set does not
prove optional converter/authenticated integrations or retained research,
maintenance, purge and compatibility gates, which belong to later verification.

## Fixture boundaries

`candidate-harness.mjs` extends the retained baseline harness without modifying
historical baseline evidence. It refuses to overwrite execution directories and
requires exactly the six candidate entry points before actor launch. The failed
raw case relocates fixture raw storage outside the vault and places a regular
file at `raw`, producing a real filesystem scan failure; it does not replace
helper results or inject fake diagnostics. The separately labeled
`failed-raw-fixture-preflight.json` proves only that fixture mechanism.

Public evidence was scanned for the local account name and home-path patterns;
no matches remained. No broad safety or activation-context completeness claim
is inferred from that scoped check.

## Reviewed-source focused rerun

After the independent reviewer accepted the source corrections, three new actors
ran under `candidate-rerun1`: initialization, validation-only and simple search.
The original nine runs were not overwritten. The batch source snapshot and run
receipt use the `candidate-rerun1-source-` and `candidate-rerun1-run-` prefixes;
`candidate-rerun1-observations.json` retains mechanical observations and tool calls.

- Initialization explicitly recorded all eleven new scaffold files, then the log,
  displayed the twelve-path ledger, and closed the operation. Existing index bytes
  stayed unchanged; no Git repository or remote appeared.
- Validation-only explicitly opened the actual vault AGENTS before the validator,
  reported the same scoped defect, and changed no vault files or Git/remote state.
- Simple search explicitly read the actual vault AGENTS, ran one bounded query,
  and opened the exact page. It loaded no setup or operation preamble and changed
  no vault files or Git/remote state.

All three processes exited zero. Independent review owns the acceptance verdict;
these observations do not erase initial failures or imply perfect compliance in
other scenarios.
