---
name: wiki-project
description: Use when asked to write or update original wiki project documentation, an overview, as-built architecture, roadmap, backlog item, ADR, guide, diagram, reference or standalone authored note, or list project work by lifecycle. Validation-only requests belong to wiki-setup; retrieved-source synthesis filing belongs to wiki-maintainer.
---

# Write original project documentation

Keep the wiki's first-party project record accurate and current. Original authored
content has no required raw counterpart and declares `sources: []`. Read-only
backlog listing does not authorize editing or catalog generation.

## Workflow

1. Resolve the vault and absolute installed helpers using
   [access](../wiki-maintainer/references/access.md); read vault instructions.
   Identify the project from its overview's `repo:` mapping (the read-only
   `session-brief.mjs` can resolve the repository). Locate existing pages first.
   Read [authoring and placement](references/authoring.md) and choose the kind;
   create a new project's overview before its other documents.
2. Inspect current project behavior and relevant wiki passages. Separate verified
   implementation from proposals and unverified claims. Before asserting the wiki
   has no relevant page, run two bounded searches and describe their limited result.
3. Before any write, read [evidence](../wiki-maintainer/references/evidence.md) and
   [completion](../wiki-maintainer/references/operations.md). Keep your edits to
   what your task needs.
4. Write ordinary Markdown through exact-path filesystem edits, using the
   matching authored template. Set required metadata and current `updated` dates;
   advance `reviewed` only after factual verification. Revise living text in place.
   For backlog and roadmap work, read [backlog lifecycle](references/backlog.md).
5. Validate exactly the paths you wrote using the direct
   [scoped validation procedure](../wiki-setup/references/validation.md). Resolve
   defects before completion, then log once with `--op relink`.
6. Run `refresh-index.mjs` once, as
   [completion](../wiki-maintainer/references/operations.md) describes. Report actual
   results and blockers: the work is on disk and Obsidian Git publishes it on its next run.

## Examples

- **Architecture or guide.** Request: “Document how Beacon persists messages.”
  Action: verify the implementation, update
  `wiki/authored/beacon/architecture.md` with `kind: architecture`, link a guide
  where useful, then validate, log and refresh. Result: an as-built
  explanation with proposed parallel workers left in the backlog.
- **Decision.** Request: “Record why we chose a local queue.” Action: create
  `decisions/local-queue-adr.md` with context, decision, benefits, costs and
  `decision-status: accepted`; label reconstructed reasoning if retrospective.
  Result: a discoverable decision record whose status matches its prose.
- **Backlog update.** Request: “Add a retry-budget item.” Action: create one small
  `backlog/retry-budget.md`, set `kind: backlog-item` and `backlog-status: planned`,
  then validate, log and refresh. Result: one current item and
  its roadmap entry, without stacked dated updates.
- **Backlog listing.** Request: “Which Beacon items are ready to start?” Action:
  run the following read-only helper and inspect unmet prerequisites. Result:
  project paths, lifecycle states and dependencies; no writes or refresh.

  ```sh
  node "<absolute-plugin-root>/scripts/backlog-list.mjs" --project beacon --startable --json
  ```

- **Standalone note.** Request: “Write our editorial policy in the wiki.” Action:
  create an original note directly under `wiki/authored/` with required authored
  metadata and `sources: []`; omit project/kind only if genuinely project-less.
  Result: a validated first-party note on disk, without fabricated provenance.

## Best practices

Architecture describes built behavior; backlog describes intended work. Keep
roadmaps current in the same task. Use full-path links across projects and
retain established filenames. Record failed attempts and limits, balanced ADR
consequences, and the difference between not built and built but broken. The repo
establishes behavior; the wiki records intent, including disagreements worth fixing.

## Advanced references

Load [authoring](references/authoring.md) for canonical paths, metadata, diagrams,
guides and living documents; [backlog](references/backlog.md) for dependencies,
listing and roadmap presentation; [catalogs](references/catalogs.md) for generated
fences. Required checks link directly to
[validation](../wiki-setup/references/validation.md); a refresh that cannot finish uses
[recovery](../wiki-setup/references/operation-recovery.md).
For a derived answer, use [maintainer synthesis filing](../wiki-maintainer/references/synthesis-filing.md).

## Done

The requested pages are accurate, validated, logged and refreshed, or reported as
written but not refreshed with the fix to offer. Read-only listing leaves the vault
unchanged.
