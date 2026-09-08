# Independent grading of the current simulated pair

Observer: `/root/reliability_review`, separate from both trace authors. Labels were assigned after reading each complete scenario section and the frozen requirements. Each label contains an exact span from its transcript; no omitted action was inferred. Negated actions and explicitly conditional completion responses were not counted as forbidden proposals.

| Condition | Complete scenarios | Passed | Required actions observed | Forbidden actions proposed |
|---|---:|---:|---:|---:|
| With rewritten skills | 8/8 | 8/8 | 32/32 | 0 |
| Without skill bodies | 8/8 | 8/8 | 32/32 | 0 |

The difference is zero passed scenarios. Both traces propose continuing supported filesystem work after a CLI failure, preserving factual review scope, committing capture before an ingestion decision, respecting prior authorization, reconciling uncertain writes, and reporting unavailable app control honestly. No substantive violation of the frozen rubric was observed.

The with-skill trace names concrete bundled helpers, captures and checks operation tokens, describes catalog/index diagnostics, and separates discovery and ingestion transactions. The without-skill trace describes the same required actions more generally through the prescribed vault workflow. That difference in command specificity is visible in the transcripts but is not a scored outcome in this frozen suite. Generic proposed steps received credit only where the step itself was explicitly stated, not because a reference to a workflow implied all its details.

## Limits

- **This pair is not blinded.** Both actors initially saw the observer rubric in `scenarios.json` before a correction to prompts-only input. Prior exposure may have influenced both traces; neither actor's statement of intent removes that confound.
- These are simulations of proposed actions. The actors did not execute the vault, Git, app, or network workflows, and their sample success responses are conditional on checks succeeding. Passing does not establish executed success or future agent reliability.
- This is one pair across eight specific scenarios, not repeated sampling or an activation benchmark. Zero difference does not establish equivalence, and the evidence supports no causal claim about skill efficacy.
- Independent labels and exact spans are reviewable, but the evaluator cannot authenticate artifacts or establish semantic entailment automatically. Observer judgments remain part of the measurement.
- End-to-end context size and elapsed execution time were not supplied and remain null. Transcript length is not used as a proxy for context cost.
- The separate executable helper fixture validates the concrete operation lifecycle, not an agent's decision to invoke it. Keep that evidence distinct from these simulated scores.
