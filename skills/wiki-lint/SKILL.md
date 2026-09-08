---
name: wiki-lint
description: Periodic deep maintenance pass — structural health, contradictions, stale claims, missing concepts/links, and semantic drift.
---

> **Host portability (Claude Code, Copilot CLI, Codex):** Resolve bundled
> `scripts/` and `templates/` paths from this skill's installed directory:
> `../../` is the plugin root. Use quoted absolute paths when running helpers;
> do not resolve them from the current workspace or depend on plugin-root shell
> variables. For sibling skills, read `../<skill-name>/SKILL.md` if the host has
> no skill-loading tool. References such as `/wiki-health` mean that skill's
> workflow; in Codex, select the skill or ask for it by name. Treat `$ARGUMENTS`
> as the user's request when the host does not substitute it.

Load the `wiki-maintainer` skill and follow its **Lint** workflow.

1. Run `/wiki-health` first: `node ../../scripts/health.mjs`. Stop for an empty
   wiki. A clean graph does not skip semantic review: sample changed or high-use
   pages for stale claims, contradictory evidence and missing useful connections.
   Keep the sample bounded and report its size. Open an operation only before
   making edits:
   `TOKEN=$(node ../../scripts/op-begin.mjs --op lint)` — records what was already
   uncommitted, so step 6 commits your fixes and not the user's in-progress work.
2. Run `node ../../scripts/drift.mjs --coverage`, then a bounded embedding check:
   `node ../../scripts/drift.mjs --limit=10`. Read eligible/evaluated/failed/skipped
   counts. Zero evaluated is not a clean result; report missing evidence or backend
   failures. Similarity is a topical diagnostic, never proof of claim correctness.
3. Run the content lint: `node ../../scripts/lint.mjs` (warn-only,
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
   uncertain. Write the log entry:
   `node ../../scripts/log-entry.mjs --op lint --title "<summary>"` (details on stdin).
6. Close the operation:
   `node ../../scripts/op-commit.mjs --op lint --title "<summary>" --since $TOKEN`
   A lint that applied fixes and did not commit them leaves the vault changed with
   no record — the failure `/wiki-purge` was built to end. It does not push.
