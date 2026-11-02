# Five-skill consolidation evidence

The candidate implements five visible roles without forwarding aliases. Source
revision: `5e1bb6d106391af7e033a3418332aeed56eaa3c3`. Companion revisions:
hartye-skills `19cf9e0ada39bd9d5f8e45f6b68e62eab04be9c1`, agent-game-studio
`78d1d3cbf87dd63d9543f8816b56d94b0a51af5c`. All are feature branches in sibling
worktrees. No merge, release, marketplace update or global installation occurred.

WP1–WP4 independently pass. WP5's reviewed wiki documentation was validated and
published in scoped vault commit `8694e97`; [publication receipts](wp5-publication.json)
record exact membership, closed operation, preserved global index and verified remote.
The final [WP5 review](wp5-review.md) records independent publication verification. Source readiness must not
be confused with a published product release.

| Gate | Evidence and result |
|---|---|
| Source baselines | [Baselines](baselines.md); original structural 22/22 and skill 43/43 tests |
| User role and shared policy | [WP1 review](wp1-review.md), PASS |
| Research, maintenance, setup, purge | [WP2 review](wp2-review.md), PASS |
| Contracts, current docs, callers | [WP3 review](wp3-review.md), PASS; [commands](commands.json) and [exact results](wp3-command-results.json) |
| Mandatory candidate execution | [WP4 review](wp4-review.md), PASS, with explicit nonblocking observations and integration limits |
| Routing | [29-case grades](wp4-routing-grades.json); actual candidate-loaded selection/reference probes, not full workflow execution |
| Search | [Per-case grades](wp4-search-grades.json); baseline/candidate healthy and lexical sessions, independently equal before/after snapshots |
| Ingestion | [Eight final grades](wp4-ingestion-grades.json); named, repeat, mixed backlog and empty backlog in both conditions |
| Research | [Per-case grades](wp4-research-grades.json), [execution report](research/results.md); named capture, corrected full flow and bounded live discovery |
| Companion migration | [Disposition inventory](caller-migration.json), [bounded scan](caller-inventory-before.json), [checks](caller-checks.json); nine maintained references migrated |
| Main-repository migration | [156 baseline occurrences](main-caller-inventory.json); [workflow mapping](../../docs/skill-migration.md) covers all 21 former entries |

Required regression commands passed 45 skill tests, 64 contract/triage/authoring
tests, 179 search/capture/provenance tests and 106 format/service tests, with zero
skips. Studio's required checks passed 123 tests. After focused discovery and
retrieval-handoff corrections, seven structural contracts and all 45 skill tests
were rerun successfully. Runtime helpers were not changed to implement the new
skill layout; script changes only migrate prose references.

Each execution directory retains scenario input, source revision, host/model,
actual command/exit, activation inventory, loaded references, transcript and
artifact observations. The host is Claude Code 2.1.316 with session-only
`--plugin-dir`, restricted setting sources and strict MCP configuration. Every
candidate session exposes only the five intended wiki-master skills. Tests use
isolated generic vaults and local bare Git remotes. Public paths are sanitized;
private originals remain in evaluation scratch. Full live third-party bodies
are retained there for inspection, not copied into this public evidence set.

Earlier completed failures remain failures: initial candidate discovery skipped
independent selection; its next run skipped actual retrieval. The focused
[source corrections](wp4-discovery-correction-review.md) were independently
reviewed before successful reruns. Initial ingestion temp-isolation failures,
literal `/tmp` escapes, host launcher failure and interrupted attempts are also
retained. Baseline full-flow failures are legitimate comparison evidence, not
hidden or repeatedly rerun until favorable. Only final corrected candidate
execution supports the corresponding acceptance claims.

Observed ordinary-search instruction files total 5,232 source bytes versus
20,236 baseline. This measures actual files loaded, not total host context or
token savings. Search actors still have documented snippet-policy and wording
observations; perfect instruction compliance is not claimed.

Live discovery made five observable web searches and captured official RFC 9110
and RFC 9111. Both captures carry partial-fidelity warnings, which were disclosed
and queued for triage. Capture-only created no derived pages. The format suites
are deterministic parser/content/fixture checks; they do not establish live
converter or authenticated-service execution. [Prerequisite checks](integration-prerequisites.json)
record missing LibreOffice and confluencer, so those live paths are not verified.
No production wiki research or authenticated Confluence success is claimed.

Historical evaluation transcripts, dated plans/specifications and release history
remain unchanged. Later delivery must coordinate the migrated companions; this
inventory makes no compatibility claim for unknown third-party callers.
