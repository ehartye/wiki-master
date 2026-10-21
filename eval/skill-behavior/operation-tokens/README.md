# Operation-token guidance probes

The 0.53.1 shared maintainer guidance makes automatic resolution of an agent's own
tokens explicit, with user holds, recovery, scoped ownership and genuine blockers.
Six frozen scenarios test those decisions and adjacent read-only/foreign-token cases.

One fresh actor per condition was launched together with identical hypothetical
facts and tool semantics. The with-skill actor also received the actual maintainer
core and operations reference; the without-skill actor received neither. Actors
wrote proposed actions only. Their outputs were frozen before an independent
observer, unaware of the condition mapping, labeled exact transcript spans.

Both conditions passed **6/6 scenarios**, with **22/22 required actions** and no
forbidden actions proposed. The measured difference is **zero**. This small probe
does not demonstrate an improvement over the baseline, production reliability or
statistical superiority. It checks compatibility on detailed hypothetical facts;
the added guidance explicitly states the completion policy for installed agents.
No hypothetical Git or vault operation was executed by these actors.

`run.json` preserves exposure/hash metadata; `with-trace.json` and
`without-trace.json` retain all original answers and independent labels.
`grading.md` records interpretation limits; `comparison.json` is recomputable:

```sh
node scripts/evaluate-skill-behavior.mjs --scenarios eval/skill-behavior/operation-tokens/scenarios.json --with eval/skill-behavior/operation-tokens/with-trace.json --without eval/skill-behavior/operation-tokens/without-trace.json
```

The existing real-Git operation, cleanup and sync fixtures separately verify helper
behavior. Passing them does not establish that an agent will choose those actions.
