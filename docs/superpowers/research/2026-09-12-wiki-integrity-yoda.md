# Yoda audit: integrity skills

The audit found a stale verification command and repair destination in
`wiki-purge`. Both are corrected. Four paired, executed fixture tasks succeeded
with and without the skills. The observed benefit was operation lifecycle and
more explicit reporting, not better repair accuracy.

## Findings and changes

1. **Purge verification requested an output line that no longer exists.** The
   skill called default `health.mjs` and asked the agent to compare its **broken
   links** line. The integrity default has no such line. A command probe reproduced
   this and confirmed `--legacy` still provides it. Both baseline and final purge
   checks now explicitly use `--legacy`, with the baseline saved before mutation.
   The integrity count cannot replace this check because it does not know which
   missing navigation targets a purge deleted. No purge was executed.
2. **Purge metadata sent ordinary broken-link repair to the old workflow.** Its
   description now routes to `wiki-repair`. This was a verified routing inconsistency
   in the text, not an observed native-host misfire.

The relink procedure's operation wording looked potentially ambiguous during
inspection. The executed no-change case correctly opened no operation and made no
log or commit. No behavioral failure was demonstrated, so that wording was left
unchanged. No additional trigger aliases or rules were added speculatively.

## Paired execution

Both actors were spawned in the same turn into fresh contexts. Each executed the
same four prompts sequentially in separate, identically seeded Git vaults, using
the actual scripts at `a4a4a45`. The with-skill actor selected from a frozen catalog
of all 21 skills and read the selected bodies and shared references. The baseline
had the same helper access and fixture instructions, but could not read skills or
their catalog. Neither could use the live vault, network, Obsidian, or push.

| Task | Without skills | With skills |
| --- | --- | --- |
| Repair two specified defects; preserve other findings and dirty work | Correct two edits; scoped commit | Same correct edits; operation opened before writes, one log, scoped completion |
| Health report only; preserve intentional unwritten links | 0 defects; no edits | 0 defects, 2 unscored forward links; no edits or operation |
| Connect two pages only if evidence justifies it | Rejected the unsupported shared-source candidate; unchanged | Same rejection; unchanged, no operation |
| Check a universal quote against evidence reporting 9/12 | Identified contradiction; no edits or review stamp | Same evidence finding; no edits or review stamp |

Both repair runs reduced defects from 3 to 1, resolved the two assigned IDs,
preserved the unrelated defect, both forward links, raw evidence, reviewed dates
and pre-existing user draft. Both committed only their own work; the with-skill
commit additionally included its operation log. Neither treated unavailable
semantic evaluation as a clean factual verdict.

The with-skill actor selected repair, health, relink and lint for their respective
cases, with shared maintainer guidance and an additional health check for lint.
This tests catalog-based selection, not automatic triggering in an installed host.
The health, relationship and factual-review tasks are near misses for repair.

## Inspection and verification

All 21 skills have directory-matching names and resolving direct Markdown
references. Descriptions measure 161–301 characters; the longest SKILL.md is 235
lines. No unexpected Unicode control/format codepoints were found in SKILL.md
files. Six argument-substitution matches were reviewed: all are intentional
`$ARGUMENTS` request placeholders, not accidental shell positional parameters.
The initial broad scan flagged these; its disposition is recorded in the audit
JSON. This scan does not establish provenance or certify safety.

The changed purge skill passes the skill-creator validator. Thirteen existing
skill contract, behavior and workflow tests pass, including offline scoped commit
and local-remote publication. The default/legacy command probe verifies the
corrected purge output contract. This audit changes prose and preserves evaluation
artifacts; the previous implementation's full-suite result remains 1,056 passed,
zero failed, one skipped. The full suite was not repeated for this documentation
change.

## Evidence and limits

The [artifact directory](../../../eval/skill-behavior/2026-09-12-integrity-yoda/)
contains synthetic inputs, frozen catalog, exact commands and returned output,
verbatim actor responses, static measurements and the purge command probe. An
independent grader checks actual Git trees, content and operation state, separately
from the actors' claims. Its report and evidence are saved alongside those inputs.
The older [simulation](2026-09-12-wiki-repair-validation.md) remains labeled as such;
this audit supplies actual execution evidence without rewriting historical results.

This is one execution per case per condition, with four tasks sharing each actor's
context. Both actors could inspect the deterministic helpers, which already carry
much of the policy. Equal core correctness does not establish a general skill
advantage, and the baseline's missing operation log is a workflow difference, not
a failure of its stated fixture task. The fixtures omit semantic services,
Obsidian, live concurrency and remote publication. Synthetic matching source hashes
test identity routing; they are not a content-hash validation experiment.

The baseline's initial `rg` transcript contains the unexplained text
`Ask Codex to do anything` where the tool result displayed file paths. That original
artifact and a subsequently corrected PowerShell diagnostic parser error are
preserved. Independent filesystem reads and actual Git/Node verification establish
the results; the discrepant inventory transcript is not used as success evidence.
Captured artifacts retain their original whitespace, including the grader's mixed
Windows line endings; whitespace validation is applied to edited project prose,
not used to rewrite those records. Exact diagnostics are also JSON-escaped in the
grading evidence.
No observed behavior here certifies overall skill safety or all-library reliability.
