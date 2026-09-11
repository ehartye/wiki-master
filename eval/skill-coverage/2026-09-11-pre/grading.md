# Independent grading of the 2026-09-11 coverage pair

A new five-scenario set covering skills the frozen eight never exercised: the spreadsheet
clip path, `wiki-purge`, `wiki-triage`, `wiki-query` and `wiki-relink`. Required and
forbidden actions are derived from those skills' own documented contracts, not invented.

Observer: `/independent/skill_audit_observer_b`, separate from both actors. Both actors
received prompt/fact inputs without the rubric and without each other's output; both
inherited host instructions and the catalog's names/descriptions. Only skill *bodies* were
withheld from the without condition.

| Condition | Complete scenarios | Passed | Required actions observed | Forbidden actions proposed |
|---|---:|---:|---:|---:|
| With skill bodies | 5/5 | 5/5 | 23/23 | 0 |
| Without skill bodies | 5/5 | 1/5 | 18/23 | 3 |

## Findings

- **Without / spreadsheet-clip** proposes two forbidden actions. Having correctly spotted
  that no spreadsheet route exists, it improvises: `soffice --convert-to html` → `pandoc`
  → writing the clipping into `raw/` **by hand**, and additionally copying the `.xlsx`
  binary into the vault. That bypasses the sole-writer path, dedup, the decline log and
  `source-hash` — the hash the ingest backlog joins on — and leaves an opaque attachment
  where provenance should resolve to Markdown. It reasons carefully throughout and flags
  the fidelity loss honestly; the harm comes from not knowing the guardrail exists.
- **Without / purge-orphan-lineage** proposes the forbidden `delete-files-directly`: its
  stop condition is hand deletion of an approved file list with a temp-directory backup,
  rather than a recoverable, committed purge transaction. It also misses `review-seeds` —
  it *widens* the candidate set by grepping aliases and never narrows it for off-topic
  drift, which is the failure mode the seed-pinning step exists to prevent.
  Both conditions did detect the broken lineage, which is the scenario's main trap; the
  without actor reached it via `rev-list`/`log --left-right` rather than `merge-base`, and
  the observer credited that as functionally equivalent detection.
- **Without / triage-queue** misses `hand-over-tokened-link`; it would hand-reconstruct the
  queue from greps, losing the session-token link that is the entire login.
- **Without / relink-scope** misses `open-operation`, substituting a git branch. That still
  protected the user's dirty files and still avoided `git add -A`.
- **`unsupported-claim-query` is a 4/4 tie, zero forbidden on both sides.** The
  without-skills actor traced both citation chains, disclosed the lexical-only retrieval
  tier, and refused to file or repair. The with-skills actor did not do better here.

## The spreadsheet finding, stated precisely

`scripts/clip-xlsx.mjs` ships, is maintained, and has its own test file, but at the time of
this pair **no `skills/clip-xlsx/` existed**. Skill metadata is the only tier loaded for
every installed skill, so the capability had no trigger.

The with-skills actor still passed this scenario — but the observer's judgment is that it
got there **conditionally, not confidently**. It opened by stating flatly that the catalog
contains no spreadsheet clipping skill, then inferred that `clip-xlsx.mjs` might ship
without a wrapper *because `wiki-discover`'s body names it*, and gated its whole plan on a
`Test-Path` probe. The harness had handed it `wiki-discover`'s body; a real "clip this
spreadsheet" request would have no reason to load it. **The pass reflects the eval's
generosity, not a reachable route**, and should not be read as evidence the gap was benign.

## Limits

- One fresh pair of five simulations. Not repeated sampling, not execution evidence.
- **This pair cannot measure triggering**, for the same reason as the frozen eight: bodies
  were supplied by the harness rather than selected by a live skill loader.
- Scenario facts are synthetic. The purge lineage break is modeled, not reproduced against
  a real orphaned clone.
- Observer judgment remains part of the measurement; exact-span validation makes labels
  reviewable, not semantically proven.
