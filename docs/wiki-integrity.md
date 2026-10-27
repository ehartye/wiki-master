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
| `malformed-frontmatter` | A page opens with a frontmatter fence but its metadata is not read: the fence line carries a stray carriage return (`---\r\r\n`) or is never closed, or the block holds a carriage return that is not half of a CRLF. Carriage returns in the body are not this rule. It replaces the `missing-evidence` the unread `sources:` would otherwise cause. |
| `missing-evidence` | A substantive derived page lacks its evidence route. Source summaries need a direct raw citation; other derived pages need a route within three evidence hops. |
| `cites-retired-page` | A page cites a page marked `citation-status: retired`, through `sources:` or an explicit factual-body link into `raw/` or `wiki/sources/`. The issue names the citing page, the link and `retiredPath`. A retired page citing another, a plain navigation link and an entry on a map page are not reported. |

**Retired pages.** `citation-status: retired` is how a note says it is a lead and must not be cited as support. A retired page is not provenance-eligible (no `missing-evidence`), no evidence route runs through it, and `coverage.retired` counts it (the report adds `N retired.` to its second line only when N is above zero). It is a different state from `citation-status: restricted`, which re-clip quarantine writes on a page that leans on a quarantined clipping: that page is working documentation and stays under the evidence check. Marking a note retired is the owner's call; the tool changes nothing until a page carries the marker.

**Stray carriage returns (unscored).** A carriage return anywhere in a content page that is not half of a CRLF (a doubled `\r\r\n`, or one left by a tool that wrote `\r \r`) is listed in `strayCarriageReturns` (page and first line) and in one report line, `Stray carriage returns: N page(s)`, printed only when N is above zero. It is not a defect and does not move the count or the status: the page stays readable, and damage to the frontmatter is the named `malformed-frontmatter` rule above. An all-CRLF page, and anything under `raw/` or `log/`, is never listed. Normalise a listed page with a checked repair (the line sequence must be unchanged), as the `wiki-repair` skill does for frontmatter.

**Backlog items outside the status vocabulary (unscored).** A page under `wiki/authored/` with `kind: backlog-item` whose `backlog-status` is missing or is not one of `in-progress`, `planned`, `blocked`, `shipped`, `dropped` is listed in `unrecognizedBacklogStatus` (page and status, `null` when absent) and in one report line, `Backlog items with a missing or unrecognized status: N`, printed only when N is above zero. The project's generated roadmap already lists such an item under "Unrecognized status"; this makes a whole-vault check say so too. It is not a defect and does not move the count or the status. Set the status to a value in the vocabulary (`done` is `shipped`, `proposed` is `planned`).

**Scoped scans.** `scanIntegrity(vaultPath, { sources })` takes a Set of vault-relative paths and reports only those pages' issues, forward links, stray returns and unrecognized statuses. It still reads the whole vault, because a link is ambiguous only against every page. With `sources` the result also has `pages`: the named paths that are scanned content pages, so a caller can see a path the scan never read. Without it the result is the whole-vault one. `validate-authored.mjs` uses it for its ledger.

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

## Scoped validation

`node scripts/validate-authored.mjs --paths-file <ledger>` checks only the pages in an
operation's ledger, the JSON array of paths `op-commit` takes. It prints
`path:line rule message` per defect, exits 0 when clean, 1 on any defect and 2 for
unusable input, and writes nothing (`--json` prints `version`, `checked`, `skipped` and
`defects`). It applies this scan's link rules plus authoring rules `health.mjs` does not
know: frontmatter keys, `kind` and `project` against the folder, and the `kind`,
`decision-status` and `backlog-status` vocabularies. An unresolved wikilink on a ledger page is an error there, although health
keeps it as an unscored forward link. The scan still reads the whole vault because
ambiguity is vault-wide, so "scoped" describes the report, not the cost; defects on pages
outside the ledger are never reported. An older vault may hold `backlog-status` values
such as `done`, `open` or `proposed`, a `decision-status` of `accepted-implemented`, and
page `status` values beyond `stub`, `draft` and `maintained`, so page `status` is checked
for presence only.

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
