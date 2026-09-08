---
name: wiki-stale
description: Use when asked what wiki knowledge needs factual review or whether guidance is current. Read-only freshness reporting; a recent edit is not verification, and applying factual fixes belongs to wiki-lint.
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [efficacy](../wiki-maintainer/references/efficacy.md), [evidence](../wiki-maintainer/references/evidence.md).
This entry point is read-only; do not open an operation, write a log, or refresh the index.

Report which wiki pages are going stale.

Steps:
1. Run `node "<absolute-plugin-root>/scripts/stale.mjs"`. Read its backend diagnostic:
   a failed, invalid or empty CLI query falls back to scoped `wiki/` files at the
   resolved vault root. Missing root/wiki is an explicit failure, not an empty report.
2. Run `node "<absolute-plugin-root>/scripts/drift.mjs" --coverage`. This is read-only
   coverage, not an embedding evaluation. Do not claim unevaluated pages are clean.
   Bounded embedding maintenance belongs to wiki-lint; its drift run may write a
   machine-local embedding cache, so do not run it for a strict read-only report.
3. Report stale and missing-review pages separately, plus drift evaluation
   coverage and failures. `reviewed` measures factual verification; `updated`
   measures edits and never makes old claims fresh. Prioritize review by use and
   volatility. Re-review claims against evidence before stamping `reviewed`;
   refreshing embeddings or adding links does not qualify.
4. If asked whether recommendations are current, inspect the actual claims and
   their supporting evidence for the requested topic, prioritizing high-use or
   volatile guidance. Use wiki-query's read-only search and evidence workflow;
   metadata alone answers what needs review, not whether a claim still holds.
   Report which claims were checked, what the evidence supports and what remains
   unverified. A bounded sample cannot establish currency for the whole wiki.
