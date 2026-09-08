# Keeping knowledge findable and trustworthy

Use this contract when creating concepts, linking topics, discovering sources or reviewing answers. The schema stays small; explanatory prose supplies the nuance.

## Concept identity

Before creating a concept, search its intended title, common alternative wording, and the nearest existing concepts. Choose explicitly: extend the canonical page, add an equivalent alias, or create a distinct concept with a scope boundary. Run `node "<absolute-plugin-root>/scripts/identity-audit.mjs" --json` from the plugin root when ambiguity is suspected. Never merge based on embedding similarity alone.

Use `aliases: ["equivalent phrase"]` and a one-sentence `scope:` on concept pages. Aliases name the same concept; broader, narrower and complementary concepts remain separate pages. Use full-path wikilinks for ambiguous names. A source page and a concept may legitimately share a basename; a warning is a review queue, not permission to rename everything.

## Relationships and citations

Keep citations in `sources:` and in the prose they support. Citation targets point to `wiki/sources/` or `raw/`, using full paths when needed. A source page must identify its own raw clipping. Reachable evidence establishes a citation route, not that a claim is true or entailed by it.

Put navigation in `## Relationships` or `Related:`. Use a small role vocabulary: **broader**, **narrower**, **prerequisite**, **complements**, **alternative**, **contrasts**, **applies-to**. Each link needs a sentence explaining the relationship and its limits. For example: `Complements [[wiki/concepts/Intention-Action Gap.md|Intention–Action Gap]]: this intervention addresses a gap between intending and acting under the conditions described above.` Do not turn similar wording into a causal claim. Clearly label cross-source interpretations as synthesis; retain their supporting citations outside the navigation section.

Run `node "<absolute-plugin-root>/scripts/relationships.mjs" --limit=10 --json` to generate candidates. Shared sources and semantic neighbors are reasons to inspect, never proof of a relationship. Review both pages and their evidence; accept only links with a useful explanation. Reuse existing user authorization for the requested relink scope. Do not grow links merely to improve a graph score.

## Task maps and discovery

Curated `moc/` maps answer a recurring task: where to start, prerequisites, competing approaches, complementary domains, and unresolved questions. Keep generated project catalogs as a section or separate linked page. Search indexes both wiki pages and MOCs. Maintain a few useful maps instead of a universal taxonomy.

Discovery starts with an unanswered question and bounded search of the existing wiki/MOCs. Each candidate source must state what evidence it adds and which existing or proposed concept/synthesis it changes. Deduplicate source URLs as before. Read the manual Start here section of `index.md` only if needed; never load its generated catalog as the default coverage summary. Promote high-use stubs and missing bridges when their current evidence is sufficient; do not pad stubs or enforce a source:synthesis ratio.

## Verification and maintenance cadence

- **Each ingest or substantive edit:** check identity and citation paths, update the affected task map, refresh the index through the operation helper. Update `updated` for edits; set `reviewed` only after checking factual claims against evidence or project behavior.
- **Each requested maintenance pass:** inspect structural defects, then sample changed/high-use pages even if the structural score is perfect. Run drift coverage first; choose a bounded sample for embeddings and claim inspection. Record evaluated, skipped and failed counts, plus document/chunk sampling coverage. Long documents are sampled; a page counted as evaluated is not an exhaustive factual review.
- **Weekly when actively growing:** review up to ten relationship candidates, high-demand stubs and discovery gaps. This is a workflow cadence, not an installed scheduler.
- **After search/schema changes and periodically as vocabulary evolves:** run the retrieval regression set, inspect development failures, then measure held-out queries without tuning to them. Keep results by category rather than one misleading health score.

`reviewed` means factual verification; `updated` means edited; search index freshness means the indexed file version matches the file. None substitutes for the others. Missing review dates remain unverified. Cosine drift is a topical diagnostic, not a truth or contradiction detector. A zero-evaluated run cannot justify saying the wiki has no drift.

Read `docs/wiki-efficacy.md` in the plugin root for command contracts and evaluation examples.
