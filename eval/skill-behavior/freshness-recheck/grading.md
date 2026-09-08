# Independent grading of the targeted freshness recheck

This is the unchanged freshness scenario from the frozen suite, rerun after wiki-stale gained explicit claim/evidence inspection for currentness questions. Its one-scenario dataset has a distinct hash. It is not an eight-scenario rerun.

| Condition | Complete scenarios | Passed | Required actions observed | Forbidden actions proposed |
|---|---:|---:|---:|---:|
| With corrected skill bodies | 1/1 | 1/1 | 3/3 | 0 |
| Without skill bodies | 1/1 | 1/1 | 3/3 | 0 |

Observer: `/root/reliability_review`, separate from actors `/root/freshness_recheck_with` and `/root/freshness_recheck_without`. The actors used the inherited/default Codex runtime; exact model ID was not exposed. Durations and end-to-end context costs were not supplied or guessed.

Both traces explicitly propose reading recommendations and supporting evidence, report missing factual-review dates, and disclose zero drift evaluation coverage. Neither proposes asserting blanket currency, stamping review dates, or treating a failed drift check as no drift. Exact-span labels and complete supplied transcripts are in the accompanying trace JSON files.

The corrected with-skill trace now includes the action omitted in the prior full-pair freshness trace: reading selected claims, resolving citations and reading raw evidence, assessing dates/support, and reporting checked and unchecked coverage. It distinguishes an evidence route from actual claim support and historical evidence from current verification. This observation supports the targeted correction's intended behavior in one simulation.

## Limits

- Both actors inherited general instructions, standing AGENTS text and skill catalog names/descriptions. Only the with actor loaded skill bodies. Without is not a wholly skill-free condition.
- Neither actor read evaluator requirements or prior traces, but **prompt context was not strictly matched**: the with actor accidentally saw all scenario prompts/facts before focusing on freshness; the without actor read only the freshness entry. Preserve this deviation rather than presenting a fully controlled comparison.
- These are proposed actions, not executed wiki reviews. No actual claim, citation or publication status was verified by the actors. Conditional example responses are not execution evidence.
- One targeted pair cannot establish reliable future behavior or a causal/general efficacy gain. The result is 1/1 versus 1/1, not an improvement over the paired without condition.
- The earlier full-suite report remains 7/8 with versus 5/8 without, including its genuine pre-correction freshness failure. Do not combine this single retest with the earlier seven passes and label the resulting total a fresh 8/8 run.
- Grading requires observer judgment. Exact transcript spans make those judgments inspectable, but the evaluator does not automatically prove semantic entailment or authenticate artifacts.
