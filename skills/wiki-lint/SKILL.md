---
name: wiki-lint
description: Periodic deep maintenance pass — structural health, contradictions, stale claims, missing concepts/links, and semantic drift.
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

Load the `wiki-maintainer` skill and follow its **Lint** workflow.

1. Run `/wiki-health` first: `node ../../scripts/health.mjs`. If the
   wiki is empty or clean, stop early — do not burn tokens. Only once you know
   there is work to do, open the operation:
   `TOKEN=$(node ../../scripts/op-begin.mjs --op lint)` — records what was already
   uncommitted, so step 6 commits your fixes and not the user's in-progress work.
2. Run drift: `node ../../scripts/drift.mjs`.
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
   for the user to approve. Stamp `reviewed` on pages you touch. Write the log entry:
   `node ../../scripts/log-entry.mjs --op lint --title "<summary>"` (details on stdin).
6. Close the operation:
   `node ../../scripts/op-commit.mjs --op lint --title "<summary>" --since $TOKEN`
   A lint that applied fixes and did not commit them leaves the vault changed with
   no record — the failure `/wiki-purge` was built to end. It does not push.
