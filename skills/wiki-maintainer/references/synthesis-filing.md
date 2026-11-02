# File an explicitly authorized synthesis

This is the writing handoff from a read-only answer. Filing requires explicit
authorization; a search question, a useful answer or a missing page is not enough.
Original project documentation belongs to [wiki-project](../../wiki-project/SKILL.md).

Read [access](access.md), [evidence](evidence.md), [identity](efficacy.md) and
[operation completion](operations.md) directly before mutation. Use the existing
**query** operation semantics for derived answer filing.

1. Confirm the authorized topic and destination. Reuse the current retrieved
   passages only after checking their exact paths and supporting raw text. If
   needed, run [search](../../wiki-search/SKILL.md) and
   [provenance retrieval](../../wiki-search/references/advanced.md). Do not silently
   discover or capture external sources.
2. Search existing synthesis/concept titles and equivalent aliases. Extend the
   canonical page if appropriate; otherwise create a scoped synthesis under
   `wiki/syntheses/`. File only substantive knowledge, not a duplicate answer.
3. Before the first edit, open `op-begin.mjs --op query`, save its token and record
   exact owned paths. Write valid schema with `type: synthesis`, supporting
   `sources`, honest `ai-generated`, dates and page status. Preserve immutable raw
   bodies, restrictions, opposing viewpoints and Reddit/Medium section boundaries.
   Label cross-source inferences as synthesis; do not promote unsupported claims.
4. Verify each claim/citation and follow direct
   [scoped validation](../../wiki-setup/references/validation.md). Refresh the
   affected owned catalog through the operations contract, preserving foreign
   index edits; record generated paths and validate them as applicable.
5. Write one query log, close with the exact ledger, sync and verify remote
   publication unless held. Use [operation recovery](../../wiki-setup/references/operation-recovery.md)
   for failed or uncertain completion instead of repeating writes.

**Example:** “File that comparison as a synthesis.” Open the cited source passages,
check the canonical destination, write the comparison with provenance and labeled
inferences, and publish its owned query operation. Return its path and verified
publication state. Without that filing request, return only the read-only answer.

**Done:** the requested synthesis and citations are validated, its query log and
scoped commit are recorded, and remote publication is verified or its exact hold,
local-only state or blocker is stated.
