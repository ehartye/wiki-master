# Answer with citations

This workflow synthesizes a response from retrieved passages and never files it.
Read [evidence](../../wiki-maintainer/references/evidence.md) before quoting or
synthesizing. Use [advanced retrieval](advanced.md) when scope, raw evidence or
provenance traversal is needed; the main [simple search](../SKILL.md#simple-search)
procedure suffices for ordinary lookup.

1. Run bounded searches for the question and useful alternative wording. Include
   raw only when the question calls for evidence that may be unprocessed. Read
   channel diagnostics and disclose degraded or failed coverage, including the
   raw count when successfully searched.
2. Open canonical pages, relevant alternatives and supporting evidence. Inspect
   factual review dates, page scope and decision/backlog states. A proposed ADR
   or planned feature is not current behavior. Verify citation routes with
   `node "<absolute-plugin-root>/scripts/resolve-evidence.mjs" "wiki/sources/Example.md:23"`,
   then read the resolved raw passage; a reachable route alone proves no claim.
3. For cross-topic questions, use [identity and relationships](../../wiki-maintainer/references/efficacy.md)
   and verify explained relationships against evidence. Similar neighbors are not
   causal evidence. Label connections inferred across sources as the wiki's synthesis.
4. Write a cited answer distinguishing established source claims, disagreement,
   unsupported claims and inference. Preserve restrictions when reusing summaries.
   Place Reddit-derived claims under `## Reddit discussion (anecdotal)` and
   Medium-derived material under `## Medium articles`, outside the opening summary,
   main factual sections and recommendations. Independently supported facts may
   use their higher-quality citations in the main answer.
5. Report what the searches did and did not cover. A clipping's silence establishes
   “not supported here,” never “false.” Disclose partial capture or uncertain
   character fidelity before quoting. Do not transform a zero-hit result into a
   claim that no relevant knowledge exists.

**Done:** the answer has usable path/line citations to passages actually opened,
source claims and inference are distinguished, and vault files remain unchanged.

If the user explicitly authorizes filing, hand original documentation to
[wiki-project](../../wiki-project/SKILL.md) or a provenance-derived synthesis to
[maintainer synthesis filing](../../wiki-maintainer/references/synthesis-filing.md).
The receiving writer owns the operation; answering alone never opens one.
