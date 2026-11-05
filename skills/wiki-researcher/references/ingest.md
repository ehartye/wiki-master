# Ingest captured evidence

For a requested research → ingest → search-and-answer flow, complete ingestion
below and then follow [wiki-search](../../wiki-search/SKILL.md),
[advanced retrieval](../../wiki-search/references/advanced.md) when needed, and
[cited answers](../../wiki-search/references/answers.md). Run the search helper against the
updated vault before answering and inspect returned passages and exact evidence.
Lexical search works without a semantic index. Report unavailable channels;
reading the pages you just wrote does not replace the requested retrieval step.
Ordinary ingestion alone does not require this additional answer workflow.

Read [access and host commands](../../wiki-maintainer/references/access.md) before touching the vault. Also read for this task: [evidence](../../wiki-maintainer/references/evidence.md).
Load the rest only when this run reaches it — [efficacy](../../wiki-maintainer/references/efficacy.md) before creating or merging a concept, alias or relationship; [maintenance](../../wiki-maintainer/references/maintenance.md) when you compute the backlog with the content-hash join, or hit a structural repair.
Reuse existing session authorization for the first write.

## Select eligible work before writing

For an explicit request to process new/un-ingested clippings without a filename,
run `node "<absolute-plugin-root>/scripts/health.mjs" --backlog` through the direct
[backlog check](../../wiki-setup/references/checks.md#health-and-ingest-backlog). The **not ingested
(no summary records their hash)** list is the starting set. This source-hash join,
including its documented legacy fallback, is authoritative for membership; do
not infer backlog from filenames, navigation citations or a successful exit.
An unspecified request to use the researcher role is not a request to ingest all.

For named clippings, resolve and read those exact paths only. Check the same
hash-join report and the existing source summaries before doing work: if a source
page already records that clipping's `source-hash`, preserve it and report already
ingested. A rerun creates no duplicate summary or unearned second ingestion.
An explicit request to revise an existing summary can update that canonical page;
do not expand named ingestion to unrelated backlog or broad discovery.

Inspect each selected clipping's metadata before treating it as support. Exclude
`citation-status: quarantined`, `restricted` or `retired` evidence, preserving its
raw bytes and restriction; report it separately rather than summarizing it as
accepted support. A missing source hash is a repair issue, not permission to
invent one. Binary originals and figure sidecars are not summary targets. The
helper's backlog can include restricted or defective captures, so its count is
not automatically the count of eligible work.

If the backlog is zero, every named source is already summarized, or no eligible
source remains, stop and report the actual result and any exclusions. Do not
create pages, log or refresh. For work that remains, retain the exact eligible set and initial hash-join membership. See
[backlog semantics](../../wiki-maintainer/references/maintenance.md) for migration
and repair cases; structural repair still needs its own authorized scope.

## Ingest and complete the selected set

Read [completion](../../wiki-maintainer/references/operations.md)
before the first authorized write. An ingest ends the way it says.

**Note each page you write** (`wiki/sources/...`, a concept or synthesis you create or
change): that list is the validation ledger. When this ingest follows a capture, take the
clipping set from the paths the clippers printed. A delegated writer writes and validates,
then reports the paths it wrote; the enclosing task logs once and runs the refresh.

Prefer a named clipping set; two concurrent ingests can overwrite shared concept
pages and nothing isolates them, so coordinate overlapping targets rather than processing
the global backlog in parallel. Keep your edits to what your task needs, and update only
pages substantively changed by the evidence.

Apply the [Reddit and Medium evidence policy](../../wiki-maintainer/references/evidence.md#reddit-and-medium)
to every page you write: Reddit-derived content belongs under
`## Reddit discussion (anecdotal)` and Medium-derived content under
`## Medium articles`, including when updating a mixed-source page.

For each eligible source, perform steps 1–3 and preserve raw body bytes. After
the selected batch, perform steps 4–6 once so the task has one log and one refresh:
1. Read the exact clipping through the guarded CLI or filesystem. Write derived
   Markdown through exact-path filesystem edits, never a whole CLI `content=` payload. Discuss
   the key takeaways with the user.
2. Write/update `wiki/sources/<slug>.md`: a summary with `sources: ["[[<raw link>]]"]`,
   `type: source`, `ai-generated: true`, and typed `created`/`updated`/`reviewed`.
   **Always quote each wikilink inside the list — `sources: ["[[A]]", "[[B]]"]`,
   never a bare `sources: [[A]]` or an unquoted block list (`- [[A]]`).** Both
   unquoted shapes look correct and Obsidian still renders the links, but neither
   is valid YAML: `[[A]]` is flow-sequence syntax one level too many and silently
   parses into a nested list instead of a string, which is exactly the "type
   mismatch, expected list" defect `node "<absolute-plugin-root>/scripts/repair-inline-sources.mjs"`
   exists to repair in bulk. Quoting is what makes it an unambiguous string.
   **Cite the clipping by its actual filesystem path — `sources: ["[[raw/clippings/<exact filename>.md]]"]` — copied from the path you just read, never retyped from
   the source's title.** The clipper slugifies a title into a filename (`/`, `:`,
   `#`, `*`, `?`, quotes and brackets all become `-`, then a 120-char cap), so any
   title carrying one of those characters or running long does NOT name its own
   file. Citing the remembered title produces a link to a file that does not exist:
   the page becomes a `provenanceGap` and its clipping reads as unparsed, even
   though the ingest itself was correct. List the resolved vault's exact `raw/clippings/` directory or reuse the path
   from step 1 rather than reconstructing it.
   Also record `source-hashes: [<sha256>, …]` — the `source-hash` frontmatter value
   of each clipping you summarized (read it from the clipping's frontmatter). This
   is the machine key the ingest-backlog metric joins on — immune to filename and
   citation drift; the `sources: ["[[…]]"]` wikilink stays for navigation.
   Existing citation drift routes to [authorized maintenance repair](../../wiki-maintainer/references/maintenance.md); ingestion does not silently expand its scope to bulk repairs.
   **Figures.** If the clipping's frontmatter lists `figures:`, open each sidecar
   (`raw/figures/<slug>-p<N>.md`) and **look at the PNG with the Read tool** before
   writing. Embed the ones that carry evidence on the source page as
   `![[raw/figures/<slug>-p<N>.png]]` next to the claim they support, with a sentence
   saying what the figure shows (axes, series, trend) taken from what you see, not from
   the machine description. A page render is a whole page: say which part matters.
   Quote numbers read off a chart as approximate and attribute them. If the PDF has
   figures but no `figures:`, tell the user `clip-pdf.mjs --figures-only` can add them.
   Never edit or add to `raw/figures/`.
3. Before creating a concept, search the proposed title, equivalent wording and
   nearby passages. Extend the canonical page, add a genuinely equivalent alias,
   or explain the new concept's distinct scope. Use `_templates/concept-note.md`;
   follow the directly linked efficacy reference for aliases and relationships.
   Create a stub (`status: stub`) only for an identified gap. Explain each useful
   connection under `## Relationships`; keep supporting citations in `sources:`
   and the relevant prose. Relatedness does not establish support. Update the
   task map the new knowledge helps answer. Preserve `reviewed` on pages that
   received only metadata/link edits; stamp it only after factual verification.
4. **Validate.** Never edit anything under `raw/`. Inspect the derived pages' exact
   citation targets, source hashes, frontmatter and supported claims, then follow the
   direct [scoped validation procedure](../../wiki-setup/references/validation.md):
   `node "<absolute-plugin-root>/scripts/validate-authored.mjs" --paths-file <ledger>`.
   The ledger must list every source/concept/synthesis page this ingestion wrote; never
   add another writer's paths. Require validator exit 0 before step 5; on a nonzero exit,
   resolve the reported issue and rerun. Retain checked/skipped/defect counts. Health,
   lint and backlog reports do not replace this check. If content changes afterward,
   validate again. Rerun `node "<absolute-plugin-root>/scripts/health.mjs" --backlog` and
   compare the actual hash-join membership with the initial set. Eligible sources just
   summarized should leave that set; restricted captures do not become ingested by
   exclusion. Confirm already summarized sources and raw bodies remain unchanged.
5. **Log once** by piping the narrative to
   `node "<absolute-plugin-root>/scripts/log-entry.mjs" --op ingest --title "<what you ingested>"`
   (creates `log/<timestamp>-ingest-<slug>.md` in the resolved vault).
6. **Run `node "<absolute-plugin-root>/scripts/refresh-index.mjs"`** once, and report as
   [completion](../../wiki-maintainer/references/operations.md) describes. It regenerates the
   catalogs, so never hand-edit `index.md`'s generated fence.
