---
name: wiki-researcher
description: Use when asked to discover external sources for the wiki, capture a named URL or saved page, clip PDF, Word, PowerPoint, spreadsheet, GitHub repository or authenticated Confluence evidence, ingest named clippings, or process new/un-ingested clippings. Backlog counts belong to wiki-setup; ordinary web or application work is not a wiki research request.
---

# Discover, capture and ingest evidence

Keep the source set and authorized outcome explicit. Candidates-only discovery
is read-only; capture-only creates raw evidence, never derived pages. An
unspecified request to use this role does not authorize processing the backlog.

## Workflow

1. Read [access](../wiki-maintainer/references/access.md), resolve the known vault
   and absolute installed helpers, and open applicable vault instructions.
   Choose discovery, named capture, named ingestion or default-backlog ingestion
   from the request. Clarify an ambiguous task before writing.
2. Follow the corresponding direct procedure below. Discovery requires separate
   read-only finders and independent selection when delegation is available;
   retain that selection before capture. Named sources skip broad discovery.
   Ingestion determines eligibility before writing anything.
3. Read [evidence](../wiki-maintainer/references/evidence.md) before judging
   fidelity or synthesizing. Preserve raw bodies, exact hashes and paths,
   restricted-source exclusions and separate Reddit/Medium sections. Before an
   authorized write, read [completion](../wiki-maintainer/references/operations.md)
   and keep your edits to what your task needs.
4. Capture with the matching helper, passing the same research topic throughout a
   run. Ingest only the authorized eligible set, reuse canonical pages and explain
   useful relationships under the
   [identity contract](../wiki-maintainer/references/efficacy.md).
5. Verify capture fidelity or derived claims. For any wiki page written, run
   `node "<absolute-plugin-root>/scripts/validate-authored.mjs" --paths-file <ledger>`
   using the direct [scoped validation procedure](../wiki-setup/references/validation.md)
   and require exit 0; a health, lint or backlog report does not replace it. Log once.
6. If the task wrote a wiki page, run `refresh-index.mjs` once, as
   [completion](../wiki-maintainer/references/operations.md) describes. A capture that
   wrote no wiki page needs no refresh: clippings and log entries enter neither the
   catalogs nor the search index. Report actual results and blockers: the work is on
   disk and Obsidian Git publishes it on its next run.

If the request continues with a search or answer, load
[wiki-search](../wiki-search/SKILL.md) and actually run retrieval against the
updated vault, opening its returned passages. Use
[advanced retrieval](../wiki-search/references/advanced.md) or
[cited answers](../wiki-search/references/answers.md) as needed. Memory of pages
just written is not retrieval; lexical-only availability is disclosed, not a
reason to skip this. The answer stays read-only unless filing is authorized.

## Modes and examples

- **Discover:** read [discovery](references/discover.md).
  Request: “Find evidence on retry budgets; return candidates only.” Action:
  check coverage/dedup, dispatch five perspective finders and independently select
  their candidates. Result: a justified source list without clips, declines or logs.
  An explicit discover-and-capture/ingest request can continue within that scope.
- **Named URL or saved page:** read [capture](references/capture.md).
  Request: “Capture this saved article.” Action: use `clip.mjs --from-file` for
  the named URL, preserving dedup, declines and provenance. Result: a verified
  raw clipping and one log entry; no source summary unless ingestion was requested.
- **Format or service capture:** read the matching complete route:
  [web pages](references/clip-html.md), [PDF](references/clip-pdf.md), [Word](references/clip-docx.md),
  [PowerPoint](references/clip-pptx.md), [spreadsheets](references/clip-xlsx.md),
  [GitHub repository](references/clip-gh.md), or [Confluence](references/clip-confluence.md).
  Request: “Clip this PDF with its figures.” Action: run its linked prerequisite
  check, then `clip-pdf.mjs --figures` and inspect the returned text/images.
  Result: citable capture paths with actual fidelity limits.
  Other formats use their named helper, never an improvised raw file.
- **Named ingestion:** read [ingestion](references/ingest.md).
  Request: “Ingest these two clippings.” Action: read exactly those sources,
  exclude restricted or already-summarized hashes, then write only supported
  source/concept changes. Result: summaries with exact raw paths and source hashes.
- **Default backlog ingestion:** read [ingestion](references/ingest.md) and the
  [hash-join contract](../wiki-maintainer/references/maintenance.md).
  Request: “Process new clippings.” Action: obtain the
  [backlog report](../wiki-setup/references/checks.md#health-and-ingest-backlog), then
  inspect eligibility. Result: only eligible sources are ingested; already summarized
  sources stay unchanged and restricted sources are reported separately. If none
  remain, make no pages, log or refresh.

## Best practices

Prefer named source sets and coordinate shared concept edits. A capture's
fidelity and its author's credibility are different judgments. Do not invent
text when tools or authenticated access are unavailable. Source count is not a
quality target. Do not treat a backlog count as ingestion authorization.

## Advanced references

Load the exact [capture prerequisite section](../wiki-setup/references/capture-prerequisites.md)
the selected format requires. Tool trouble uses that same section; a refresh that
cannot finish uses [recovery](../wiki-setup/references/operation-recovery.md). Concept
identity and evidence rules remain in the directly linked shared contracts; original
project documentation belongs to [wiki-project](../wiki-project/SKILL.md).

## Done

The requested candidates, captures or eligible ingestion set are accounted for,
fidelity/exclusions/coverage are honest, and every wiki page written is validated,
logged and refreshed, or reported as written but not refreshed; a capture with no
wiki page is verified and logged. A requested retrieval handoff actually ran.
Candidates-only and zero-eligible ingestion leave the vault unchanged.
