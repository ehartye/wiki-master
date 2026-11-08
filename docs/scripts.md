# Script index

Every script under `scripts/`, with one line on what it is for. Run them from the plugin root as
`node "<absolute-plugin-root>/scripts/<name>.mjs"`. Most print their full usage with `--help`; the
scripts that change files are dry runs until `--apply`. The skills' references say when to run each
one: [checks](../skills/wiki-setup/references/checks.md) for reports and
[maintenance](../skills/wiki-maintainer/references/maintenance.md) for repairs.

## Repair

| Script | Purpose |
|---|---|
| `dedupe-clippings.mjs` | Removes raw clippings that duplicate another clipping's content hash, keeping the copy the vault cites; a group with no clear keeper is reported, not guessed at. |
| `repair-ambiguous-links.mjs` | Repoints a bare link that two pages share when exactly one safe answer exists, and reports every other one with its reason. |
| `repair-inline-sources.mjs` | Rewrites `sources:` frontmatter that is not valid YAML list syntax. |
| `repair-missing-hash.mjs` | Stamps a `source-hash` onto raw clippings that predate the field, so they can be hash-joined to their summaries. |
| `repair-provenance-links.mjs` | Repoints a citation that names a clipping by its original title to the file the clipper stored. |
| `repair-quote-provenance.mjs` | Records the source a page already rests on when it quotes a clipping verbatim but declares no path to it. |
| `repair-sources-order.mjs` | Moves a `source-hashes:` key that was inserted between a `sources:` key and its first item. |
| `repair-wrapped-links.mjs` | Joins wikilinks split across a line break by hard-wrapped prose. |
| `refresh-fidelity.mjs` | Re-assesses each clipping's cached fidelity verdict from its stored text and clears flags that no longer hold. |

## Backfill

| Script | Purpose |
|---|---|
| `adopt-clipping.mjs` | Brings hand-clipped files under `raw/clippings/` into the pipeline by stamping the `source-hash` a clipper would have written. |
| `backfill-source-hashes.mjs` | One-time migration: records each legacy `wiki/sources` page's clipping hashes in a `source-hashes:` field. |

## Rename

| Script | Purpose |
|---|---|
| `rename-doubled-extension-clippings.mjs` | Renames raw clippings whose names double the extension (`README.md.md`) and repoints the citations to them. |
| `rename-unsafe-clippings.mjs` | Gives raw clippings a name Obsidian indexes and a wikilink can carry, and repoints the citations to them. |
| `purge.mjs` | Plans, applies, reconciles or restores the removal of a topic and its evidence; applying needs a reviewed plan. |

## Capture

| Script | Purpose |
|---|---|
| `clip.mjs` | Captures a web page (or a saved copy of one) into `raw/clippings/`. |
| `clip-pdf.mjs` | Captures a PDF. |
| `clip-docx.mjs` | Captures a Word document. |
| `clip-pptx.mjs` | Captures a PowerPoint deck. |
| `clip-xlsx.mjs` | Captures a spreadsheet. |
| `clip-gh.mjs` | Captures a GitHub repository. |
| `clip-confluence.mjs` | Captures an authenticated Confluence page through an installed Confluence plugin. |
| `apply-reclips.mjs` | Replays requested repairs or selected layout-flagged captures as recaptures. |
| `render-page.mjs` | Renders one page in a browser for `clip.mjs` when the page needs JavaScript. |
| `extract-page.mjs` | Internal: extracts one page for `clip.mjs` and prints the result as JSON. |
| `known-urls.mjs` | Answers whether a URL is already in the vault, the way the clippers check. |
| `decline.mjs` | Lists, shows and supersedes entries in the decline log. |

## Diagnostics

| Script | Purpose |
|---|---|
| `doctor.mjs` | Reports what each command needs from this machine and what it found. Read-only. |
| `health.mjs` | Reports wiki integrity: open defects, unresolved navigation and the ingest backlog (`--backlog`). |
| `lint.mjs` | Warn-only content lints for the style policy. |
| `lint-disposition.mjs` | Records what a person decided about lint findings, so the next lint run does not list them again, and prunes old records. |
| `stale.mjs` | Read-only freshness report: which wiki pages have not been reviewed recently. |
| `drift.mjs` | Checks wiki pages against their sources for drift using the embedding index. |
| `identity-audit.mjs` | Reports pages that may name the same thing, for review. |
| `relationships.mjs` | Proposes relationship candidates between pages from shared sources and neighbours. |
| `validate-authored.mjs` | Checks the frontmatter, placement and links of the pages one authoring task wrote. |
| `resolve-evidence.mjs` | Walks the citation graph from a wiki page to its raw evidence. |
| `search.mjs` | Searches the wiki, and reports or sets up the semantic search service. |
| `backlog-list.mjs` | Lists backlog items by lifecycle status. |
| `session-brief.mjs` | Prints the state of the wiki project the current repository belongs to. Read-only. |
| `check-skill-citations.mjs` | Reports `wiki-master:<name>` citations in other plugins' directories that name no current skill. |

## Vault setup and authoring

| Script | Purpose |
|---|---|
| `init.mjs` | Scaffolds a new vault. |
| `setup-obsidian-git.mjs` | Checks or sets up the Obsidian Git plugin, which handles all git operations in the vault. |
| `obsidian.mjs` | Proxy to the Obsidian CLI; exits 1 when the CLI prints a refusal. |
| `log-entry.mjs` | Writes one log entry and prints its path. |
| `refresh-index.mjs` | The last step of an authoring task: regenerates the catalogs and refreshes the semantic index. |
| `triage.mjs` | Opens the disposition queue of degraded captures and findings in a local browser page. |

## Evaluation and release

| Script | Purpose |
|---|---|
| `build-keyword-eval.mjs` | Builds the keyword-engine evaluation question set from the vault. |
| `evaluate-retrieval.mjs` | Scores search against a labelled question set. |
| `evaluate-skill-behavior.mjs` | Scores recorded agent traces against skill-behavior scenarios. |
| `bump-version.mjs` | Bumps the release version in every manifest and heads the changelog. |
| `scan-private-terms.mjs` | Scans the repository's files for private names, home paths and invisible characters. |
