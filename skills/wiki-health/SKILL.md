---
name: wiki-health
description: Use when asked to check wiki structure, find broken links or orphans, or report the health score and ingest backlog. Read-only structural reporting; factual review belongs to wiki-lint and repairs to wiki-relink.
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [maintenance](../wiki-maintainer/references/maintenance.md).
This entry point is read-only; do not open an operation, write a log, or refresh the index.

Run the deterministic health check and report the result to the user.

Steps:
1. Run `node "<absolute-plugin-root>/scripts/health.mjs"` using the absolute installed path.
2. Present the score and each category. If broken links or orphans exist, offer to
   run `/wiki-relink` to fix them. Do not modify any files in this skill.
