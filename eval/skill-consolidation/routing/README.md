# Candidate-loaded routing probes

The 29-case [expected matrix](expected-matrix.json) was written before any routing actor ran. It covers all 21 former entry points, the six format/service captures, named capture and named ingestion, backlog count versus processing, empty-backlog handling, scoped authoring validation, orphan reporting, freshness versus factual lint, native app actions, setup, purge, an unspecified researcher request and an ordinary application-work negative control.

Each case used a fresh Claude Code 2.1.316 session with the candidate at revision `082de0b4ee151d51cc504de825d3b92b7590a5b1` supplied through `--plugin-dir`, local-only setting sources and strict MCP configuration. No installed cache or global configuration was changed. Each session's initial inventory contains exactly the five candidate wiki-master skills and one wiki-master plugin pointing at the candidate source. The actual init events, not the actor's self-report, establish that inventory.

These are **candidate-loaded routing probes, not full workflow execution**. The prompt explicitly required an actual Skill invocation and reference reads, while forbidding workflow commands, mutation, web research and app actions. Only Skill, Read, Glob and Grep were available. Actors received the realistic request, not the expected role/mode or reference list. They did not receive prior actors' conclusions. The expected matrix remains unchanged after execution.

The [observed routing table](observed-routing.md) and [machine-readable observations](observed-routing.json) list every case separately. The executor's mechanical comparison found the expected role and required reference calls in each case, with no permission denials and exit 0; the ordinary application control made no Skill call. These observations are not an independent grade. Mode interpretation, unnecessary loads and authorization language need a fresh grader to inspect each actual answer and transcript.

Each case folder contains:

- `execution.json`: start/finish, exact prompt, redacted command, exit and classification.
- `transcript.jsonl`: complete redacted session stream including Skill calls and reference results.
- `observations.json`: initial namespace/source, actual skill calls, reference reads, answer and usage.
- `stderr.txt`: launcher stderr.

## Executor observations for review

The unspecified researcher probe stopped at clarification and read no mode reference. The empty-backlog probe selected researcher ingestion and described the hash-join/no-mutation guard; the backlog-count probe selected maintainer reporting. The author-validation probe selected the authoring reference and task-only validation. No capture/conversion or authenticated Confluence success is implied by the six format routing probes.

The empty-backlog actor's proposed non-empty continuation says publication is an "open point" and that it would ask before pushing if the user wanted a hold. This wording may conflict with the automatic-completion contract; the unedited answer is retained for the independent reviewer. Purge explicitly retained plan/apply and publication approvals. None of these probes executed the proposed actions.

All machine home prefixes and encoded host memory-directory prefixes are redacted to generic placeholders. The fixtures and requests contain no real project material. Aggregate pass percentages are deliberately omitted; per-case artifacts and independent findings are the acceptance evidence.
