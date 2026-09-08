# Wiki efficacy

Status: approved by the user's request to implement all five recommendations in the 2026-09-07 review.

## Outcomes

1. A reproducible 30–50 question retrieval evaluation, with development/held-out splits, measures canonical-page recall, top-three relevance, expected passages/evidence, result cost and latency. Search prioritizes exact titles/aliases, exposes bounded metadata/passages and scope/state controls, and discloses stale indexed results.
2. Canonical concepts have meaningful scope and equivalent aliases. Graph, evidence and search resolve the same aliases; ambiguous aliases are reported instead of silently merged. A read-only identity audit detects duplicate names/aliases and malformed page placement. Ingest checks existing candidates before adding concepts.
3. Evidence traversal follows declared citations and legitimate inline links toward source/raw pages only, never sideways through concepts or through Related/Relationships sections. Explicit citation routes distinguish direct/transitive support. A bounded relationship candidate tool uses shared sources and semantic neighbors, records reasons, and never applies speculative links. Accepted relationships have a role and an explanatory sentence; overlap is not identity.
4. MOCs are indexed. Task maps route recurring questions through prerequisites, alternatives, complementary domains and evidence. Discovery starts with bounded coverage and explicit gaps, not the full catalog. Pilot maps cover wiki/agent knowledge and learning/behavior, reusing existing pages.
5. Drift uses shared source parsing/resolution and reports eligible/evaluated/failed/skipped counts. Zero evaluation cannot claim success. Factual review dates survive mechanical edits; stale checks distinguish missing verification. Clean structural health does not suppress semantic sampling.

## Architecture and constraints

Keep the dependency-free Node/Markdown/Ollama stack and existing text CLI compatibility. Extend current graph/search functions rather than add a service, database or wholesale taxonomy. Frontmatter support must cover the vault's quoted inline and block lists. A shared note parser supplies sources, aliases and retrieval metadata. Source evidence is not claim entailment; diagnostics must say so. Normalized full paths stay the unambiguous identity; no bulk renames/merges. Raw bodies remain immutable. Derived indexes can rebuild.

## Verification

Existing fixture suite baseline: 931 passed, 1 skipped, no failures (932 total). Every behavior fix starts with a failing real-shape fixture. Integration includes exact aliases, ambiguous names, lateral-evidence rejection, inline/block sources, modified/deleted indexed hits, MOC retrieval, and edits that leave reviewed unchanged. Run the live retrieval set before and after using a frozen query set; report per-category and held-out results without claiming generality. Audit and repair pilot vault pages with evidence, then refresh index and verify links. Repository work remains on feat/wiki-efficacy; vault operations follow the vault's operation tracking and local sync contract.

## Delivery

Ship code, templates, skills, benchmark and user/developer documentation together. Record actual implementation and validation in the wiki; distinguish branch implementation from installed/released behavior. No automatic semantic merges, generic link inflation, scheduled service, or replacement search backend.
