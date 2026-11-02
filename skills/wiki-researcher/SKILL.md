---
name: wiki-researcher
description: Use when asked to discover external sources for the wiki, capture a named URL or file as evidence, clip PDF, Word, PowerPoint, spreadsheet, GitHub repository or authenticated Confluence sources, ingest named existing clippings, or process new/un-ingested clippings. A backlog count is maintainer reporting; ordinary web or application work is not a wiki research request.
---

# Researching and ingesting wiki evidence

Choose the mode explicitly from the request. An unspecified request to use this
role is not permission to process the whole backlog; clarify the intended task.
Treat `$ARGUMENTS` as the request when the host has not substituted it.

- **Discover sources on a topic:** read [discovery](references/discover.md),
  [access](../wiki-maintainer/references/access.md),
  [evidence](../wiki-maintainer/references/evidence.md), and
  [efficacy](../wiki-maintainer/references/efficacy.md). Research perspectives
  return candidates without writing. Use the capture route only within the
  requested scope; a request for candidates alone remains read-only.
- **Capture named URLs or saved web pages:** read [named capture](references/capture.md)
  and [access](../wiki-maintainer/references/access.md). Skip broad topic research;
  preserve deduplication, declines and capture checks.
- **Capture a named format or service:** read its complete route:
  [PDF](references/clip-pdf.md), [Word](references/clip-docx.md),
  [PowerPoint](references/clip-pptx.md), [spreadsheets](references/clip-xlsx.md),
  [GitHub repository](references/clip-gh.md), or
  [Confluence](references/clip-confluence.md). These routes include prerequisite
  checks; missing converters or authentication never justify fabricated evidence.
- **Ingest named existing clippings:** read [ingestion](references/ingest.md),
  [access](../wiki-maintainer/references/access.md), and
  [evidence](../wiki-maintainer/references/evidence.md). Use the exact source set;
  do not rediscover it or silently expand to the global backlog.
- **Process new or un-ingested clippings without a filename:** read
  [ingestion](references/ingest.md) and the
  [hash-join backlog contract](../wiki-maintainer/references/maintenance.md).
  Determine eligibility before writing. Preserve already summarized sources and
  reject restricted evidence as support. If nothing eligible is pending, report
  that without opening an operation, logging, committing or refreshing indexes.

Capture-only requests create evidence, never derived source or concept pages.
Ingestion needs authorization for that source set; an explicitly requested full
research-and-ingest flow already provides it. Only capture tools write raw
artifacts, and agents never edit their bodies. Read
[evidence](../wiki-maintainer/references/evidence.md) before assessing fidelity,
quoting or synthesizing; preserve restrictions and platform-specific sections.

Before the first authorized mutation, read
[operation completion](../wiki-maintainer/references/operations.md). Finish the
scoped validation, log, commit, sync and remote verification unless publication
is held. Reuse an enclosing operation when it owns the work; preserve other
writers' edits. For concept reuse and relationship changes read
[efficacy](../wiki-maintainer/references/efficacy.md).
