# `wiki/authored/` project-documentation pattern — Implementation Plan

Implements `docs/superpowers/specs/2026-08-11-authored-project-docs-design.md`. TDD throughout:
red (failing test written and confirmed failing) before green (implementation) on every task.

## Task 0 — `graph.mjs`: parse `project:`, `kind:`, `decision-status:` frontmatter

- [x] Red: `test/graph.test.mjs` — a page with `project: sparta-suite/migrator` and `kind: decision` and
      `decision-status: accepted` exposes all three on its page object; a page with none of them
      exposes `undefined` for all three (no crash, no default invented).
- [x] Green: `buildGraph` in `scripts/lib/graph.mjs` reads the three fields with the same
      `fm.match(/^field:\s*"?(...)"?/m)` style already used for `status`/`type`, alongside the
      existing field reads.
- [x] Verify: `node --test test/graph.test.mjs`.

## Task 1 — `scripts/lib/authored-group.mjs`: pure grouping module

New file, mirroring `scripts/lib/topic.mjs`'s shape and rigor (pure, I/O-free, deterministic,
tested in isolation).

- [x] Red: `test/authored-group.test.mjs` —
  - `normalizeProject`/`projectKey` — trim/collapse whitespace, case-insensitive key, first-seen
    casing for display (same contract as `normalizeTopic`/`topicKey`).
  - `KIND_ORDER` — exported fixed array: `['overview', 'architecture', 'reference', 'guide',
    'diagram', 'decision', 'roadmap', 'note']`. A `kind` outside this list, or absent, sorts into
    a trailing `Other` bucket — never dropped, never silently merged into a wrong bucket.
  - `groupByProject(pages)` — returns one entry per distinct `project:` value (pages with no
    `project:` excluded — the caller decides what "no project" means, this module only groups what
    it's given), each entry `{ project, key, pages }`, sorted alphabetically by `key` (a lookup
    aid, not a ranking — deliberately NOT count-descending like triage's topic chips, which are a
    filter bar; this is a catalog, ordered the way a person scans for "my project").
  - `groupByKind(pages)` — for one project's pages, returns `{ kind, pages }` groups in
    `KIND_ORDER`, `Other` last regardless of count (mirrors `Unattributed` always sorting last in
    `topic.mjs`, for the identical reason: residue, not a real bucket).
  - Determinism test: two runs over the same input, permuted, produce identical output — this
    project has shipped filesystem/iteration-order bugs before (`test/drift-guard.test.mjs`'s
    NUL-byte test, the topic-grouping spec's §5) and every new grouping function gets this check
    from day one rather than after an incident.
- [x] Green: implement `scripts/lib/authored-group.mjs`.
- [x] Verify: `node --test test/authored-group.test.mjs`.

## Task 2 — Templates

- [x] `templates/_templates/authored-note.md` — add `project:` and `kind:` as commented-optional
      frontmatter fields, with the `kind:` vocabulary listed inline (the template is the one place
      an authoring agent is guaranteed to see before writing frontmatter — per spec §7, the
      vocabulary must be self-evident from here alone).
- [x] New `templates/_templates/authored-decision.md` — an ADR-specific template: `kind: decision`,
      `decision-status: proposed` pre-filled, body pre-scaffolded with `## Status` / `## Context` /
      `## Decision` / `## Consequences` (the Nygard shape both existing vault ADRs already
      converged on unprompted — this template makes that the path of least resistance for the
      next one instead of an unprompted convergence).
- [x] No automated test for template content (matches `authored-note.md`'s existing precedent —
      no test exercises it today); manually verified by reading the rendered file.

## Task 3 — Generated per-project MOC

New script `scripts/moc-authored-gen.mjs`, single responsibility (matches this repo's convention
of one script per repair/generation concern — `backfill-source-hashes.mjs`,
`repair-provenance-links.mjs`, `index-gen.mjs` are none of them multi-purpose).

**Design decision, settled here rather than left ambiguous**: a per-project MOC follows the exact
shape `index.md` already uses successfully — free-form hand-prose *around* a generated fence, not
instead of it. The two existing hand-written MOCs (`moc/processing-agent.md`, `moc/sparta-
suite.md`) already carry real value a generator cannot invent (curated one-line descriptions per
page, "Cross-cutting topics", "Related vault entities") — that content is preserved verbatim,
outside the fence, exactly as `index.md`'s own contract already guarantees for its surrounding
prose. The fence itself renders bare, kind-grouped bullets (`- [[title]]`) with **no invented
description text** — matching `index-gen.mjs`'s own established minimalism for its generated
catalog precisely, rather than inventing a new, more fragile prose-scraping mechanism to
approximate the hand-written one-liners. The fence's job is completeness ("guaranteed to list
every page for this project, however small"), not narrative — narrative stays hand-written,
exactly where it already lives today.

- [x] Red: `test/moc-authored-gen.test.mjs` —
  - Given a graph with 3 `wiki/authored/` pages sharing `project: demo` across 2 different
    `kind:` values, generates a fenced block grouping them by `KIND_ORDER`, one bullet per page.
  - A project with only 1 page does not get a materialized MOC file (threshold: `>= 2` pages —
    documented as a simple, adjustable constant, not hardcoded inline unexplained).
  - Given an EXISTING file at `moc/<project-slug>.md` containing hand-written prose plus a
    generated fence from a prior run, re-running replaces only the fenced content — hand-written
    prose before/after the fence is byte-identical to the input.
  - Given an existing file with NO fence yet (the two real MOCs' current state today) — **mirrors
    `regenerateIndex`'s own precedent exactly, on reflection, rather than the more conservative
    `needs-migration` flag originally sketched above**: appends a fresh fence at the end, leaving
    every existing line untouched. This is safe on the same grounds `index.md`'s own contract
    already rests on — purely additive, nothing existing can be destroyed by an append — and
    avoids inventing a second, more complex convention for an identical problem this codebase has
    already solved once. Any redundancy between a hand-written bullet (with its rich one-line
    description) and the same page also appearing in the generated fence is the same redundancy
    `index.md` already tolerates between its own catalog and every synthesis/MOC that also
    mentions a page — not a defect to design around.
  - A project with zero pages remaining after some hypothetical future move is out of scope for
    this pass — no deletion logic; matches `index.md`'s generated-fence contract, which has never
    needed to delete a section either.
- [x] Green: implement `scripts/moc-authored-gen.mjs`, dry-run by default, `--apply` to write —
      matching this repo's universal repair-script convention.
- [x] Verify: `node --test test/moc-authored-gen.test.mjs`.

## Task 4 — Monolith-detection signal (Layer 4)

Calibrated directly against the real vault before writing the check, not guessed: word count
`> 3000` **and** `>= 3` matches of a dated-update-callout pattern
(`/\*\*[^*\n]{0,80}(?:Update|Milestone|status updated)[^*\n]{0,80}\(\d{4}-\d{2}-\d{2}/gi`) together
flag exactly one file today (`sparta-migrator-roadmap.md`, 9,529 words / 5 matches) and correctly
spare a second large-but-healthy file (`sparta-scope-roadmap.md`, 5,268 words / 0 matches — long
because it has a lot of current scoped work, not because it never prunes) and a normal file
carrying one isolated, legitimate update note (`sparta-suite-overview.md`, 998 words / 1 match —
under the word floor regardless). Both signals are required together deliberately: word count
alone would false-positive on the scope-roadmap file; the callout pattern alone would not
distinguish "one clarifying note" from "a stack that never stops growing."

- [x] Red: `test/graph.test.mjs` (or a new `test/monolith.test.mjs`) — a synthetic authored page
      built from the calibrated thresholds is flagged; one at 2999 words with 5 matches is not;
      one at 9000 words with 2 matches is not — the AND is load-bearing, tested as such.
- [x] Green: add a `monolithCandidates` metric to `computeGraphMetrics` in `scripts/lib/graph.mjs`,
      alongside `hubStubs` — **reported, never scored**, identical treatment to `hubStubs` and for
      the same reason (§5.4 of the spec: this is a content signal requiring human/agent judgment
      to act on safely, not a structural defect with one correct mechanical fix).
- [x] `scripts/health.mjs` — print `monolithCandidates` in the report, same section style as
      `hub-stubs:` (count + list), explicitly labeled as informational.
- [x] Explicitly out of scope for this pass, noted rather than silently deferred: wiring this into
      `scripts/triage.mjs`'s worklist UI (with a disposition action) the way `hubStubs` already is
      — natural, low-risk follow-up given the precedent is proven, but a second, separable unit of
      work from "detect and report" and not required to satisfy this spec's Layer 4.
- [x] Verify: `node --test test/graph.test.mjs test/health.test.mjs`.

## Task 5 — Backfill script

New `scripts/backfill-authored-metadata.mjs`, dry-run/`--apply`, matching the established
convention exactly.

- [x] Red: `test/backfill-authored-metadata.test.mjs` — covers every rule from spec §8 as its own
      case: filename-prefix → `project:` (including the `sparta-migrator-*`/bare-`sparta-
      migrator.md` and `processing-agent-translation-*` two-tier cases), suffix → `kind:` for each
      recognized suffix, the "bare `<project>.md` opening `# <slug>` / `## Summary`" → `kind:
      overview` rule, the `HCLS-LABS-SS-migrator-package.md` → `reference` exception (same
      structural shape, but its project already has an overview), `sf-cli-local-auth-mechanics.md`
      → `kind: note` with `project:` left unset, and: a page that already carries `project:`/
      `kind:` is left untouched (idempotent, no clobbering a value a human/agent already set).
- [x] Green: implement, writing `project:`/`kind:`/`decision-status:` into frontmatter using the
      same insertion approach as `insertSourceHashes`/`fixSourcesOrder` (anchor on the frontmatter
      block, walk past existing lines, never touch the body).
- [x] Verify: `node --test test/backfill-authored-metadata.test.mjs` — **plan deviation, checked
      against real precedent rather than followed blindly**: neither `repair-sources-order.mjs`
      nor `backfill-source-hashes.mjs` has its own dedicated CLI-level test file — both rely
      entirely on their pure lib-module tests plus a manual dry-run against the real vault. Matched
      that precedent instead: the 23 tests in `test/authored-classify.test.mjs` cover the pure
      `classifyAuthoredProject`/`classifyAuthoredKind`/`classifyDecisionStatus`/
      `insertAuthoredMetadata` functions (using every real filename as a case, not synthetic
      ones), and `node scripts/backfill-authored-metadata.mjs` (dry-run) against the real vault
      confirmed the classification end-to-end — 36 files planned (34 assumed while drafting the
      spec; the real count had grown by 2 in the interim, and every rule still resolved cleanly
      with zero surprises), 34 with both `project:` and `kind:` resolved, 2 with `kind:` only
      (`sf-cli-local-auth-mechanics.md`, by design — no project).

## Task 6 — Skill doc updates

- [x] `skills/wiki-maintainer/SKILL.md` — extend the `wiki/authored/` paragraph: document
      `project:`/`kind:`/`decision-status:`, the `kind:` vocabulary table, and the monolith
      guidance from spec §5.4 — stated as a direct instruction to an authoring agent ("keep a
      roadmap/ADR scoped to current state; trust `git log` as the changelog instead of reproducing
      history in prose"), not a vague house-style aspiration, per spec §7.
- [x] `templates/vault-schema.md` — extend the "Wiki pages" frontmatter contract line to mention
      the three new optional fields for `wiki/authored/`.
- [x] `README.md` — one line if the top-level feature list references `wiki/authored/` already
      (check first; only touch if it does, per surgical-scope discipline).
- [x] Verify: `node --test test/drift-guard.test.mjs` (the wiki-page-contract test) still passes.

## Task 7 — Version, changelog, full suite

- [x] Bump all 5 manifests (`package.json`, `plugin.json`, `.claude-plugin/plugin.json`,
      `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`) — minor bump per this
      repo's convention for a new capability (currently 0.13.0 → 0.14.0).
- [x] `CHANGELOG.md` entry.
- [x] `node --test test/drift-guard.test.mjs` confirms manifest version consistency.
- [x] Full suite: `npm test` — must stay green, no regressions.

## Task 8 — Apply to the real vault

All vault writes via the `obsidian` CLI per this environment's hard guardrail — never direct
file-tool writes to `~/.wiki-master-vault`.

- [ ] Run `node scripts/backfill-authored-metadata.mjs` (dry-run) against the real vault; review
      the plan output against spec §8's predictions before applying.
- [ ] `--apply`; spot-check several pages via `obsidian property:read` to confirm.
- [ ] Run `node scripts/moc-authored-gen.mjs` (dry-run): expect `sparta-suite/migrator` (8 pages,
      currently zero MOC) to generate a fresh file, and both `processing-agent`/`sparta` to append
      a new fence to their existing hand-written files (mirroring `regenerateIndex`'s own
      append-if-missing precedent — see Task 3's corrected design note).
- [ ] `--apply` for all three projects. Read the two migrated files afterward and confirm every
      existing hand-written line (per-bullet descriptions, "Cross-cutting topics", "Related vault
      entities") is byte-identical to before, with the new fence appended cleanly at the end.
- [ ] As an optional, separate polish pass (not required for this to be correct — redundancy
      between the hand-written sections and the generated fence is tolerated, exactly as `index.md`
      tolerates it elsewhere): consider trimming the hand-written bullet-lists in the two migrated
      MOCs that are now fully redundant with the generated fence, keeping only the prose a
      generator cannot produce (per-bullet descriptions, cross-cutting topics, related entities).
- [ ] `node scripts/health.mjs` — confirm `monolithCandidates` reports `sparta-migrator-roadmap.md`
      and nothing else; confirm no new broken links, no provenance regressions (still 0/0 per the
      last full-vault review).
- [ ] `node scripts/index-gen.mjs` — regenerate `index.md` once, at the end, per its own contract.
- [ ] One log entry: `node scripts/log-entry.mjs --op relink --title "..."` summarizing the
      backfill + MOC migration/generation.

## Task 9 — Ship

- [ ] Commit, push, open PR (established `gh auth switch --user ehartye` pattern), verify CI/local
      suite, merge via squash, fast-forward local `main`, restore original `gh` identity, prune the
      remote branch.
