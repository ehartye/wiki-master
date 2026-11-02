---
name: wiki-purge
description: Use when explicitly asked to purge or remove a topic from the wiki and its evidence, restore a purge, or reconcile an interrupted removal. Requires a reviewed removal plan and explicit publication approval; broken-link repair belongs to wiki-maintainer.
---

# Purge a topic

Read the full [purge procedure](references/purge.md),
[access](../wiki-maintainer/references/access.md),
[evidence](../wiki-maintainer/references/evidence.md), and
[operation completion](../wiki-maintainer/references/operations.md) before acting.

Check history connectivity before mutation; stop on unrelated histories. Inspect
search coverage and every seed, then show the removal plan with collateral and
blocking pages and obtain explicit approval before applying it. Never infer
approval from selecting this skill. Resolve blocking evidence dependencies and
use the same approved seeds when applying.

Purge owns its manifest, moves, declines, log and transaction commit; do not wrap
it in a competing ordinary operation. Repair collateral pages in their own scoped
operation, and obtain explicit approval before publishing the removal. These
purge approvals override ordinary automatic publication.

Verify that the broken-link count did not grow; a better health score is not
proof. For an interrupted purge, reconcile the same transaction rather than
apply a new empty plan. Restore preserves newer files and reports missing bin
entries. Never hard-delete the recycle bin or use its contents as evidence.
