---
name: wiki-maintainer
description: Use when asked to report wiki health, integrity defects, orphan or ingest-backlog counts, review freshness or unsupported claims, repair broken links and citations, connect related concepts, or triage sources needing human attention. Counts and reports are read-only; processing new clippings belongs to wiki-researcher and ordinary application work is not wiki maintenance.
---

# Maintaining the wiki

Select the requested mode; read [access](references/access.md) and only the
references relevant to that mode. Treat `$ARGUMENTS` as the request when the host
has not substituted it.

- **Health, structural defects or backlog counts:** [health](references/health.md)
  and [metrics](references/maintenance.md). Reporting does not process clippings.
- **Freshness and what needs factual review:** [freshness](references/stale.md).
- **Consistency, contradictions, unsupported quotes and factual fixes:**
  [lint](references/lint.md) and [evidence](references/evidence.md).
  For quotation-pairing and style-flag mechanics, read the
  [content lint contract](../../README.md#content-lint).
- **Broken citations or integrity worklist repairs:** [repair](references/repair.md).
- **Useful relationships, forward links, orphan navigation and task maps:**
  [relink](references/relink.md) and [identity and relationships](references/efficacy.md).
- **Clipping failures, fidelity flags, declines and human decisions:**
  [triage](references/triage.md). Presenting the UI creates only local session
  state; applying dispositions is a separate action. Before applying re-clips or
  quarantine, read [re-clipping and quarantine](../../docs/reclipping.md).
- **Native Obsidian mechanics when a maintenance step needs them:**
  [Obsidian commands](references/obsidian-cli.md). Requested app actions also
  route here from wiki-user; ordinary file work does not require the app.

Health, freshness and preview reports do not open operations, log, commit or
refresh indexes. Before applying authorized changes, read
[evidence](references/evidence.md) and [operation completion](references/operations.md).
Keep reports distinct from mutations; a request for a report does not authorize
repairs. Preserve raw bodies and foreign edits, validate the actual changed
paths, and finish scoped publication unless the user holds it. Purge keeps its
separate plan and publication approvals in [wiki-purge](../wiki-purge/SKILL.md).

A clean graph does not prove factual accuracy. During substantive maintenance,
use cheap structural checks and a bounded review of changed or high-use pages;
skip an empty vault and avoid a full lint of an unchanged wiki. Preserve factual
review dates on mechanical edits and report coverage limits. For cross-mode
orientation only, see the [workflow overview](references/workflows.md).
