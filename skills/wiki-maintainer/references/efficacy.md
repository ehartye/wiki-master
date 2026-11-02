# Keeping knowledge findable and trustworthy

Use this contract when creating concepts, linking topics, discovering sources or reviewing answers. The schema stays small; explanatory prose supplies the nuance.

## Concept identity

Before creating a concept, search its intended title, common alternative wording, and the nearest existing concepts. Choose explicitly: extend the canonical page, add an equivalent alias, or create a distinct concept with a scope boundary. Use the direct [identity check](../../wiki-setup/references/checks.md#identity-and-relationship-checks) when ambiguity is suspected. Never merge based on embedding similarity alone.

Use `aliases: ["equivalent phrase"]` and a one-sentence `scope:` on concept pages. Aliases name the same concept; broader, narrower and complementary concepts remain separate pages. Use full-path wikilinks for ambiguous names. A source page and a concept may legitimately share a basename; a warning is a review queue, not permission to rename everything.

Two rules decide a bare name before it counts as ambiguous. A file whose own name equals the link outranks files that only share that name as a `title:` or alias (a site that serves a case's syllabus and opinion under one title gives two clippings one title; the clipping named for the link is the one Obsidian opens). And in navigation a project's generated hub MOC (`moc/<project>.md`) yields to a page of the same name, so a bare `[[<project>]]` reaches the entity page; the MOC is still reached by `[[moc/<project>]]`. Two files with the same name stay ambiguous. After a refresh scoped to one project, the result's `staleCatalogs` names other projects' generated catalogs whose bare link your new pages made ambiguous; refresh each named project.

## Relationships and citations

Keep citations in `sources:` and in the prose they support. Citation targets point to `wiki/sources/` or `raw/`, using full paths when needed. A source page must identify its own raw clipping. Reachable evidence establishes a citation route, not that a claim is true or entailed by it.

Put navigation in `## Relationships` or `Related:`. Use a small role vocabulary: **broader**, **narrower**, **prerequisite**, **complements**, **alternative**, **contrasts**, **applies-to**. Each link needs a sentence explaining the relationship and its limits. For example: `Complements [[wiki/concepts/Intention-Action Gap.md|Intention–Action Gap]]: this intervention addresses a gap between intending and acting under the conditions described above.` Do not turn similar wording into a causal claim. Clearly label cross-source interpretations as synthesis; retain their supporting citations outside the navigation section.

Run `node "<absolute-plugin-root>/scripts/relationships.mjs" --limit=10 --json` to generate candidates. Shared sources and semantic neighbors are reasons to inspect, never proof of a relationship. Review both pages and their evidence; accept only links with a useful explanation. Reuse existing user authorization for the requested relink scope. Do not grow links merely to improve a graph score.

## Task maps and discovery

Curated `moc/` maps answer a recurring task: where to start, prerequisites, competing approaches, complementary domains, and unresolved questions. Keep generated project catalogs as a section or separate linked page. Search indexes both wiki pages and MOCs. Maintain a few useful maps instead of a universal taxonomy.

Discovery starts with an unanswered question and bounded search of the existing wiki/MOCs. Each candidate source must state what evidence it adds and which existing or proposed concept/synthesis it changes. Deduplicate source URLs as before. Read the manual Start here section of `index.md` only if needed; never load its generated catalog as the default coverage summary. Promote high-use stubs and missing bridges when their current evidence is sufficient; do not pad stubs or enforce a source:synthesis ratio.

## Verification obligations

Each ingest or substantive edit verifies identity and citation paths, updates the
affected task map, and completes the operation. `reviewed` means factual claims
were checked; `updated` means edited; index freshness is a file-version match.
None substitutes for another. Mechanical edits preserve `reviewed`.
Use [checks and cadence](../../wiki-setup/references/checks.md#verification-cadence)
for diagnostic procedures and bounded maintenance evaluation.
