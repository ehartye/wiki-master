# Wiki integrity and repair

`node scripts/health.mjs` reports **open integrity defects**, with a target of zero.
`--json` supplies the complete version-1 worklist. `--backlog` retains ingest
reporting; `--legacy` retains the historical capped score and topology diagnostics.
These modes are mutually exclusive. A successful scan exits zero even with defects;
invalid arguments or scan errors exit nonzero. Automation reads `defectCount` and
`status` rather than treating successful execution as a clean verdict.

## Measurement contract

The uncapped `defectCount` equals `issues.length`. Each issue has a stable ID derived
from rule/source/target, source path, first line and all occurrence lines, evidence,
and a verification condition. Identical occurrences in one page count once. IDs
survive line shifts, but changing the rule, source path or target changes the ID.
Compare resolved and new IDs as well as totals; a retargeted broken link is not a fix.

| Rule | Demonstrable contract violation |
|---|---|
| `unresolved-citation` | A wikilink in `sources:` or an explicit factual-body link into `raw/` or `wiki/sources/` has no target. Links in Related/Relationships sections are navigation. |
| `ambiguous-link` | The selected navigation/evidence identity has multiple candidates; qualify the intended path. |
| `malformed-link` | An actual wikilink is unclosed, empty, or crosses a line break. |
| `missing-evidence` | A substantive derived page lacks its evidence route. Source summaries need a direct raw citation; other derived pages need a route within three evidence hops. |

Actual citation defects apply even to stubs. Missing-evidence checks exempt declared
stubs, pages under the existing ten-word stub floor, MOCs, and original authored
pages explicitly declaring `sources: []`. A substantive concept or source cannot
exempt itself by declaring an empty source list. This tightens the legacy rule that
exempted empty source lists everywhere. Same-page citation defects suppress a
duplicate missing-evidence finding; repair may reveal another missing-evidence issue
when the underlying problem remains. Counts are obligations, not estimates of editing effort.

Unresolved navigation is listed in `forwardLinks`, outside the defect count.
Missing targets, old dates, low demand and fuzzy similarity never establish damage.
The scanner cannot infer intent, so unexplained missing navigation stays unscored too.
No Git-history baseline is maintained in this version; historical rename/deletion
detection is explicitly outside coverage. Qualified evidence paths express citation
intent and are therefore checked more strictly than navigation.

The scanner excludes templates, raw bodies, logs, system/dot files, code examples,
comments and embeds. It understands wikilinks and table-escaped aliases. It reports
heading/block validation, Markdown-style links, external URLs and factual correctness
as unchecked. The existing graph remains the legacy/navigation helper contract; the
integrity scanner reads current content with its stricter syntax and ambiguity rules.

## Agent workflow

Invoke `wiki-repair` to resolve the worklist or selected issue IDs. The skill owns
investigation, scoped edits, batch verification and the shared vault operation
lifecycle. `wiki-health` remains read-only; `wiki-relink` curates relationships and
task maps; `wiki-lint` reviews factual content. A named custom agent is not required.

One writer owns each operation. Preserve raw evidence and intentional forward links.
Do not clear findings by fabricating support, deleting useful citations, adding empty
pages or weakening status. Report blockers by ID and stop when further progress
requires evidence or judgment outside scope. Final reports include resolved, remaining
and new IDs, coverage and commit/sync status. Zero defects establishes only the
listed structural checks; an empty scan is explicitly `status: empty`.
