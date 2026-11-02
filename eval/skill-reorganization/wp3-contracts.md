# WP3 — Catalog, documentation and contracts

This package follows WP2's independent PASS. It updates current source guidance
and assertions for the six-skill layout; it does not release or install it.

## Changes

- README, Codex usage and current reliability guidance route lookup to search,
  original writing to project, reports/validation/setup to setup, content actions
  to maintainer, evidence work to researcher and removal to purge.
- The migration document maps both the released 0.88.0 routes and earlier entry
  points to their current owners, without forwarding skills or assigned release
  versions. It names all four covered companion caller files by owning project.
- Specialist public API documents link their canonical setup procedures. Public
  helper contracts and explicitly historical measurements remain reference
  material. The authored schema template points to project placement guidance.
- The catalog is generated exactly from current sorted skill names/descriptions.
- Skill contracts require exactly six matching portable entry points, ordered
  workflows, request/action/result examples, best practices and done conditions.
  They retain direct capability/helper checks, all six capture routes, recursive
  file/heading checks and the broken-link guard fixture. The recursive check now
  also starts from maintained public documentation.
- Canonical ownership assertions protect read-only search/answers, direct
  validation obligations, authorized query-operation filing and read-only setup.
  Authoring vocabulary/placement/dependency tests now read the actual project
  and setup owners; all underlying runtime behavior assertions are preserved.
- The only runtime text change is `/wiki-init` to `/wiki-setup` in the unregistered
  vault error. An obsolete authored-contract source comment now points to project.
- The original section inventory is retained and gains an exact canonical
  destination table for all 28 baseline references and their recorded splits.

## Retained historical references

`docs/skill-migration.md` names retired skills as migration inputs. Dated
`docs/superpowers/` plans, specifications and research, CHANGELOG entries, and
pre-existing evaluation directories retain their historical names and outcomes.
The historical portions of `docs/skill-reliability.md` remain explicitly labeled.
These are not active callers and were not mechanically replaced. Installed
plugin caches and unavailable source repositories remain outside source edits.

## Findings and corrections

An early focused run passed 63 of 64 tests. The existing helper-path guard found:

```text
skills/wiki-setup/references/capture-prerequisites.md -> scripts/page.mjs
```

The setup text named `confluencer/scripts/page.mjs`, an external plugin helper,
which the unchanged guard interpreted as a bundled script. With coordinator
authorization, the text now says external confluencer `page.mjs` in that plugin's
`scripts` directory. The prerequisite contract is unchanged; the guard was not
weakened. This narrow WP2-reference correction belongs in fresh WP3 review.

Intermediate skill-contract checks correctly failed while workflow references,
the catalog and retired report files were still being migrated. An assertion for
the same-directory synthesis `operations.md` link was corrected to its actual
relative form. Those intermediate checks are not final package results.

## Verification

After the workflow author's source-ready signal:

- `npm.cmd run test:skills`: exit 0, 46/46 passed, no skips.
- `node --test test/validate-authored.test.mjs test/drift-guard.test.mjs test/triage-skill-table.test.mjs`: exit 0, 64/64 passed, no skips.

[Exact command receipts](wp3-command-receipts.json), [skill output](wp3-skills.tap)
and [structural output](wp3-structural.tap) retain the results with local paths
sanitized. These checks do not substitute for WP4 actors. Full `npm test` belongs
to WP4 integration. Fresh independent package review remains the progression gate.
