# Independent grading of the fresh simulated pair

Observer: `/root/reliability_review`, separate from both actors. These actors received prompt/fact inputs without the evaluation rubric or previous traces. Both inherited general conversation instructions, standing AGENTS text, and the skill catalog's names/descriptions. Only the with condition loaded skill bodies; the without condition is not wholly skill-free.

| Condition | Complete scenarios | Passed | Required actions observed | Forbidden actions proposed |
|---|---:|---:|---:|---:|
| With rewritten skill bodies | 8/8 | 7/8 | 31/32 | 0 |
| Without skill bodies | 8/8 | 5/8 | 28/32 | 0 |

The observed difference is two passed scenarios in this pair. Each action label is independently grounded in an exact span of the complete scenario section. Missing steps were not inferred from generic workflow language. These counts describe simulated proposals, not executed success or general skill efficacy.

Actors: with `/root/reliability_blind_with`; without `/root/reliability_blind_without`. Observer: `/root/reliability_review`. Both actors used the inherited/default Codex runtime; exact model ID was not exposed. No durations were measured or guessed.

## Findings

- **With / freshness:** missing `inspect-evidence`. The trace reads review metadata, reports the 12 missing dates and zero successful drift evaluations honestly, and recommends review. It does not propose inspecting recommendation claims against supporting evidence. Metadata inspection alone does not satisfy the frozen requirement for answering whether recommendations remain current.
- **Without / offline-author:** missing explicit `log` and `commit-operation` actions. It proposes pre/post-write brackets and authorized publication, and mentions keeping unrelated changes out of the task's commit. It never explicitly proposes writing the operation log or performing/verifying the commit. Those omitted actions were not inferred from publication or a generic bracket.
- **Without / authorized-discovery:** missing `commit-operation`. It captures, inspects, ingests, validates and publishes, but does not propose an operation commit.
- **Without / discovery-only:** missing `commit-operation`. It saves and verifies raw captures and leaves the review decision pending, but does not propose committing capture before pausing.

Both conditions handle read-only lookup, application naming boundaries, uncertain mutation inspection and unavailable app control without a forbidden proposal. Both preserve the whole-guide review date in the authoring scenario and reuse existing discovery/ingestion authorization.

The without trace receives `reconcile-operation` credit for explicitly reconciling the original pending request state before another create; the frozen label does not separately require recovery-token bookkeeping. Its discovery-only trace receives `request-ingest-decision` credit for explicitly keeping the user's review request pending and waiting for the decision; the rubric does not require a particular question sentence. These judgments are recorded so later reviewers can assess their scope.

## Limits and subsequent correction

- This is one fresh pair of eight simulations, not repeated sampling, an activation test, or execution evidence. The actors executed no scenario vault, Git, app, or network workflow. Conditional sample success responses were not treated as observed success.
- The independent grader necessarily knew the conditions. The actors reported no evaluator-rubric exposure, but inherited catalog/general instructions were shared context. Do not describe the without condition as having no wiki-master context.
- Exact-span validation makes labels reviewable; it does not automatically prove their semantic entailment or authenticate supplied artifacts. Observer judgment remains part of the measurement.
- End-to-end context size and elapsed execution time were not supplied and remain null. Transcript length is not a substitute for context cost.
- The original rubric-exposed pair is preserved separately under `../rubric-exposed/`; its 8/8 versus 8/8 scores are not pooled with this pair.
- After this pair completed, the owner revised wiki-stale to explicitly route currentness questions through bounded claim/evidence inspection. These artifacts retain the pre-correction freshness failure; a targeted follow-up probe must be reported separately, not as an eight-scenario rerun.
- The separate executed helper fixture validates the concrete operation lifecycle, not whether an agent chooses to invoke it.
