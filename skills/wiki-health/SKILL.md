---
name: wiki-health
description: Use when asked to check wiki integrity, list structural defects, or report wiki health and ingest backlog. Read-only reporting; resolving defects belongs to wiki-repair and factual review to wiki-lint.
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [maintenance](../wiki-maintainer/references/maintenance.md).
This entry point is read-only; do not open an operation, write a log, or refresh the index.

Run the deterministic health check and report the result to the user.

Steps:
1. Run `node "<absolute-plugin-root>/scripts/health.mjs"` using the absolute installed path.
2. Present `Open integrity defects` with scanned-page coverage. For issue IDs,
   locations, evidence and verification conditions, run the same helper with
   `--json`. Distinguish unscored forward links from defects; age and similarity
   do not prove an accidental break. An empty scan is not a healthy-wiki verdict.
3. Use `--backlog` for ingest reporting. The old capped score and topology counts
   are available with `--legacy` for historical comparison only; do not use them
   as a repair target. Zero integrity defects does not establish factual accuracy.
4. Route authorized repair work to [wiki-repair](../wiki-repair/SKILL.md).
   Do not modify any files in this reporting skill.
