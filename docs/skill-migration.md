# Five-role skill migration

The candidate replaces 21 visible entry points with five. Retired names have no
forwarding aliases. Update callers before deploying the removal. This document
describes source compatibility, not an already published release.

Select the role and state the task in ordinary language. A mode is a workflow
inside the skill, not a new CLI flag. Helpers keep their existing names, flags,
formats and runtime behavior.

| Former entry point | Current role and mode | Procedure |
|---|---|---|
| `wiki-search` | `wiki-user`: find pages/passages | [Search](../skills/wiki-user/references/search.md) |
| `wiki-query` | `wiki-user`: answer with citations | [Query](../skills/wiki-user/references/query.md) |
| `wiki-author` | `wiki-user`: author or validate original project documentation | [Authoring](../skills/wiki-user/references/authoring.md) |
| `wiki-discover` | `wiki-researcher`: topic discovery or named-source capture | [Discovery](../skills/wiki-researcher/references/discover.md), [capture](../skills/wiki-researcher/references/capture.md) |
| `wiki-ingest` | `wiki-researcher`: named-clipping or new-clipping ingestion | [Ingestion](../skills/wiki-researcher/references/ingest.md) |
| `clip-pdf` | `wiki-researcher`: PDF capture | [PDF](../skills/wiki-researcher/references/clip-pdf.md) |
| `clip-docx` | `wiki-researcher`: Word capture | [Word](../skills/wiki-researcher/references/clip-docx.md) |
| `clip-pptx` | `wiki-researcher`: PowerPoint capture | [PowerPoint](../skills/wiki-researcher/references/clip-pptx.md) |
| `clip-xlsx` | `wiki-researcher`: spreadsheet capture | [Spreadsheet](../skills/wiki-researcher/references/clip-xlsx.md) |
| `clip-gh` | `wiki-researcher`: GitHub repository capture | [GitHub](../skills/wiki-researcher/references/clip-gh.md) |
| `clip-confluence` | `wiki-researcher`: authenticated Confluence capture | [Confluence](../skills/wiki-researcher/references/clip-confluence.md) |
| `wiki-health` | `wiki-maintainer`: health and count-only backlog | [Health](../skills/wiki-maintainer/references/health.md) |
| `wiki-stale` | `wiki-maintainer`: freshness reporting | [Freshness](../skills/wiki-maintainer/references/stale.md) |
| `wiki-lint` | `wiki-maintainer`: factual review | [Lint](../skills/wiki-maintainer/references/lint.md) |
| `wiki-repair` | `wiki-maintainer`: integrity repair | [Repair](../skills/wiki-maintainer/references/repair.md) |
| `wiki-relink` | `wiki-maintainer`: relationships and task maps | [Relinking](../skills/wiki-maintainer/references/relink.md) |
| `wiki-triage` | `wiki-maintainer`: human-attention queue | [Triage](../skills/wiki-maintainer/references/triage.md) |
| `obsidian-cli` | `wiki-user`: requested app action; maintainer owns shared mechanics | [Guarded app commands](../skills/wiki-maintainer/references/obsidian-cli.md) |
| `wiki-maintainer` | `wiki-maintainer`: maintenance router; applicable roles load shared policy directly | [Access](../skills/wiki-maintainer/references/access.md), [evidence](../skills/wiki-maintainer/references/evidence.md), [completion](../skills/wiki-maintainer/references/operations.md) |
| `wiki-init` | `wiki-init`: new vault setup | [Setup](../skills/wiki-init/references/setup.md) |
| `wiki-purge` | `wiki-purge`: removal, reconciliation and restoration | [Purge](../skills/wiki-purge/references/purge.md) |

Search, unfiled answers and reports remain read-only. Filing an answer needs
authorization. Named capture skips broad discovery and capture-only creates no
derived pages. Ingestion without a filename requires an explicit request to
process new clippings, computes the real source-hash backlog, excludes restricted
evidence and does nothing when no eligible work remains. A bare researcher
invocation must not silently choose global ingestion. Purge still requires its
reviewed plan and separate publication approval.

Shared evidence, access and operation policy is single-owned under maintainer
references. Other roles load those references directly when needed, not the
maintainer entry point as a universal preamble. Authoring policy now lives under
the user role. Keep the whole plugin directory together so references and
absolute helper resolution work across hosts.

Known maintained companion migrations cover hartye-skills `spec-plan` and
`q-master`, and agent-game-studio's plugin map. The bounded caller inventory and
validation evidence are in `eval/skill-consolidation/`; source revisions and gate
results belong in its delivery report. The coordinated release pairs wiki-master 0.88.0 with hartye-skills 0.9.2 and
agent-game-studio 0.3.2. Update these companions together. Installed caches require
a host update; compatibility with unknown external callers is not claimed.

Historical transcripts, evaluation snapshots, dated plans/specifications under
`docs/superpowers/`, and release history retain the names they actually used.
They are evidence, not current invocation instructions.
