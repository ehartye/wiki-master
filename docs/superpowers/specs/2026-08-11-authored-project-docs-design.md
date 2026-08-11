# `wiki/authored/` — a project-documentation pattern — Design Spec

**Date:** 2026-08-11
**Status:** Proposed
**Author:** Design conversation with @Eric-Hartye_HON

---

## 1. Summary

`wiki/authored/` (added 2026-07-22, v0.6.0) gave the vault a place for original, no-provenance
content. It has no structure beyond a flat folder and a shared `type: authored`. Three weeks and
34 files later, two real projects have organically formed inside it — visible only as a string
baked into each filename, invisible to every piece of tooling that reads frontmatter. This spec
adds the metadata and generation this needs: a `project:`/`kind:` frontmatter pair, a generated
per-project MOC, and a soft signal against the one failure mode metadata alone can't fix — a
single file growing without bound.

**Load-bearing context for this design**: the authors of `wiki/authored/` pages are coding agents,
not humans typing into Obsidian. Every recommendation below is chosen for what an agent reliably
does *without cross-session memory* of the file it's about to touch, not for what a human would
notice on a good day. This distinction changes real decisions below (§6.4, §7) — it is not
incidental framing.

## 2. What exists today

Confirmed by reading all 34 files in `wiki/authored/` directly (not sampled):

- **Frontmatter is completely uniform.** Every page: `type: authored`, `created`, `updated`,
  `reviewed`, `status`, `sources: []`, `ai-generated: true`. Nothing records which project a page
  belongs to or what kind of document it is.
- **Two projects have organically formed, one of them two levels deep**, distinguished only by a
  string prefix in the filename:
  - `processing-agent-*` (18 files), including a `processing-agent-translation-*` sub-cluster
    (5 files) — a sub-feature that reads as a sibling in a flat listing.
  - `sparta-*` (9 files) with a `sparta-migrator-*` sub-project (7 files: overview, roadmap, two
    ADRs, gap-analysis, user-journeys, a redesign doc) plus a sibling-repo note
    (`HCLS-LABS-SS-migrator-package.md`) and one standalone research note
    (`sf-cli-local-auth-mechanics.md`) that belongs to neither by name.
- **A document-kind taxonomy is converging without being designed.** Recurring, unprompted,
  across both projects: an *overview*, an *architecture* doc (with its diagrams organically split
  into a companion file — confirmed three times independently: `processing-agent-architecture-
  diagrams`, `processing-agent-process-diagrams`, `processing-agent-translation-diagrams`), one
  *guide* per audience (user/administrator/developer), a *reference* doc (configuration, skills),
  and — twice now, unprompted — a genuine **ADR** (Status/Context/Decision/Consequences), just
  without a real status field (see §6.2).
- **The generated catalog cannot cope.** `index.md`'s `## Authored` section
  (`scripts/index-gen.mjs`) is one flat, alphabetically-sorted list of all 34 pages. It was
  readable at the 20 files it had after the original design; at 34 and climbing it is not, and it
  gets strictly worse every time either project grows.
- **Hand-maintained MOCs exist specifically to compensate, and are already straining.**
  `moc/processing-agent.md` and `moc/sparta-suite.md` were built by a previous session as a
  workaround for the flat catalog. `moc/processing-agent.md` already had to improvise an ad hoc
  "Per-skill deep dives" sub-heading to fit the translation cluster in — the single-level MOC
  pattern has already needed a second level once. `sparta-migrator`'s 7 satellite docs have **no
  MOC at all**; `sparta-migrator.md`'s own "## Links" footer is doing that job, on the overview
  page itself, growing the overview's own word count to carry it.
- **One file has become a live monolith.** `sparta-migrator-roadmap.md` — 9,542 words, 1,233
  lines — mixes four concerns in one continuously-appended file: forward roadmap, retroactive
  changelog, emoji-tagged live status per item (✅ SHIPPED / 📐 DESIGN SPEC COMPLETE / 🚧 in
  progress), and a running self-correction commentary ("Note for accuracy: ... these were not
  reported as shipped"). Reading "what is the current state of item X" requires reading every
  stacked update about it in chronological order, because nothing is ever removed, only appended
  to.

## 3. Prior art

Three grounded precedents, one of them this repo's own recent work on a shape-identical problem:

- **This repo's own triage topic-grouping** (`docs/superpowers/specs/2026-08-10-triage-topic-
  grouping-design.md`, shipped 0.13.0). Same diagnosis — a flat list, grouped only by an axis
  (`kind`) that doesn't match how a person actually approaches it — solved with a frontmatter
  field (`topic:`), a pure normalize/resolve/group module (`scripts/lib/topic.mjs`), and a
  **filter over the existing structure rather than a physical reorganization**, with an explicit
  "what this does not do" section refusing to invent taxonomy or hierarchy ahead of need. This
  spec follows the same shape deliberately, not by coincidence.
- **[Diátaxis](https://diataxis.fr/)** — a systematic four-genre content taxonomy (tutorial,
  how-to guide, reference, explanation), explicitly organized by metadata/naming convention, not
  by physical folder structure. The organically-emerged doc kinds in `wiki/authored/` map onto
  this cleanly (guides = how-to; configuration/skills = reference; architecture/overview =
  explanation), with two genres Diátaxis doesn't cover that are independently well-established:
- **The Nygard ADR pattern** ([Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions),
  2011) — the standard shape the vault's two existing ADRs already converged on unprompted. Its
  own founding rationale is the exact diagnosis for §2's monolith: *"Large documents are never
  kept up to date... small, modular documents have at least a chance at being updated."* Nygard's
  pattern also supplies the piece the vault's ADRs are missing: a **controlled status vocabulary**
  (proposed / accepted / superseded / deprecated) as data, not prose under a `## Status` heading.

## 4. Decision: metadata over physical restructuring

Considered and rejected: `wiki/authored/<project>/<doc>.md` folder nesting.

Checked directly against this codebase's own logic before deciding, not assumed: every
`wiki/authored/` path check in `graph.mjs` and `lint.mjs` uses `path.startsWith('wiki/authored/')`,
never an exact match — so nested folders are **not blocked** by anything today and remain a valid
future option. But it is rejected for this pass:

- It doesn't solve the grouping problem by itself — you still want `kind:` metadata to order a
  project's docs sensibly (overview first, roadmap last), so a folder move is additive cost, not
  a substitute for the frontmatter layer.
- It is a materially larger, riskier change (`git mv` on 34 files, checking every path-qualified
  reference) for the same end-user payoff a frontmatter field gets far more cheaply — and this
  repo just chose the cheaper path for an identically-shaped problem (§3).
- Neither Diátaxis nor Nygard's ADR canon requires physical hierarchy; both are organized by
  metadata and generated/hand-written indexes. Frontmatter-first is not a compromise against
  either cited standard.

**Decision: add frontmatter fields; generate navigation from them; leave physical layout flat.**
Folder nesting stays available later, never required.

## 5. Design: four additive layers

### 5.1 Layer 1 — `project:` frontmatter

Free-text, normalized exactly like `topic:` (trim, collapse whitespace, case-insensitive key,
first-seen casing for display) — reusing `normalizeTopic`'s proven shape rather than inventing new
rules. Supports an optional `/`-separated tier for a sub-project (`sparta/migrator`,
`processing-agent/translation`) — written, never enforced past one level; nothing in this vault
needs a third tier today and inventing headroom for one is exactly the ahead-of-need complexity
§3's own cited precedent explicitly refuses.

Every existing file's `project:` is mechanically, deterministically inferable from its current
filename prefix (see §8) — unlike `topic:`'s backfill, which its own spec correctly declined
because no reliable join existed. Here the join is exact: the filename prefix that establishes the
grouping today becomes the frontmatter value tomorrow. Backfilling it is a straightforward
correction, not a guess.

### 5.2 Layer 2 — `kind:` frontmatter (+ `decision-status:` for ADRs)

A small, closed-but-escapable vocabulary, derived from what is already recurring (§2), not
designed in the abstract:

| `kind:` | What it marks | Live examples |
|---|---|---|
| `overview` | A project's front door | `processing-agent-overview`, `sparta-migrator` |
| `architecture` | System structure/design | `processing-agent-architecture` |
| `guide` | Audience-scoped how-to | `*-user-guide`, `*-administrator-guide`, `*-developer-guide` |
| `reference` | Durable factual lookup | `*-configuration`, `*-skills` |
| `diagram` | A diagrams-only companion page | `*-architecture-diagrams`, `*-process-diagrams` |
| `decision` | An ADR | `sparta-migrator-sf-cli-removal-adr` |
| `roadmap` | A living backlog/plan | `sparta-migrator-roadmap` |
| `note` | Anything that doesn't fit above | `sf-cli-local-auth-mechanics` |

`note` is the deliberate escape hatch — the vocabulary must never block authoring something that
doesn't fit it. `kind: decision` pages additionally carry `decision-status:` with Nygard's own
vocabulary (`proposed | accepted | superseded | deprecated`) — turning "is this decision still
live" into a queryable fact instead of prose an agent has to re-read and re-summarize (both
existing ADRs currently say "Decided, done, and verified" or similar in their own words; neither
is machine-readable).

Not enforced as a closed set at write time. `/wiki-lint` surfaces (never scores — the hub-stubs
precedent, §5.4) a `kind:` outside the vocabulary or a `kind: decision` page missing
`decision-status:`, exactly the "report, don't gate" treatment this repo already gives every soft
content signal.

### 5.3 Layer 3 — generated per-project MOC

For every distinct `project:` value with enough pages to be worth a hub, generate a fenced section
inside `moc/<project-slug>.md`, grouping that project's authored pages by `kind:` in a fixed order
(overview → architecture → reference → guide → diagram → decision → roadmap → note), never
alphabetical or filesystem order — this repo has shipped filesystem-iteration-order bugs before
(`test/drift-guard.test.mjs`'s NUL-byte test cites one directly) and the topic-grouping spec names
the same discipline (§5, that spec).

The fence is the exact contract `index.md` already uses: `%% BEGIN/END GENERATED CATALOG %%` (or a
distinctly-named equivalent, scoped per-project so it can't collide with a whole-vault regen),
content between the markers regenerated in full and rewritten by atomic rename, everything outside
it preserved verbatim. This is the mechanism that resolves the actual tension in §2: the two
existing hand-written MOCs already contain real, valuable prose ("Cross-cutting topics", "Related
vault entities") that a generator cannot invent and must not discard — only their listing sections
(which a human is currently hand-keeping in sync with the filesystem, and which already drifted
once — sparta-migrator has none) become generated.

### 5.4 Layer 4 — a detectable signal against the monolith, not a house-style hope

This is the layer §1's framing note bears on directly. A human maintainer might eventually notice
"this file is huge, I should split it." An agent, invoked to add one more update to
`sparta-migrator-roadmap.md`, sees only the instruction "update the roadmap" and the file as it
exists *in that turn* — it has no standing memory that this is the twentieth such append, and
appending is structurally the lowest-friction action available. That is not a hypothetical: it is
the exact, literal shape of the file today. Prose guidance in a skill doc competes with whatever
task-specific instruction brought the agent to the file in the first place, and loses by default.

So this layer is a **signal**, not a hope: `/wiki-lint` gains a check (reported, never scored — the
same treatment `hubStubs` already gets, for the same reason: the guardrail forbids the fast fix,
since splitting a live roadmap correctly requires judgment a lint rule can't supply) that flags an
authored page which is unusually large (a word-count floor, high enough that no current legitimate
page not already showing the symptom trips it) **and** carries more than a couple of dated
`## Status`-adjacent update blocks on what reads as the same tracked item. `wiki-maintainer`
SKILL.md's authored-pages section states the split guidance explicitly and directly: keep a
roadmap/ADR scoped to current state; trust `git log`/`git blame` as the changelog instead of
reproducing history in prose; move a genuinely large "shipped" backlog into the project's own MOC
as a dedicated appendix once flagged.

## 6. What this does not do

Mirroring the discipline §3's own cited precedent sets, deliberately:

1. **No mandatory folder restructuring.** §4.
2. **No enforced/closed `kind:` vocabulary.** Unset or unrecognized degrades to ungrouped/"Other",
   exactly like `topic:`'s "Unattributed" bucket — never a write-time block.
3. **No change to the provenance mechanism.** `sources: []` is untouched; this is a navigation/
   grouping layer only.
4. **No automatic back-fill of `kind:`.** Unlike `project:` (§5.1), `kind:` is not always cleanly
   inferable from a bare filename with full confidence (is `sparta-scope.md` an overview or a
   reference?). The backfill script (§8) infers `kind:` only where a filename suffix names it
   unambiguously, and leaves the small remainder unset for a human/agent to set on next touch
   rather than guess and risk a wrong, silently-misleading label — the same "wrong is worse than
   none" principle the topic-grouping spec states outright for its own resolution order.
5. **No auto-splitting of the monolith.** §5.4 detects and surfaces; it does not attempt to
   mechanically rewrite a 9,500-word live document — that judgment call stays with whoever (human
   or agent) next has the full context to make it safely.

## 7. Why this framing changed the design, not just the prose

Restated because it is easy to read past: every layer above was chosen with "what does an agent
reliably do without session-crossing memory" as a hard constraint, not a nice-to-have. Concretely:

- Layer 1/2's vocabulary stays small and self-evident specifically so an agent authoring a brand
  new page can pick a value correctly from the template alone, without needing to have read this
  whole spec.
- Layer 3 is generated, not hand-maintained, because §2 already shows hand-maintenance failing —
  not slowly degrading, but never happening at all for `sparta-migrator`.
- Layer 4 is a lint signal, not a skill-doc paragraph, because a paragraph competes with whatever
  task brought the agent to the file and has no mechanism to win that competition.

## 8. Backfill plan (existing 34 files)

Deterministic, mechanical, one-time — matching this repo's established `--apply`/dry-run repair
script convention (`backfill-source-hashes.mjs`, `repair-provenance-links.mjs`,
`repair-sources-order.mjs`). Verified against all 34 real files before writing this, not assumed:

- `project:` — inferred from filename prefix for 33 of 34 files (`sparta-migrator-*` and the bare
  `sparta-migrator.md` → `sparta/migrator`; `processing-agent-translation-*` →
  `processing-agent/translation`; `sparta-*` otherwise → `sparta`; `processing-agent-*` otherwise
  → `processing-agent`; `HCLS-LABS-SS-migrator-package.md` → `sparta/migrator` per its own body
  text naming it a sibling repo of `sparta-migrator`). Left unset on exactly one file:
  `sf-cli-local-auth-mechanics.md` — cross-cutting research, not one project's document, by its
  own content.
- `kind:` — inferred from an unambiguous filename suffix where one exists (`-architecture-
  diagrams`/`-process-diagrams`/`-diagrams` → `diagram`, `-*-guide` → `guide`, `-configuration`/
  `-skills`/`-llm-integration`/`-lwc`/`-build-test`/`-dashboards`/`-gap-analysis`/`-user-journeys`/
  `-mission-control-redesign` → `reference`, `-adr` → `decision` (+ `decision-status:` read from
  each ADR's own `## Status` prose), `-roadmap` → `roadmap`, `-overview` → `overview`).

  For the remaining bare `<project-name>.md` files with no doc-kind suffix — checked directly, not
  assumed: **every one of them opens `# <slug>` immediately followed by `## Summary`**, the
  identical shape confirmed by reading `sparta-migrator.md` in full (§2), which is unambiguously
  that project's own overview page. This is not a guess extended from one example: it holds for
  all seven (`sparta-governance`, `sparta-ideas`, `sparta-siop`, `sparta-spartanet`, `sparta-
  usage-tracker`, `sparta-scope`, `sparta-platform`) plus `sparta-migrator.md` itself — each is the
  front-door overview of its own suite application, named directly after it rather than suffixed
  `-overview`. All eight backfill to `kind: overview`.

  The one file this rule doesn't reach cleanly is `HCLS-LABS-SS-migrator-package.md` — it matches
  the same opening shape, but `sparta/migrator` already has its overview (`sparta-migrator.md`
  itself), and its content (a supporting artifact of that project, not a front door to it) reads
  as `reference` rather than a second overview. Backfills to `kind: reference`.

  Net result: **`kind:` resolves for all 34 files**, `project:` for 33 of 34 — a materially
  cleaner outcome than assuming ambiguity without checking. `sf-cli-local-auth-mechanics.md`
  backfills to `kind: note` (project-less by its own content, and `note` is precisely the escape
  hatch for a page that doesn't belong to one project's doc set) — the only field genuinely left
  to a human/agent call is its `project:`, if one is ever assigned.
