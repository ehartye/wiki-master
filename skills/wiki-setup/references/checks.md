# Report health, freshness and content findings

Resolve the known vault and absolute helpers through
[access](../../wiki-maintainer/references/access.md). Read-only reports write no
log, disposition, catalog or cache. Follow
[evidence](../../wiki-maintainer/references/evidence.md) when reviewing claims;
structural checks cannot establish truth. For a vault other than the default, name it on
every command below, as in [name the vault](initialization.md#name-the-vault).

## Health and ingest backlog

1. Run `node "<absolute-plugin-root>/scripts/health.mjs"`. Use `--json` for versioned
   issues with stable IDs, exact locations, evidence and verification conditions. It reads
   the [graph cache](validation.md) the refresh leaves; that page says when to add `--no-cache`.
2. Report uncapped open integrity defects with scanned-page coverage. Intentional
   forward links, orphan/dead-end opportunities and stubs do not increase that
   count. Required citations remain required on stubs. Age, unresolved navigation
   and fuzzy suggestions do not establish an accidental break. Empty coverage
   cannot justify a healthy-wiki verdict.
3. Use `health.mjs --backlog` for ingestion counts; this does not process captures.
   The canonical [hash-join contract](../../wiki-maintainer/references/maintenance.md#has-this-been-ingested--a-content-hash-join-not-a-guess)
   determines eligibility. Do not invent a filename/title join.

| Metric | Interpretation and next action |
|---|---|
| `unparsedSources` | No wiki page cites the clipping; distinct from summarized state. |
| `unsummarizedSources` | No source summary records its hash: the ingestion backlog. |
| `missingHash` | Markdown clipping lacks `source-hash`; a capture/data defect. |
| `backfillPending` | Legacy summary lacks hashes; transitional link credit is active, migration has not run. |
| `provenanceGaps` | Source page cites no raw file; structural defect, not proof that the claim is false. |

Only Markdown clippings are ingestable units; PDF/spreadsheet/ZIP originals are
not summary targets. Report `unsummarizedSources` when asked how much remains.
For authorized repairs use [maintenance recipes](../../wiki-maintainer/references/maintenance.md)
or [repair](../../wiki-maintainer/references/repair.md), and find a repair or backfill script
by name in the [script index](../../../docs/scripts.md); for requested ingestion use
[wiki-researcher](../../wiki-researcher/SKILL.md).

The old capped score and topology counts are available only through `--legacy`
for historical comparison. They are not repair targets. Compare resolved,
remaining and new issue IDs after an authorized repair. Zero defects does not
prove factual accuracy. [Integrity contracts](../../../docs/wiki-integrity.md)
describe structural coverage and unchecked areas.

The `monolith candidates` line flags authored pages over roughly 3,000 words with
several stacked dated-update callouts; it is a review signal, not permission to
rewrite. Follow [project authoring](../../wiki-project/references/authoring.md)
when a living-document repair is authorized.

## Freshness and drift coverage

1. Run `node "<absolute-plugin-root>/scripts/stale.mjs"`. Read the backend diagnostic:
   failed, invalid or empty CLI discovery falls back to scoped `wiki/` files.
   Missing root/wiki is failure, not an empty report.
2. Run `node "<absolute-plugin-root>/scripts/drift.mjs" --coverage`. This reads
   evaluation coverage; it does not run embeddings. Do not run cache-producing
   embedding evaluation for a strict read-only request.
3. Separate stale pages, missing factual-review dates, evaluated coverage and
   failures. Prioritize use and volatility. `reviewed` means factual verification;
   `updated` means edited; refreshed embeddings do not make claims reviewed.
4. A request about whether recommendations still hold needs actual claim and
   evidence inspection through [cited answers](../../wiki-search/references/answers.md).
   Report which claims were checked and which remain unverified. A sample is not
   a whole-wiki verdict; zero evaluated is not “no drift.”

## Content lint report

Run `node "<absolute-plugin-root>/scripts/lint.mjs"` for warn-only findings,
`--json` for the full list. Scope to requested work using `--page=<substr>`,
`--updated-since=<YYYY-MM-DD>` or `--paths-file=<ledger>`; date and ledger may be
combined. The graph is still whole-vault; scope saves quote checks, not graph scan.
Use `--tier=convention|extraction-noted|gapped|unverified|all`, `--full` for
untruncated quotations and an `evidence:` line per quote fragment, `--ids` for
finding identities and `--include-reviewed` for prior dispositions. These
reporting options do not record new verdicts.

- **convention:** same words and order, markup/punctuation/extraction spacing
  differs. Counted rather than listed; inspect unusual jumps instead of assuming
  a new factual problem.
- **gapped:** every quoted word occurs in evidence order, with additional evidence
  words between. Inspect inserted runs: timestamps/headers/citations may be
  extraction noise; omitted clauses or joined sentences may need correction.
- **unverified:** changed, added, reordered or negated words, dropped operators,
  or missing evidence text. `--near` shows diffs for quotations of six or more
  words aligning with raw at 0.85 or better: `[-word-]` is page-only, `{+word+}` is
  clipping-only. A typo correction may be benign; a changed meaning is not. A
  low match is no proof of error. Two-column interleaving can also trigger this.
- **extraction-noted:** would be unverified, but every word is in order in one
  raw clipping marked `layout-risk: columns` (the PDF clipper's mark for
  interleaved columns), with the other column's words skipped. Listed in
  `--json`, with `--tier=extraction-noted` and with `--tier=all`, not listed by
  default. Read the skipped words: the other column's text is expected, an
  omitted clause is not. A dropped negation never lands here.

In `--json`, each listed quote finding has an `evidence` array, one entry per
quote fragment: `document` (`null` when no evidence document holds even a near
window), `kind`, `match` (`convention`, `gapped`, `extraction-noted`, or `near`
for an unverified fragment's best window, with `score` and `diff`) and `lines`,
the file's first and last line, counted from 1 with frontmatter included. Read
the evidence at those lines before judging the finding. When a line-by-line
reading of the document gives other words than the whole text (a tag or link
spanning a line), `lines` is absent and `linesUnavailable` is true: open the
document and search for the words. A near window shows where to look, not that
the quote is wrong.

Read a bounded sample and the exact evidence trail before judging quotations.
Check ambiguous/misrouted citations first. Distinguish own wording, mention/title
quotes, retracted claims, real drift and unsupported claims. Style flags are
review pointers, not scored violations; each has an id (`--ids`) and a reviewed one is
recorded like a quote and left out of the listing. The
[content-lint contract](../../../README.md#content-lint) describes mark pairing
(curly marks nest; straight marks pair by where they sit, and alternate only
where their place is ambiguous), the marks that are not quotation syntax (a
measurement such as `7'6"`, a mark inside a code span or fenced code), how a
bracket glued to a word (`[E]ach`) is compared, and skipped style spans.

Report evaluated findings and remaining uncertainty. A reporting request never
runs `lint-disposition.mjs record` or edits dates/content. Authorized factual
corrections and persisted dispositions use [maintainer lint](../../wiki-maintainer/references/lint.md).
Keep clipping fidelity distinct from source credibility and apply evidence restrictions.

## Identity and relationship checks

For suspected naming ambiguity run
`node "<absolute-plugin-root>/scripts/identity-audit.mjs" --json`. Apply the shared
[identity policy](../../wiki-maintainer/references/efficacy.md); a warning is a
review queue, not permission to merge/rename. Candidate relationships use
`node "<absolute-plugin-root>/scripts/relationships.mjs" --limit=10 --json`.
Read both pages and their evidence; shared sources or semantic neighbors prove
neither equivalence nor causality. Adding links belongs to authorized maintainer work.

## Bounded maintenance evaluation

During requested substantive maintenance, start with health and stop for an empty
wiki. A clean graph still needs bounded review of changed/high-use pages. Run
drift `--coverage` first, then `drift.mjs --limit=10` only when the maintenance
scope permits its machine-local embedding cache and state file. A run takes eligible pages
never evaluated on this machine first, then pages whose own text changed since their
evaluation, then the oldest evaluated, ties by path; an edit to a page's evidence alone is
not a change. `drift.mjs --paths-file <ledger>` limits the pool to the named pages (a named
page that is not eligible is skipped as `not-eligible`), and `--limit` then applies within
them. The `drift: selection:` report line and the `--json` fields `selection` (the rule,
the counts and each picked page with its reason) and `everEvaluated` show what was chosen.
Only an embedding run records its evaluated pages, in `.wiki-master/drift-state.json`;
the file is machine-local and safe to delete, and one whose `root` is another vault path
is ignored. Report eligible, evaluated,
skipped and failed counts, document/chunk sampling and backend failures. Cosine
drift measures topical change, never truth or contradiction. A page evaluated
through sampled chunks has not received an exhaustive factual review.

Edit tracked content only with authorization.
Do not run full lint on an unchanged wiki; use scoped checks and inspect actual
claims rather than optimizing a graph score. Validate changed paths through
[scoped validation](validation.md), then log once and run `refresh-index.mjs`.

## Verification cadence

- Each ingest or substantive edit checks identity and citation paths, updates
  affected task maps and ends with `refresh-index.mjs`; factual dates follow evidence.
- Each requested maintenance pass combines structural defects with bounded
  changed/high-use claim review, reporting evaluated/skipped/failed coverage.
- While actively growing, a weekly review of up to ten relationship candidates,
  high-demand stubs and discovery gaps is useful guidance, not an installed schedule.
- After search/schema changes, and periodically as vocabulary changes, run the
  retrieval regression set, inspect development failures, then measure held-out
  queries without tuning to them. Report categories, not one misleading score.

See [efficacy command contracts](../../../docs/wiki-efficacy.md) for evaluation
interfaces. Setup owns these checks; repairs and source-writing remain with their
task owners.

## Purge broken-link verification

Before any authorized purge mutation, retain
`node "<absolute-plugin-root>/scripts/health.mjs" --legacy` and its **broken links**
count. Run the same check after applying the purge and repairing collateral; the
count must not grow. Report before/after values and actual coverage.

Neither a better legacy score nor the default integrity defect count substitutes
for this comparison. The score can improve when removed pages stop contributing
orphan penalties, while dangling navigation to deleted targets remains unscored.
Inspect collateral pages directly. When native access is already available,
`node "<absolute-plugin-root>/scripts/obsidian.mjs" unresolved verbose format=json`
also attributes unresolved links to their source pages; app access is not required
for the filesystem check.

This diagnostic procedure never applies, restores or reconciles a purge. Those
changes and their approval belong to the [purge workflow](../../wiki-purge/references/purge.md).
