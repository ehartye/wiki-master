# Six-skill migration

Version 0.89.0 exposes exactly six skills: wiki-search, wiki-project,
wiki-setup, wiki-maintainer, wiki-researcher and wiki-purge. It replaces the
released 0.88.0 combined user and initialization roles without forwarding aliases.
Update the plugin and its maintained callers together; existing host installations
need a separate update to load the new catalog.

## Migration from 0.88.0

| Previous route | Current owner | Direct procedure |
|---|---|---|
| wiki-user search or cited answer | wiki-search, read-only | [Simple search](../skills/wiki-search/SKILL.md#simple-search), [advanced retrieval](../skills/wiki-search/references/advanced.md), [answers](../skills/wiki-search/references/answers.md) |
| wiki-user original authoring | wiki-project | [Authoring](../skills/wiki-project/references/authoring.md), [backlog](../skills/wiki-project/references/backlog.md), [catalogs](../skills/wiki-project/references/catalogs.md) |
| wiki-user authorized derived-answer filing | wiki-maintainer | [Synthesis filing](../skills/wiki-maintainer/references/synthesis-filing.md) |
| wiki-user requested app action | wiki-maintainer | [Guarded app commands](../skills/wiki-maintainer/references/obsidian-cli.md) |
| wiki-init | wiki-setup | [Safe initialization](../skills/wiki-setup/references/initialization.md) |
| wiki-maintainer health, backlog counts, freshness or lint report | wiki-setup | [Checks](../skills/wiki-setup/references/checks.md) |
| Authoring validation-only request | wiki-setup | [Scoped validation](../skills/wiki-setup/references/validation.md) |
| Setup, prerequisite, diagnostic and recovery sections in other roles | wiki-setup | [Capture prerequisites](../skills/wiki-setup/references/capture-prerequisites.md), [search diagnosis](../skills/wiki-setup/references/search-diagnostics.md), [app access](../skills/wiki-setup/references/app-access.md), [recovery](../skills/wiki-setup/references/operation-recovery.md) |

Mutating workflows retain direct obligations to verify evidence, validate changed
paths and finish by the [completion contract](../skills/wiki-maintainer/references/operations.md). Loading a setup procedure does not authorize
repair, installation, index refresh or a new remote. Simple search has no setup
or mutation preamble.

## Earlier entry points

Select the role and state the task in ordinary language. A mode is a workflow
inside the skill, not a new CLI flag.

| Former entry point | Current role and mode | Procedure |
|---|---|---|
| `wiki-search` | `wiki-search`: find pages/passages | [Search](../skills/wiki-search/SKILL.md) |
| `wiki-query` | `wiki-search`: answer with citations; authorized filing goes to maintainer | [Answers](../skills/wiki-search/references/answers.md), [filing](../skills/wiki-maintainer/references/synthesis-filing.md) |
| `wiki-author` | `wiki-project`: original documentation; validation-only goes to setup | [Authoring](../skills/wiki-project/references/authoring.md), [validation](../skills/wiki-setup/references/validation.md) |
| `wiki-discover` | `wiki-researcher`: topic discovery or named-source capture | [Discovery](../skills/wiki-researcher/references/discover.md), [capture](../skills/wiki-researcher/references/capture.md) |
| `wiki-ingest` | `wiki-researcher`: named-clipping or new-clipping ingestion | [Ingestion](../skills/wiki-researcher/references/ingest.md) |
| `clip-pdf` | `wiki-researcher`: PDF capture | [PDF](../skills/wiki-researcher/references/clip-pdf.md) |
| `clip-docx` | `wiki-researcher`: Word capture | [Word](../skills/wiki-researcher/references/clip-docx.md) |
| `clip-pptx` | `wiki-researcher`: PowerPoint capture | [PowerPoint](../skills/wiki-researcher/references/clip-pptx.md) |
| `clip-xlsx` | `wiki-researcher`: spreadsheet capture | [Spreadsheet](../skills/wiki-researcher/references/clip-xlsx.md) |
| `clip-gh` | `wiki-researcher`: GitHub repository capture | [GitHub](../skills/wiki-researcher/references/clip-gh.md) |
| `clip-confluence` | `wiki-researcher`: authenticated Confluence capture | [Confluence](../skills/wiki-researcher/references/clip-confluence.md) |
| `wiki-health` | `wiki-setup`: health and count-only backlog | [Health](../skills/wiki-setup/references/checks.md#health-and-ingest-backlog) |
| `wiki-stale` | `wiki-setup`: freshness reporting | [Freshness](../skills/wiki-setup/references/checks.md#freshness-and-drift-coverage) |
| `wiki-lint` | `wiki-setup`: report; `wiki-maintainer`: authorized factual repair or dispositions | [Report](../skills/wiki-setup/references/checks.md#content-lint-report), [repair](../skills/wiki-maintainer/references/lint.md) |
| `wiki-repair` | `wiki-maintainer`: integrity repair | [Repair](../skills/wiki-maintainer/references/repair.md) |
| `wiki-relink` | `wiki-maintainer`: relationships and task maps | [Relinking](../skills/wiki-maintainer/references/relink.md) |
| `wiki-triage` | `wiki-maintainer`: human-attention queue | [Triage](../skills/wiki-maintainer/references/triage.md) |
| `obsidian-cli` | `wiki-maintainer`: requested app action | [Guarded app commands](../skills/wiki-maintainer/references/obsidian-cli.md) |
| `wiki-maintainer` | `wiki-maintainer`: maintenance router; applicable roles load shared policy directly | [Access](../skills/wiki-maintainer/references/access.md), [evidence](../skills/wiki-maintainer/references/evidence.md), [completion](../skills/wiki-maintainer/references/operations.md) |
| `wiki-init` | `wiki-setup`: new vault setup | [Setup](../skills/wiki-setup/references/initialization.md) |
| `wiki-purge` | `wiki-purge`: removal, reconciliation and restoration | [Purge](../skills/wiki-purge/references/purge.md) |

Search, unfiled answers and reports remain read-only. Filing an answer needs
authorization. Named capture skips broad discovery and capture-only creates no
derived pages. Ingestion without a filename requires an explicit request to
process new clippings, computes the real source-hash backlog, excludes restricted
evidence and does nothing when no eligible work remains. A bare researcher
invocation must not silently choose global ingestion. Purge still requires its
reviewed plan and one explicit approval.

Shared evidence, access and completion policy is single-owned under maintainer
references. Other roles load those references directly when needed, not the
maintainer entry point as a universal preamble. Original documentation belongs to project;
setup owns check and troubleshooting procedures; search never files its answers. Keep the whole plugin directory together so references and
absolute helper resolution work across hosts.

Known maintained companion migrations cover hartye-skills `spec-plan` and
`q-master`, agent-game-studio's plugin map, and agent-unreal's names-only
sibling-skill catalog. The bounded before/after inventory and checks belong to
`eval/skill-reorganization/`. Deliver compatible companion source changes together
with this six-skill release: hartye-skills 0.9.5, agent-game-studio 0.4.1 and
agent-unreal 0.38.2.
Installed caches remain unchanged and require a later host update. The bounded
inventory reports unavailable sources explicitly and makes no compatibility claim
for unknown third-party callers.

Historical transcripts, evaluation snapshots, dated plans/specifications under
`docs/superpowers/`, and release history retain the names they actually used.
They are evidence, not current invocation instructions.

To find citations of retired names in another plugin's checkout, run `node scripts/check-skill-citations.mjs <dir>...` from this plugin's root; it skips `docs/superpowers/` unless given `--include-history`.
