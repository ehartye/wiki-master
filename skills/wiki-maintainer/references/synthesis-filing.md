# File an explicitly authorized synthesis

This is the writing handoff from a read-only answer. Filing requires explicit
authorization; a search question, a useful answer or a missing page is not enough.
Original project documentation belongs to [wiki-project](../../wiki-project/SKILL.md).

Read [access](access.md), [evidence](evidence.md), [identity](efficacy.md) and
[completion](operations.md) directly before writing. A filed answer logs with
`--op query`.

1. Confirm the authorized topic and destination. Reuse the current retrieved
   passages only after checking their exact paths and supporting raw text. If
   needed, run [search](../../wiki-search/SKILL.md) and
   [provenance retrieval](../../wiki-search/references/advanced.md). Do not silently
   discover or capture external sources.
2. Search existing synthesis/concept titles and equivalent aliases. Extend the
   canonical page if appropriate; otherwise create a scoped synthesis under
   `wiki/syntheses/`. File only substantive knowledge, not a duplicate answer.
3. Write valid schema with `type: synthesis`, supporting
   `sources`, honest `ai-generated`, dates and page status. Preserve immutable raw
   bodies, restrictions, opposing viewpoints and Reddit/Medium section boundaries.
   Label cross-source inferences as synthesis; do not promote unsupported claims.
4. Verify each claim and citation, then follow [completion](operations.md). Use
   [recovery](../../wiki-setup/references/operation-recovery.md) for failed or uncertain
   completion instead of repeating writes.

**Example:** “File that comparison as a synthesis.” Open the cited source passages,
check the canonical destination, write the comparison with provenance and labeled
inferences, and finish with its query log and the refresh. Return its path and say
that Obsidian Git publishes it. Without that filing request, return only the read-only answer.

**Done:** the requested synthesis and citations are validated, its query log is
written, and the refresh ran or the task is reported as written but not refreshed.
