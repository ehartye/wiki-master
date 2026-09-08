---
name: wiki-lint
description: Use when asked to review wiki consistency, contradictions, unsupported quotes, or stale claims and apply safe maintenance fixes. For a structural report only use wiki-health; for freshness reporting only use wiki-stale.
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [evidence](../wiki-maintainer/references/evidence.md), [efficacy](../wiki-maintainer/references/efficacy.md), [maintenance](../wiki-maintainer/references/maintenance.md), [operations](../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

1. Run `/wiki-health` first: `node "<absolute-plugin-root>/scripts/health.mjs"`. Stop for an empty
   wiki. A clean graph does not skip semantic review: sample changed or high-use
   pages for stale claims, contradictory evidence and missing useful connections.
   Keep the sample bounded and report its size. Open an operation only before
   making edits:
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op lint` — records what was already
   uncommitted, so step 6 commits your fixes and not the user's in-progress work.
2. Run `node "<absolute-plugin-root>/scripts/drift.mjs" --coverage`, then a bounded embedding check:
   `node "<absolute-plugin-root>/scripts/drift.mjs" --limit=10`. Read eligible/evaluated/failed/skipped
   counts. Zero evaluated is not a clean result; report missing evidence or backend
   failures. Similarity is a topical diagnostic, never proof of claim correctness.
3. Run the content lint: `node "<absolute-plugin-root>/scripts/lint.mjs"` (warn-only,
   never scored). It flags (a) quotes that cannot be verified against the page's
   raw/ evidence trail — adjudicate each: real drift gets fixed against the
   clipping (guardrail #5), quoting-convention artifacts get ignored, and claims
   the vault genuinely doesn't hold get marked unsourced on the page; (b) style
   flags per the v0.2.2 licenses — pointers for review, not violations.
4. Read the flagged pages (orphans, hub-stubs, drifted). Look for: contradictions
   between pages, claims superseded by newer sources, concepts referenced but
   unwritten, and missing cross-references.
5. Apply only safe, unambiguous fixes; present the rest as a proposed change list
   for the user to approve when not already authorized. Set `updated` on edited
   pages; stamp `reviewed` only where claims were actually verified against their
   evidence or current project behavior. Mechanical links, aliases and formatting
   preserve prior `reviewed` dates. Record what was checked and what remains
   uncertain. If no edits are applied, return the report without a log or operation.
   For applied fixes, validate links and refresh affected catalogs; write the log entry:
   `node "<absolute-plugin-root>/scripts/log-entry.mjs" --op lint --title "<summary>"` (details on stdin).
6. Close the operation:
   `node "<absolute-plugin-root>/scripts/op-commit.mjs" --op lint --title "<summary>" --since <saved-token>`
   A lint that applied fixes and did not commit them leaves the vault changed with
   no record — the failure `/wiki-purge` was built to end. The helper does not push; complete already-authorized sync through the shared contract.
