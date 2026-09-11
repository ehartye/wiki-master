# Targeted recheck after adding `skills/clip-xlsx/`

The coverage pair was run before `skills/clip-xlsx/` existed. A report cannot substitute
for a fresh run after a material skill change, so this is that run: the unchanged
`spreadsheet-clip` scenario, its own one-scenario dataset, separate trace files, and a
third observer (`/independent/skill_audit_observer_c`) who graded neither earlier pair.

Both actors were given the **regenerated** catalog, which now lists `clip-xlsx` among the
twenty installed skills. Only skill bodies were withheld from the without condition.

**The with actor was deliberately not given `wiki-discover`.** In the pre-remediation pair
that body was the only thing that named `clip-xlsx.mjs`, and it was what let the actor
deduce a route. Withholding it here tests the thing that actually changed: whether the new
skill is reachable on its own.

| Condition | Complete | Passed | Required actions | Forbidden actions |
|---|---:|---:|---:|---:|
| With skill bodies | 1/1 | 1/1 | 5/5 | 0 |
| Without skill bodies | 1/1 | 0/1 | 4/5 | 1 |

## The route is now selected, not deduced

Before the change, the with actor opened by stating no spreadsheet skill existed, inferred
that `clip-xlsx.mjs` might ship without a wrapper because `wiki-discover` named it, and
gated its entire plan on a `Test-Path` probe.

After the change it picks the route from metadata alone and rules out the neighbours:

> the route is **clip-xlsx** ("clip a spreadsheet or workbook (.xlsx, .xls, .xlsm) into the
> wiki as Markdown evidence")

The observer's own summary is that it "selected the route confidently and directly from the
installed catalog." No probe, no inference, no dependency on an unrelated skill being loaded.

## What each tier bought, and the caveat on that reading

The without arm differs between the two runs only in that the catalog now carries a
`clip-xlsx` description:

| Without-skills arm | Required | Forbidden |
|---|---:|---|
| Pre-remediation (no `clip-xlsx` in catalog) | 3/5 | `hand-write-clipping`, `store-binary-attachment` |
| Recheck (description present, body withheld) | 4/5 | `hand-write-clipping` |

The description alone was enough to stop it storing the binary and to carry the
markdown-and-topic convention. It was **not** enough to stop it hand-writing the clipping:
without the body it still improvised `soffice` → `pandoc` → hand-authored frontmatter
"mirroring an existing clipping", bypassing the sole-writer path, dedup and the hash the
ingest backlog joins on. Metadata routes; the body enforces the guardrail.

**This is a suggestive single sample, not a controlled ablation.** The two without runs are
different actor instances answering at different times, and only one sample each. The
direction is consistent with the design, but the magnitude should not be quoted as measured.

## Limits

- One scenario, one pair, simulation mode. No vault, Git or converter was executed.
- Still not an activation test. Both actors were handed the catalog by the harness rather
  than a live skill loader choosing from a real user utterance.
- The without arm remains a capable, careful agent that got topic, markdown-not-binary,
  verification and the ingest boundary right by general care. The gap it shows is the
  guardrail, not competence.
