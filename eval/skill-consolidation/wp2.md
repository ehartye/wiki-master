# WP2: research, maintenance, initialization and purge

Baseline: `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca`.
Candidate: WP1 plus WP2 working-tree changes; the coordinator records the final
revision. This note records deterministic structure and source inspection only.
Behavioral routing, live integrations and end-to-end execution remain WP4 gates.

WP1's independent review passed before WP2 began. The package author migrated
researcher/maintainer; the coordinator finished the disjoint init/purge files.
Neither author changed runtime helpers, tests, installed plugin copies or vault
content in this package. The six shared WP1 policy references were not edited by
WP2. A fresh reviewer is independently reviewing the combined package.

## Workflow map

All paths below are relative to `skills/`. Retired folders have no forwarding
entry points. The only visible skills are user, researcher, maintainer, init and
purge, each prefixed `wiki-`.

| Former entry point | Owner and procedure |
|---|---|
| wiki-search | wiki-user/references/search.md and optional search-details.md |
| wiki-query | wiki-user/references/query.md |
| wiki-author | wiki-user/references/authoring.md |
| wiki-discover | wiki-researcher/references/discover.md; named capture and capture completion in capture.md |
| wiki-ingest | wiki-researcher/references/ingest.md |
| clip-pdf | wiki-researcher/references/clip-pdf.md |
| clip-docx | wiki-researcher/references/clip-docx.md |
| clip-pptx | wiki-researcher/references/clip-pptx.md |
| clip-xlsx | wiki-researcher/references/clip-xlsx.md |
| clip-gh | wiki-researcher/references/clip-gh.md |
| clip-confluence | wiki-researcher/references/clip-confluence.md |
| wiki-health | wiki-maintainer/references/health.md |
| wiki-lint | wiki-maintainer/references/lint.md |
| wiki-stale | wiki-maintainer/references/stale.md |
| wiki-repair | wiki-maintainer/references/repair.md |
| wiki-relink | wiki-maintainer/references/relink.md |
| wiki-triage | wiki-maintainer/references/triage.md |
| obsidian-cli | wiki-maintainer/references/obsidian-cli.md, also directly linked by wiki-user |
| wiki-maintainer | Maintenance router; single-owned shared policy remains in its references |
| wiki-init | wiki-init/references/setup.md |
| wiki-purge | wiki-purge/references/purge.md |

Research modes explicitly separate topic discovery, named capture, named
ingestion and default new-clipping backlog processing. A bare ambiguous role
request does not select global ingestion. Named URLs skip broad research.
Candidate-only discovery stays read-only. Capture-only requests finish capture
publication without derived source/concept pages. Format procedures retain their
prerequisites, conversion details, source identity, dedup, decline, fidelity,
topic and failure guidance; ingestion handoffs are conditional in every route.

Ingestion computes real hash-join membership before opening a token. Named reruns
preserve an existing summary with the matching hash. Backlog processing excludes
restricted, quarantined or retired evidence and missing-hash repair cases. A zero
backlog or no eligible work stops without operations, logs, commits or refreshes.
Batch completion is once per operation; exact provenance, hashes, immutable raw
bytes, concept reuse and before/after membership remain explicit.

Maintenance routes distinguish reporting and mutation. The triage disposition
table was retained, including `downloaded`, `clipped-manually` and restricted
evidence handling. The native CLI procedure retains guarded calls, lazy liveness
checks, exact paths and uncertain-write inspection. Required detailed contracts
for content lint and re-clipping/quarantine have direct conditional links from
the maintainer entry; they remain single-owned in README/docs.

Init and purge retain their separate entry points and safeguards. Purge keeps
explicit plan and publication approval, approved seeds, blocking-source handling,
its own transaction, collateral repair, interrupted-run reconciliation, restoration
checks and retention. The coordinator also aligned its approved publication call
with shared `wiki-sync` and remote verification, guarded its native unresolved
command, generalized history-connectivity checking to the configured upstream,
and made empty-result interpretation follow current search diagnostics. These
instruction consistency corrections are included in independent review.

Private incident counts and topical examples in discovery, PDF/GitHub capture,
triage, native CLI and purge were generalized. Converter limits and algorithm
thresholds that describe actual public runtime contracts were retained.

## Deterministic checks

Executed from the implementation worktree:

- `python <skill-creator>/scripts/quick_validate.py skills/wiki-user`
- `python <skill-creator>/scripts/quick_validate.py skills/wiki-researcher`
- `python <skill-creator>/scripts/quick_validate.py skills/wiki-maintainer`
- `python <skill-creator>/scripts/quick_validate.py skills/wiki-init`
- `python <skill-creator>/scripts/quick_validate.py skills/wiki-purge`

Each validator reported `Skill is valid!`, exit 0. The local skill-creator root is
an environment-owned path, intentionally not copied into public evidence.
`git diff --check` exited 0.

An ad hoc `node --input-type=module` check (stdin) recursively enumerated Markdown
under `skills/`, resolved relative Markdown links after stripping fragments,
checked five entry files and their descriptions/fences, imported the actual
triage action arrays, compared their IDs and labels with the migrated disposition
table, and verified paths for every `scripts/*.mjs` helper named by the 17 WP2
baseline entry points through `git show <baseline>:<path>`. It exited 0 with:

```json
{
  "files": 33,
  "localLinks": 182,
  "entries": 5,
  "descriptionCharacters": {
    "wiki-init": 169,
    "wiki-maintainer": 374,
    "wiki-purge": 253,
    "wiki-researcher": 371,
    "wiki-user": 345
  },
  "triageDispositionIds": [
    "acceptable", "clipped-manually", "declined", "downloaded", "ignore",
    "ingest", "keep-declined", "quarantine", "reclip", "reconsider", "retry"
  ],
  "baselineHelperPathChecks": 58,
  "failures": []
}
```

All entry points have zero fenced blocks. Local-link checks cover file existence,
not anchor integrity or external URLs. The 58 checks count helper occurrences
once per baseline skill, not distinct runtime helpers or executions. The triage
table additionally allows the existing `skip` label, which is a UI label rather
than a new disposition ID. WP3 will retarget permanent tests and add the binding
catalog and recursive-reference contracts; these package checks do not stand in
for agent execution.

The following scan over candidate skills returned only two generic uses of
“this vault” in shared/canonical documentation, no retired skill invocation,
old core preamble or listed private incident marker:

```text
rg -n 'wiki-(search|query|author|discover|ingest|health|stale|repair|lint|relink|triage)|shared core|Phase [34]|BPD|CCSS|Salesforce|5,118|9,874|219k|1.5MB|240 MB|16 of 41|this vault|Hand off' skills
```

This bounded scan is not a comprehensive privacy audit. Historical evidence and
current non-skill callers are WP3 inventory work and were not rewritten here.

Independent review: [PASS for progression to WP3](wp2-review.md). The reviewed
skill delta was committed as `8a899af34c1eef7e367400d3a30b3d39fe8d45b1`; entry hashes
are in the review artifact. This package note makes no behavioral readiness claim.
