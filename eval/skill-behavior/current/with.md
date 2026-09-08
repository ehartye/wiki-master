# Blind behavior probe with actual skill bodies

This is a simulation transcript. Every action below is an intended action, not an execution. No app, network, Git, helper, or vault command was executed. The only actual work was reading the provided scenario prompts and listed skill files and writing this transcript. Sample responses are hypothetical; placeholders would be replaced only with observed results. I did not read scenarios.json, evaluator files, current/, baseline/, prior traces, tests, or the real vault. No accidental evaluator/rubric context exposure occurred. The discovery skill itself contains its operational source-credibility rubric; that is skill context, not evaluation context.

## offline-author

Simulated intended action trace:
1. Resolve the installed plugin as C:/plugins/wiki-master, independent of C:/work/widget. Set WIKI_MASTER_VAULT to C:/vault for these operations in PowerShell, retaining and finally restoring its previous value. Validate the root and read its AGENTS.md and schema. Apply its explicit stay-on-main, bracket-and-push exception.
2. Since the CLI already timed out, choose filesystem access once. Locate the existing Atlas guide with a bounded wiki/authored/ lookup, read its current content and the relevant Atlas code. Preserve its established filename. Do not invent offline behavior or treat an app outage as a writing blocker.
3. Save the token from `node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op relink` before writing. Check the exit status. Preserve already-dirty and concurrent user content; the helper cannot isolate overlapping edits to the same file.
4. Edit the existing guide in place through its exact path. Explain only offline behavior verified against code. Preserve authored metadata, explicit `sources: []`, and honest AI authorship. Set updated to the operation date, retain reviewed: 2026-08-01 because the entire guide was not reverified, and describe the limited offline-section verification in the operation narrative. Do not append a dated update history to the living guide.
5. Validate the changed section, YAML, project/kind placement and exact links. Run the absolute-path index-gen helper and, if Atlas has at least two authored pages, moc-authored-gen --apply. Inspect generated changes for unrelated projects. Verify the requested guide can be retrieved.
6. Pipe one relink narrative into log-entry.mjs; close with op-commit.mjs --op relink --title 'Document Atlas offline mode' --since the saved token. Check each exit status, the actual committed paths, and semantic refresh notices. Do not stage the entire vault or claim an unavailable semantic backend refreshed successfully.
7. Run `git -C 'C:/vault' push` under the already given publication authorization. Verify its result and the configured upstream state. Retain operation state and report precise remaining work if a step fails; a rejected push is a sync failure, not permission to force.

Sample user-facing response after the hypothetical successful path: “Updated and published the Atlas guide’s offline section, checked against the current code. The guide’s full-review date remains August 1 because I verified only this section. Your laptop can receive the published commit through its normal sync.” Include any actual index-refresh limitation if one occurred.

Stop condition: Changed content, applicable catalogs, one operation log, commit and upstream publication are verified. Do not assert that the laptop itself received the change without observing its sync. On failure, stop the dependent sequence and report the exact local/published state.

## lookup

Simulated intended action trace:
1. Select wiki-search, with shared access/evidence rules. Resolve the configured vault and installed plugin root without scanning the user profile.
2. Run a bounded `search.mjs 'if-then planning' --include-raw --json --limit=10`. Read keyword/semantic diagnostics, per-result freshness, and raw-channel status. If necessary search the canonical wording 'Implementation Intentions' and inspect aliases. Use scoped filesystem search only for unavailable channels, excluding .recycle and unrelated trees.
3. Identify the existing Implementation Intentions concept with equivalent alias If-then planning; read the current matched passage and its exact path/line. Reuse that identity rather than presenting the alias as a second concept.
4. Read the matching raw clipping passage using its returned exact path. If needed, resolve the concept's provenance with resolve-evidence.mjs; verify any excerpt against the actual captured text. Do not invent path names, line numbers or quotations from the scenario facts.
5. Return matching pages and passages, with citation-ready paths/lines and separate raw-evidence labeling. Explain any unavailable retrieval channel without converting zero hits into proof of no knowledge. Do not discover, ingest, synthesize, log, commit or refresh indexes.

Sample user-facing response: “The canonical page is Implementation Intentions; ‘If-then planning’ is its alias. Matches: [actual concept path:line] — [verified passage]; [actual raw clipping path:line] — [verified captured passage]. Nothing was added.” Append a concrete coverage limitation if diagnostics require one.

Stop condition: Relevant existing matches and inspected passages are returned with actual citations and retrieval limitations; the vault remains unchanged.

## freshness

Simulated intended action trace:
1. Select wiki-stale and use the known vault with absolute installed-helper paths. Keep the operation read-only.
2. Run stale.mjs and inspect its backend diagnostic. If the CLI fails, accept its scoped wiki filesystem fallback; a missing wiki directory is an error, not an empty result.
3. Run drift.mjs --coverage, without an embedding evaluation or cache-writing maintenance. Read coverage and failure counts. Inspect current review metadata on bounded, high-use or volatile recommendations to prioritize the report without pretending to fully verify every page.
4. Report the supplied facts distinctly: structural health is 100; there are 40 concepts; 12 lack reviewed and are unverified by that measure. Recent updated dates show edits, not factual review. Report any dated-but-stale pages separately from the 12 missing dates; no stale count was supplied, so obtain it rather than invent one.
5. State drift evaluation coverage as 0 evaluated with 10 failures due to unavailable embedder. Do not equate coverage reporting with completed drift evaluation, infer zero drift, or call the recommendations current from the structural score. Recommend factual review of the most used/volatile pages; do not stamp reviewed or start repairs for a reporting question.

Sample user-facing response: “I can’t confirm the recommendations are current. Structural health is 100, but 12 of 40 concepts have no factual-review date; yesterday’s edits do not establish verification. Drift evaluated zero pages and had 10 failures because the embedder was unavailable. The report lists missing-review pages separately from dated pages needing review, prioritized by use and volatility.”

Stop condition: A read-only report distinguishes factual-review status, structural health, edit dates and drift coverage, with actual page-level priorities and no unsupported clean verdict.

## naming-near-miss

Simulated intended action trace:
1. Treat the request as an application naming decision. Read the relevant schema/model and nearby use sites to establish what each row represents; do not apply wiki page-type naming as an application database rule.
2. Honor the standing wiki-research instruction with a bounded read-only lookup for this application's existing naming or data-model decision, using wiki-search and its diagnostics. Read only relevant matches. No wiki creation, discovery/ingestion or authored ADR is implied by this question.
3. Use existing application meaning: a row describing an underlying document, URL or work naturally fits sources; a row recording one reference to that work from a claim or passage naturally fits citations. If code establishes that distinction, recommend the matching name and cite the actual usage. Existing naming consistency and migration cost also matter. Do not rename anything from an advisory question.
4. If the provided facts and inspected code do not settle what a row means, state the conditional choice and ask for that one missing detail. Do not confidently select a name from the two words alone.

Sample user-facing response when semantics remain unknown: “Use `sources` if each row is a document or other underlying work; use `citations` if each row records a reference from a claim or passage to that work. I’d follow the application’s existing meaning. What does one row represent?”

Stop condition: Give a recommendation grounded in inspected application semantics, or identify the one missing semantic distinction. No wiki or code write occurs.

## authorized-discovery

Simulated intended action trace:
1. Select wiki-discover followed by wiki-ingest for the named successful set. Resolve vault/plugin paths, read vault instructions/schema, and retain the user's explicit discovery, ingestion and publication authorization.
2. State the precise Atlas offline-guide gap after a bounded wiki/MOC lookup and reading the guide. Collect existing source URLs directly from raw/clippings frontmatter, normalize for deduplication, and inspect declined/blocklisted entries. If clippings exist but the URL set is unexpectedly empty, stop and fix collection before searching.
3. Have the five read-only discovery perspectives return candidates, using supported fan-out or sequential lenses when necessary. Supply each with known URLs and already covered material. Each candidate must explain the missing evidence it adds and which page it would change. A separate selection pass checks source authority, topical fit and deduplication. Select no more than two authoritative sources; fewer is acceptable if evidence is insufficient.
4. Open and retain a discover operation token before the first decline or capture write. Use installed clip helpers, consistent --topic, correct source-type routing and quality values. Record required declines through tooling. Preserve raw bodies. Validate exact returned clipping paths, inspect captured evidence for the gap, and record thin, partial or failed captures and triage outcomes. An inaccessible page's summary is not a replacement for captured evidence.
5. Show a concise source list, capture outcomes and what the evidence would change. Log the discovery operation once, finish its commit, inspect index notices, and complete/verify authorized publication before handoff. If there were no writes, do not manufacture a log or commit.
6. Immediately ingest only the successful named clippings; do not ask again. Open a fresh ingest operation token. Read each exact body and source-hash, verify specific claims, and write/update source summaries with quoted exact raw-path wikilinks, source-hashes, valid dates and truthful authorship. Search identity before creating concepts; update only substantively affected pages and task maps. Keep conflicting claims attributed and do not treat capture silence as disproof.
7. Document the supported guide change in the guide's existing page, using authoring rules where original project instructions must change. Check actual application behavior for operational claims; external evidence alone cannot establish Atlas implementation. Preserve the guide's broader reviewed date if only a section was checked. Report an unresolved gap if the evidence does not settle it.
8. Validate YAML, citation/link targets, source hashes and changed claims; refresh affected catalogs and inspect unrelated generated changes. Write one ingest log describing sources and actual knowledge changes, close the ingest operation, inspect committed paths/index notices, and verify authorized push/upstream state. Coordinate any separately owned authoring operation explicitly rather than duplicating ownership.

Sample user-facing response after hypothetical success: “Captured, ingested and published [one/two] authoritative sources. [Actual source links] support [specific verified change] in the Atlas offline guide. [Capture limits or remaining gap, if any].” Do not fill these slots with invented findings.

Stop condition: At most two successful authoritative sources are captured and inspected; their named-set ingestion, documented changes, operation logs/commits and authorized upstream sync are verified. Unsupported guide behavior remains explicitly unresolved, and failed steps are reported precisely.

## discovery-only

Simulated intended action trace:
1. Select wiki-discover. Resolve paths and read vault instructions. Treat the user's review-before-ingestion request as the scope boundary despite the standing general instruction to research and ingest.
2. Read the Atlas guide and relevant existing wiki coverage, name the offline gap, collect known source URLs from clippings, and deduplicate. Stop on inconsistent empty URL collection. Conduct the discovery lenses and independent credibility selection for two relevant sources.
3. Open a discover operation before any decline/clip mutation. Capture selected sources with the correct installed helper and one consistent topic. Preserve original raw bodies, validate exact output paths and inspect each body. Report capture limits and use the pipeline's triage bookkeeping for unresolved sources; never patch the raw text to hide a failed capture.
4. Present the sources, their authority and relevance, actual captured paths, successes/failures and limits. Write one discovery log and finish the capture operation commit before pausing. Inspect commit and index notices; sync only if already authorized by the session or vault instructions. Report local/unpushed status when publication is not authorized.
5. Leave the successful committed clippings available for review. Do not call wiki-ingest, write derived summaries, or modify the guide while waiting for the user's review decision.

Sample user-facing response: “The two sources are clipped and ready for review: [actual title/link/path and capture limitation for each]. The capture operation is committed [and publication state]. I haven’t ingested them or changed the guide. After you review them, should I ingest this named set?”

Stop condition: Authorized capture and its completion contract are finished, evidence is available for review, and ingestion remains paused for the user's decision.

## uncertain-write

Simulated intended action trace:
1. Treat the timeout as an uncertain mutation, not proof that creation failed. Do not call create again or choose a new name. Resolve the known exact target under the vault root and read it through working filesystem access before deciding on any write.
2. Compare current content with the intended Atlas guide. If complete, avoid rewriting it and continue validation. If missing or partial, read surrounding metadata/content and reconcile concurrent user changes before an exact-path minimal edit. Never create a second page.
3. Read vault instructions/schema and recover the existing operation token/ownership from the interrupted action when available. Continue that operation rather than restart it. If no prior token exists, acknowledge the limitation: a new baseline cannot retroactively identify an earlier timed-out write. Open a token before any further mutation, preserve pre-existing dirty paths, and inspect attribution carefully instead of sweeping them into a commit. If the existing guide is excluded as pre-dirty, report this and do not falsely claim the operation committed it.
4. Apply wiki-author rules to any remaining edit: established path, original authored provenance, honest dates, living content and current behavior verification. Validate intended complete content, YAML and links; refresh only applicable catalogs and verify retrieval.
5. Finish the owning operation's one log and commit, checking included and excluded paths and index-refresh notices. Carry out publication if already authorized, otherwise report the precise local/unpushed result. Preserve unresolved operation state if safe attribution or a required validation cannot be completed.

Sample user-facing response after a hypothetical already-complete target is found and completion succeeds: “The timed-out call had already created the guide. I verified that exact page and completed the remaining validation and operation steps without creating a duplicate. [Actual commit/publication state].” If partial, instead describe the minimal reconciled change; do not assert which branch occurred before inspection.

Stop condition: There is one intended guide at the exact target, its content is validated, and applicable operation/publication steps are verified or specifically reported as incomplete. Never blindly retry the uncertain mutation.

## app-only

Simulated intended action trace:
1. Select obsidian-cli and the shared access policy. Classify opening the Atlas workspace and displaying its live graph as app actions.
2. Use the supplied fact that the CLI is unavailable and no UI-control channel exists. Do not repeat failed app probes or execute filesystem writes as a substitute. Ordinary files cannot establish which workspace is open or show a live app graph.
3. Report that specific unavailable capability. A future retry requires a working Obsidian command channel or supported UI control. Offer a file-based relationship view only as a separate possible alternative, not as completed fulfillment, and do not create it unsolicited.

Sample user-facing response: “I can’t open the Atlas workspace or display Obsidian’s live graph in this session: the CLI is unavailable and there’s no app UI control. File access is working, but it can’t perform those app actions.”

Stop condition: Report the app-only blocker accurately. No fabricated app success, no app retry loop, and no substitute vault mutation.

## Files loaded

Scenario input: C:/Users/ehart/repos/wiki-master-skills/eval/skill-behavior/prompts.json

Actual skill bodies, all under C:/Users/ehart/repos/wiki-master-skills/skills/:
- wiki-maintainer/SKILL.md
- wiki-author/SKILL.md
- wiki-search/SKILL.md
- wiki-stale/SKILL.md
- wiki-discover/SKILL.md
- wiki-ingest/SKILL.md
- obsidian-cli/SKILL.md

Directly relevant references, all under C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/:
- access.md
- operations.md
- authoring.md
- evidence.md
- efficacy.md
- maintenance.md

No helper commands were run to test these simulated actions, and no self-grading was performed.
