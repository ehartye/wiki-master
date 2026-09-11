# Independent grading of the 2026-09-11 frozen-eight pair

Observer: `/independent/skill_audit_observer_a`, separate from both actors and from the
party that produced the scenarios. Both actors received prompt/fact inputs without the
evaluation rubric, without prior traces, and without each other's output. Both inherited
general host instructions and the skill catalog's names/descriptions, so the without
condition is **not** wholly skill-free — only skill *bodies* were withheld.

| Condition | Complete scenarios | Passed | Required actions observed | Forbidden actions proposed |
|---|---:|---:|---:|---:|
| With skill bodies | 8/8 | 8/8 | 32/32 | 0 |
| Without skill bodies | 8/8 | 4/8 | 29/32 | 1 |

The observed difference is four passed scenarios in this pair. Every action label is
grounded in an exact span of that condition's own scenario section, machine-verified by
substring match at assembly time. Missing steps were not inferred from generic workflow
language. These counts describe simulated proposals, not executed success.

## Findings

- **Without / offline-author:** missing `log`. It brackets the write and publishes, but
  never proposes writing the operation log entry.
- **Without / lookup:** proposes the forbidden `offer-save`. Against a prompt that said
  "Do not add anything," it still closes with an offer to fold the result into the wiki.
  The with-skills actor's closing offer is for in-conversation synthesis with filing
  deferred to separate authorization, which the observer did not label.
- **Without / freshness:** missing `inspect-evidence`. It answers entirely from
  frontmatter metadata and bucket counts, never opening a clipping or comparing a page's
  claim against its evidence.
- **Without / discovery-only:** missing `commit-operation`. It hands back raw captures and
  pauses for review, leaving the vault dirty while the user decides.

**The freshness scenario now passes in the with condition.** The 0.36.0 pair recorded a
with-skills failure on exactly this scenario (missing `inspect-evidence`), which prompted a
correction to `wiki-stale`. This independent pair is the first full eight-scenario run
since that correction and shows it holding.

## Observer's disclosed judgment calls

- `open-operation` was credited in without/offline-author for a pre-write
  `git status --porcelain` snapshot explicitly framed as making the bracket real, on the
  grounds that it serves the same dirty-file-exclusion purpose as `op-begin`. A stricter
  reading requiring the named primitive would drop that run to 8/10 required actions. The
  scenario fails either way.
- Four of eight scenarios are exact ties (`naming-near-miss`, `authorized-discovery`,
  `uncertain-write`, `app-only`). The observer noted the without-skills prose is arguably
  sharper in several, and that the gaps are concentrated in operation lifecycle and
  evidence discipline rather than judgment.

## Limits

- One fresh pair of eight simulations. Not repeated sampling, not an activation test, not
  execution evidence. No scenario vault, Git, app or network workflow was executed.
- **This pair cannot measure triggering.** Both conditions were handed their skill bodies
  by the harness. Nothing here establishes that a real user phrasing would load the right
  skill; description quality is untested by this method.
- The observer necessarily knew which condition was which. Actors reported no rubric
  exposure and disclosed their inherited context.
- Exact-span validation makes labels reviewable; it does not prove semantic entailment.
- `contextCharacters` and `durationMs` were not measured and remain null. Transcript length
  is not a substitute for context cost.
