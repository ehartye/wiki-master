# WP3 — Remaining workflow migration

This source package follows the independent WP2 PASS. It implements the remaining
maintenance, research and purge workflows on the unreleased six-skill candidate.
It changes no runtime behavior, helper interface, storage schema or release version.

## Owned changes

- `wiki-maintainer/SKILL.md`: ordered content/action workflow, examples for
  integrity and factual repairs, relationships, triage, authorized synthesis
  filing and native actions; direct scoped validation and conditional checks.
- `wiki-researcher/SKILL.md`: explicit discovery/named capture/format capture/named
  ingestion/default-backlog modes; independent selection, eligibility before
  mutation, exact ledgers and an actual retrieval handoff remain visible.
- `wiki-purge/SKILL.md`: preview, reviewed apply, restore and authorized reconcile
  examples; exact seeds, separate publication approval and transaction ownership.
- Maintainer workflow references: repair, relink, lint, triage, Obsidian actions
  and cross-role workflow comparison. Old health/stale reporting references are
  retired; no forwarding reference or role was added.
- Researcher capture/ingest and all six format references: action contracts stay
  researcher-owned; prerequisite probes and failure recipes link setup directly.
- Purge reference: action/approval/restore contracts stay purge-owned; checks and
  interrupted recovery link directly to setup.

## Canonical splits

| Previous procedure | Final home / retained obligation |
|---|---|
| Health, freshness and lint report mechanics | Setup `checks.md`; maintainer reads findings and owns actual corrections/dispositions |
| Relink identity/topology checks | Setup checks, with maintainer retaining candidate inspection and supported relationship actions |
| Native Windows invocation, empty canary and failure recipes | Setup `app-access.md`; maintainer retains guarded commands, uncertain-target inspection and honest fallback |
| Triage remote token/port/rotation/reachability | Setup app-access section; triage retains requested remote launch, token-bearing returned link, topic groups and exact disposition table |
| Every capture format's preflight | Direct matching setup `capture-prerequisites.md` section; each format retains actual helper and supported output/fidelity contract |
| PDF tool/reading-mode/legacy fidelity diagnostics | Setup PDF sections; PDF capture retains OCR/table fidelity floors, selection/caps/sidecars/hash checks and source/figure verification |
| Word short/corrupt-document diagnosis | Setup Word section; capture retains inspected-completeness prerequisite for `--allow-short` |
| PowerPoint interpreter/legacy-format failures | Setup PowerPoint section; capture retains `.pptx` support and slide/table/note fidelity limits |
| Spreadsheet converter/tiny-workbook failures | Setup spreadsheet section; capture retains no-PDF rule, labels/values verification and no invented override |
| GitHub auth/cap/clone failures | Setup GitHub section; capture retains per-file/digest, exact-ref citations, bounded listings, pruning and output accounting |
| Confluence optional integration/failure/version limitation | Setup Confluence section; capture retains external-client dependency, exact URL/version provenance and no fabricated raw page |
| HTML thin/wrong-node/transient/clash/supplied-file refusals | Setup HTML section; capture retains dedup/decline/recapture/supplied-page interfaces, plaintext output, topic attribution and completion |
| Ingestion backlog reporting | Direct setup backlog check; normative source-hash join remains maintainer-owned, eligibility and zero-work semantics remain researcher-visible |
| Ingestion search handoff | Search main plus direct advanced/answer references; retrieval actually runs against the updated vault |

Shared raw immutability, source restrictions, platform separation, identity and
transaction policy remain in the WP2 maintainer contracts. Concise obligations at
the point of action are retained; task authors do not need to load setup's main
file or run unrelated whole-vault checks.

## Narrow WP2 ownership corrections

The orchestrator explicitly authorized two missing setup extractions during WP3:

- `wiki-setup/references/operation-recovery.md#purge-history-connectivity`
  owns the baseline fetch/merge-base diagnostic, actual upstream selection,
  missing-fetch/upstream versus confirmed unrelated-history distinction and
  local-only non-Git interpretation.
- `wiki-setup/references/checks.md#purge-broken-link-verification` owns the
  before/after legacy broken-link check and why neither the legacy score nor
  default integrity count substitutes for it. Optional native unresolved-link
  attribution is preserved without requiring an app.

Purge retains the check obligations and links both sections directly. Its existing
interrupted-recovery procedure already lived under setup. A preview never invokes
mutating `--reconcile`; an explicitly authorized interrupted-removal task uses the
same transaction rather than another `--apply`. The independent WP3 reviewer must
inspect both added sections; they are not covered merely by the previous WP2 PASS.

## Checks and limits

Author ran:

```text
node --test test/skill-contracts.test.mjs test/triage-skill-table.test.mjs
git diff --check
```

Results: 12/12 tests pass, zero skips; diff check exits zero. Recursive local
file/heading checks pass through the current six mains and their references.
An owned-tree search finds no `wiki-user`, `wiki-init`, `health.md`, `stale.md` or
obsolete “Refused sync” destination. Metadata was coordinated with the catalog
author; all three rewritten descriptions remain below 1,024 characters.

These are static/contract results, not behavioral grades. Fresh retained-workflow
actors, applicable optional integration limits and independent package review are
separate gates. Historical evaluation evidence and installed copies are untouched.
