---
name: wiki-project
description: Use when asked to write or update original wiki project documentation, an overview, as-built architecture, roadmap, backlog item, ADR, guide, diagram, reference or standalone authored note, or list project work by lifecycle. Validation-only requests belong to wiki-setup; retrieved-source synthesis filing belongs to wiki-maintainer.
---

# Write original project documentation

Keep the wiki's first-party project record accurate and current. Original authored
content has no required raw counterpart and declares `sources: []`. Read-only
backlog listing does not authorize editing or catalog generation.

## Workflow

1. Resolve absolute installed helpers using [access](../wiki-maintainer/references/access.md),
   then run `context.mjs --purpose documentation --repo "<repository>" --json` before any
   authoring. Read that documentation vault's `AGENTS.md`, `VAULT.md` and schema. Use the
   resolved project and canonical project folder; absent an explicit project, overview
   `repo:` discovery remains the fallback (`session-brief.mjs` can show it). Correct
   identity conflicts before writing; never create a duplicate project to evade a changed
   destination. Bind this target for validation/log/refresh. Locate existing pages first.
   Read [authoring and placement](references/authoring.md) and choose the kind.
   **If the resolved vault has no `wiki/authored/<project>/` folder for the project you are
   documenting, stop: confirm the vault before creating it.** Rerun with `--repo` as that
   project's own repository (and, if `configPath` is not null, no `WIKI_MASTER_VAULT*` set);
   use that vault if it has the folder, and say so if the user named another. Otherwise:
   - **Confirmed:** the user named it for this project; a registry resolved it from that
     repository; or, with no registry, `WIKI_MASTER_VAULT` is unset and it has `VAULT.md`.
   - **Vetoed**, unless the user named it: its `VAULT.md` `excludes` covers the project, or
     another vault in the `configPath` file has the folder or cannot be read.
   - **Confirmed and not vetoed:** state the vault and folder in your message, then go on.
   - **Anything else:** ask the user once which vault, naming the candidates, and **create
     nothing for that project until answered**. With no user to ask, stop and report.
   - **A named vault** that a registry omits or the project's repository does not route to:
     say so, offer to correct the route or register it via
     [routing](../wiki-setup/references/routing.md), and change or write nothing until the user
     accepts; naming it is not acceptance.
   - **The vault this check settles on** serves the rest of that project's work:
     instructions, pages, search, validation, log and refresh. Bind `WIKI_MASTER_VAULT_ID`
     to it and `WIKI_MASTER_PROJECT_ROOT` to the project's repository if available; without
     a registry, `WIKI_MASTER_VAULT`. Create a new project's overview before its other
     documents.
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
Knowledge learned elsewhere may inform original prose, with ordinary original-source
HTTPS citations. Do not cite a foreign vault note, copy its evidence, or fabricate a
local `sources:` path; moving existing pages and evidence between vaults is
wiki-maintainer's [transfer](../wiki-maintainer/references/transfer.md). Supporting captures require this documentation vault to be in
the research list and selected for a separately authorized original-source capture.

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
