# v2 — real folder structure + backlog decomposition — Implementation Plan

Implements `docs/superpowers/specs/2026-08-11-authored-project-structure-v2-design.md`. TDD
throughout: red before green, every task. Builds on v1 (0.14.0, merged) — `project:`/`kind:`
frontmatter and the MOC generator are unchanged; this plan adds physical folders, the canonical
placement rule as documentation, and the backlog-item format + splitter.

## Task 0 — `graph.mjs`: parse `backlog-status:`

- [ ] Red: `test/graph.test.mjs` — a page with `kind: backlog-item` and `backlog-status:
      in-progress` exposes both; absent on a page without them (no invented default).
- [ ] Green: add the field read alongside `project`/`kind`/`decisionStatus`.
- [ ] Verify: `node --test test/graph.test.mjs`.

## Task 1 — `scripts/lib/roadmap-split.mjs`: the mechanical extractor

Pure, I/O-free, tested in isolation — mirrors this repo's `scripts/lib/backfill.mjs`/
`scripts/lib/repoint.mjs` convention of pure text-transform functions the CLI script wraps.

- [ ] Red: `test/roadmap-split.test.mjs` —
  - Given a small synthetic roadmap body with one `##` section containing a numbered list (the
    "Now" section's own shape) and another with a bulleted list, extracts one item per top-level
    list entry, each with its **exact original text** (verbatim — a byte-for-byte substring
    check, not a fuzzy match).
  - Status inference: an item containing `✅` maps to `shipped`; `🚧` to `in-progress`; `📐` or
    `⚠️ FUTURE` to `planned`; an item under a section explicitly named (case-insensitively)
    "blocked" with no overriding inline marker maps to `blocked`; an item with no marker at all
    and no special section falls back to `planned`.
  - Title derivation: the bolded lead-in text immediately after the list marker, truncated at
    the first ` — ` / `.` / newline, whichever comes first — matches the real file's own
    `**Title** — <detail>` shape exactly (verified against real extracted titles from the real
    file as a fixture, not only synthetic ones).
  - A nested/sub-item (indented under a top-level item, e.g. the real file's 3-sub-part
    "Scratch org definition editor..." item) stays INSIDE its parent's extracted text — it is not
    separately extracted as its own top-level item. Only zero-indent list markers are split
    points.
  - Slug generation: lowercase, spaces/punctuation to hyphens, collapsed, matching this repo's
    existing `slugify` in `scripts/clip.mjs` (reuse it, do not reimplement).
  - Sections to scan are an explicit, passed-in list (not hardcoded) — the function takes
    `{ body, sections: [...] }` so it is reusable against a differently-headed roadmap (e.g. the
    real `sparta-usage-tracker-roadmap.md`), not hardwired to this one file's heading text.
- [ ] Green: implement.
- [ ] Verify: `node --test test/roadmap-split.test.mjs`.

## Task 2 — Templates + skill docs

- [ ] New `templates/_templates/authored-backlog-item.md` — `type: authored`, `sources: []`,
      `project:`, `kind: backlog-item`, `backlog-status: planned` pre-filled.
- [ ] `skills/wiki-maintainer/SKILL.md` — add the canonical placement table from spec §2 verbatim
      (verb → location), and the backlog-item format + "edit in place, don't append a dated
      update" instruction from spec §3, stated as a direct instruction to an authoring agent.
- [ ] `templates/vault-schema.md` — add `backlog-status` to the frontmatter contract line.
- [ ] Verify: `node --test test/drift-guard.test.mjs`.

## Task 3 — `scripts/backlog-gen.mjs`: generated roadmap-as-index

Reuses `scripts/lib/authored-group.mjs`'s pattern (a new `groupByBacklogStatus`, or extend the
existing grouping module) and the exact fence contract from `index-gen.mjs`/`moc-authored-gen.mjs`.

- [ ] Red: `test/backlog-gen.test.mjs` —
  - Given a project with 3 `kind: backlog-item` pages at different `backlog-status` values,
    generates a fenced block grouping them by status (a fixed status order: in-progress →
    planned → blocked → shipped → dropped — "what's live" before "what's done"), one bullet per
    item.
  - Re-running replaces only the fenced region; hand-written prose (a `## Summary`) survives
    byte-identical — same test shape as `moc-authored-gen.test.mjs`.
  - A project with zero backlog items produces no fenced section (nothing to index) rather than
    an empty fence.
- [ ] Green: implement, dry-run/`--apply`, matching every other generation script in this repo.
- [ ] Verify: `node --test test/backlog-gen.test.mjs`.

## Task 4 — Folder migration (real vault, via `obsidian move`)

Every current `wiki/authored/` page carrying a `project:` value (38 files as of this writing, one
page — `sf-cli-local-auth-mechanics.md` — correctly excluded, having no `project:`) moves to
`wiki/authored/<project>/[<subproject>/]<existing filename, unchanged>.md`, per spec §2's
no-rename decision. Executed via `obsidian move file=<name> to=<folder>` (the sanctioned
vault-write path), not direct file-tool moves.

- [ ] Enumerate the real move plan from each page's already-recorded `project:` value (read via
      `obsidian property:read`, not re-derived): `sparta-suite` → `wiki/authored/sparta-suite/`;
      `sparta-suite/migrator` → `wiki/authored/sparta-suite/migrator/`; `processing-agent` →
      `wiki/authored/processing-agent/`; `processing-agent/translation` →
      `wiki/authored/processing-agent/translation/`. One page
      (`sparta-migrator Salesforce OAuth Implementation.md`) currently has no `project:`/`kind:`
      set (created by a concurrent session after v1's backfill ran) — classify it by reading its
      content (already confirmed: `sparta-suite/migrator`, `kind: reference`) and set both before
      moving it, rather than moving it unclassified.
- [ ] Execute the moves. Verify via `obsidian backlinks` on 3–4 sampled files before/after that no
      inbound link count changed (Obsidian resolves wikilinks by name, not path, so a same-named
      file moving folders should not orphan anything referencing it by `[[bare name]]`) — this is
      the empirical check for the exact collision class spec §2 reasons about, not just a
      theoretical guarantee.
- [ ] Re-run `node scripts/backfill-authored-metadata.mjs` (dry-run) — expect it to report the one
      OAuth file only (everything else already classified), confirming the script still operates
      correctly against the new folder locations (it is depth-agnostic per Task 4's own
      verification in this plan's precursor spec).

## Task 5 — Decompose the real monolith

- [ ] Run the Task 1 extractor against the real, current
      `wiki/authored/sparta-suite/migrator/sparta-migrator-roadmap.md` body with the real
      section headings (`Now (this initiative, no external blockers)`, `In progress (not yet
      merged)`, `Known issues (active investigation)`, `Blocked on platform`, `Explicitly future,
      not this initiative`) as the `sections` argument.
- [ ] Write one file per extracted item to
      `wiki/authored/sparta-suite/migrator/backlog/<slug>.md` via `obsidian create` — verbatim
      body per spec §4, `backlog-status:` per the extractor's own inference, `project:
      sparta-suite/migrator`, `kind: backlog-item`.
- [ ] Spot-check several extracted files against the original source lines (diff the extracted
      body text against the exact original line range) to confirm zero content drift — this is
      the concrete verification that "scripted, not manual" actually delivered fidelity, not just
      an assumption.
- [ ] Rewrite `sparta-migrator-roadmap.md` itself down to hand-written framing only (`## Summary`,
      any genuinely evergreen context) plus a `%% BEGIN/END GENERATED CATALOG %%` fence; run
      `scripts/backlog-gen.mjs --apply` to populate it from the new `backlog/*.md` items.
- [ ] `node scripts/health.mjs` — confirm `monolithCandidates` no longer includes
      `sparta-migrator-roadmap.md` (now well under the word floor) and reports nothing else new.

## Task 6 — Regenerate MOCs, index, log entry, version, ship

- [ ] `node scripts/moc-authored-gen.mjs --apply` — confirm still correct against the new nested
      paths (depth-agnostic per Task 4's design).
- [ ] `node scripts/index-gen.mjs` — regenerate once, at the end.
- [ ] One log entry documenting the folder migration + monolith decomposition, including exact
      before/after word counts for the roadmap file and the backlog-item count created.
- [ ] Version bump (0.14.0 → 0.15.0, new capability) across all 5 manifests; `CHANGELOG.md` entry.
- [ ] Full suite green; commit, push, PR, merge (established `gh auth switch --user ehartye`
      pattern, `--admin` merge given the branch-protection review requirement noted after v1),
      restore identity, prune branch.
