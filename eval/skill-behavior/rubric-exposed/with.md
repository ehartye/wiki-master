# Simulated behavior traces with rewritten skills

These are proposed actions, not execution evidence. No vault, app, network, or Git actions were executed. Paths and result fields not supplied by the fixtures would be resolved during the proposed workflow; no source titles, passages, line numbers, or successful tool outcomes are fabricated below. Sample completion responses apply only after their listed checks succeed.

Limitation: the initial read of scenarios.json exposed the observer fields alongside prompt and facts. I did not use those fields to compose or score the traces. I then read prompts.json and used its prompt/facts pairs. This run therefore is not a fully blinded probe.

## 1. offline-author

Action trace:
1. Announce use of wiki-author and the shared maintenance rules. Resolve this operation specifically to C:/vault and helpers to C:/plugins/wiki-master, regardless of C:/work/widget. In PowerShell save the previous WIKI_MASTER_VAULT, set it to C:/vault inside try/finally, and restore it afterward.
2. Read the vault's AGENTS.md and schema at the known root. Follow the supplied vault exception: remain on main. Inspect Git status and find the existing Atlas guide with bounded searches under wiki/authored/atlas and the relevant MOC; preserve its established filename.
3. The CLI timeout is already known. Read and edit the exact Markdown path through the filesystem. Read the existing guide before editing and reconcile any concurrent change. Use the supplied verification of the offline section, with actual code references during a real run; do not infer unprovided offline behavior.
4. Open and retain the operation: $wikiOpToken = node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op relink. Check its exit status before writing.
5. Revise the guide's living instructions in place. Keep original authored metadata, sources: [], and honest authorship. Set updated to the edit date. Preserve reviewed: 2026-08-01 because checking the new offline section does not verify the whole guide; record that limited verification in the operation narrative.
6. Parse frontmatter, confirm canonical placement and exact links, reread the offline section against the checked behavior, and inspect the scoped diff. Run node 'C:/plugins/wiki-master/scripts/index-gen.mjs'; run moc-authored-gen.mjs --apply if Atlas has at least two authored pages. Inspect generated changes for unrelated projects and preserve user changes. Check that a bounded Atlas offline search retrieves the new passage, disclosing unavailable search channels.
7. Pipe one concise narrative to log-entry.mjs --op relink --title 'Atlas offline guide'. Close with node 'C:/plugins/wiki-master/scripts/op-commit.mjs' --op relink --title 'Atlas offline guide' --since $wikiOpToken. Check exit status, actual committed paths, exclusions, and index-refresh notices. Do not stage the whole vault or count an excluded dirty guide as published.
8. Run git -C 'C:/vault' push under the existing publication authorization. Check the push result and upstream relationship, for example git -C 'C:/vault' rev-list --left-right --count 'HEAD...@{upstream}', with a fresh remote check as needed. Verify the operation commit reached the configured upstream. Do not force a rejected push.

User response after successful checks: “Updated the Atlas user guide with the checked offline behavior and pushed the change. Your laptop can receive it from the remote. The guide's review date remains August 1; only the new section was verified.”

Stop condition: the exact guide and affected catalogs are validated, the operation log and commit are verified, and the remote contains that commit. This establishes remote availability, not that the laptop has already pulled it. A failed write, excluded target, commit failure, or rejected push is reported with the retained token and remaining work.

## 2. lookup

Action trace:
1. Use wiki-search and the shared read-only access/evidence rules. Resolve the known/configured vault and installed helper root.
2. Run the absolute search.mjs helper for 'if-then planning' with --include-raw --json --limit=10. Inspect all channel diagnostics and per-result freshness, including the raw channel. Also search the canonical title Implementation Intentions if needed.
3. Read the canonical Implementation Intentions page at the returned matching lines and confirm the If-then planning alias. Follow its exact evidence path or use resolve-evidence.mjs, and read the corresponding clipping passages. Alias identity avoids treating the phrase as a missing separate concept.
4. If a search backend is unavailable, perform bounded filesystem rg searches over wiki/ and moc/, plus raw/clippings/ for this evidence lookup. Exclude recycled and unrelated directories; disclose the reduced coverage.
5. Return the actual matching page paths, line numbers, and short relevant passages. Do not turn retrieval into a synthesized theory answer. There are no writes, operation tokens, logs, index refreshes, new discovery, ingestion, or save offer.

User response: “The canonical page is Implementation Intentions, which lists If-then planning as an alias. Here are the matching passages from that page and its raw clipping: [actual paths, lines, and excerpts obtained in step 3].” Append any actual search coverage limitation.

Stop condition: current matching passages and exact citations have been returned, with search limitations stated. No changes were made.

## 3. freshness

Action trace:
1. Use wiki-stale with maintenance access and verification guidance. Resolve the vault and operate read-only through available filesystem access.
2. Run the absolute stale.mjs helper and inspect its CLI/filesystem diagnostic. Use its scoped filesystem fallback if the app query fails; distinguish a missing vault root from an empty result.
3. Run drift.mjs --coverage. Do not initiate embedding maintenance, cache-writing evaluation, or index regeneration for this report.
4. Separate pages with missing reviewed values from pages whose recorded review dates are old. The fixture identifies 12 of 40 concepts with no factual-review record; yesterday's edits do not repair this.
5. Report the supplied drift run as zero evaluated and ten failed because the embedding backend was unavailable. If current coverage output has additional skipped/page/chunk counts, report them accurately. Do not translate zero successful evaluations into “no drift.”
6. Inspect a bounded sample of high-use or volatile recommendations, including missing-review and recently edited pages. Follow their source routes and compare the current wording with the captured evidence; check dates and claim support. Report each sampled result separately from the unsampled wiki. Captured support alone cannot establish that a volatile external recommendation is still current; identify any needed present-day verification.
7. Return a prioritized factual-review list and the limits of the evidence. Do not change reviewed or other content metadata.

User response: “I can't confirm the recommendations are current. Twelve of 40 concepts have no recorded factual review. Structural health is 100, but that measures the graph; the drift run evaluated no pages and failed on ten because the embedder was unavailable. Recent edits are not factual checks. [Add the specific findings and citations from the inspected sample.]”

Stop condition: missing and aging review records, diagnostic coverage, and bounded evidence findings are reported. The result must leave unsampled or currently unverifiable claims explicitly unresolved.

## 4. naming-near-miss

Action trace:
1. Treat this as an application naming question. Inspect the relevant model/schema, migration definitions, repository operations, and their callers to determine what one row represents.
2. Under the standing wiki research instruction, perform a bounded read-only search for this application's existing terminology and read the returned relevant passage. Use wiki-search only for that lookup; the occurrence of the words “sources” and “citations” does not make this a wiki ingestion or authoring task.
3. Compare row identity with existing application usage. A row representing a document, URL, or other evidence item is a source. A row representing a specific reference from a claim/page/passage to that evidence item is a citation. Preserve established meaning and naming style.
4. Give the recommendation anchored to the actual schema and callers. If these are unavailable in the real interaction, explain the distinction and describe the one clarification needed: what one row represents. Do not invent the application model.
5. No schema edit, rename migration, wiki write, discovery, or ingestion is authorized by the naming question.

User response: “Use sources if each row is an evidence item such as a document or URL; use citations if each row records a specific reference to one. I'd follow the meaning already established by this application's model and callers. The fixture doesn't provide those definitions, so it doesn't establish which name applies.”

Stop condition: the naming recommendation is grounded in the application's meaning, or the missing row semantics are clearly identified without asserting an unsupported choice. No files are changed.

## 5. authorized-discovery

Action trace:
1. Use wiki-discover, then wiki-ingest. Read the known vault instructions and schema, and resolve absolute helper paths. Publication is already authorized.
2. Search the existing Atlas guide, relevant task MOC, and leading pages to state the exact unanswered offline question. Collect source URLs directly from raw/clippings frontmatter and inspect the existing decline records. If clippings exist but URL collection returns an implausibly empty set, repair that read before searching externally.
3. Bound discovery to this gap and at most two retained authoritative new sources. Run the skill's five read-only research lenses, using supported parallel workers or sequential passes, each with the known URLs, coverage summary, and 2–3 focused queries. Stop this batch after selection; do not expand into Atlas generally.
4. Independently assess the pooled candidates. Normalize URLs and remove existing, duplicate, blocked, and previously declined entries. Inspect promising originals, judge authority and capture suitability, and explain exactly what each candidate adds and which page it could change. Select up to two; do not fill a quota with weak material.
5. Before any decline or clip write, save a discover operation token using op-begin.mjs --op discover. Record rejected candidates through the clipping tool with their reasons. Clip selected sources with clip.mjs using their quality tier and the same --topic value; route non-HTML formats through their specific clip workflow if encountered.
6. Read each returned exact raw path and its metadata. Check the offline claims against the captured body, record capture limits, and preserve raw bodies. Failed/thin captures remain explicit issues; do not summarize an uncaptured page from memory.
7. Validate the capture artifacts. Write one discovery log with successful, declined, and failed counts; commit with op-commit.mjs --op discover --since the saved token. Inspect committed paths and refresh notices. Push under the existing authorization and verify upstream receipt. Do not pause for an ingestion decision: that decision was already made.
8. Open a fresh ingest operation for the named successful clippings only. Read their exact filenames and source-hash fields. Create or update source summaries with quoted full-path sources links, matching source-hashes, honest ai-generated metadata, and accurate dates.
9. Search canonical and alternative concept names before adding pages. Update only claims and existing concepts/syntheses substantively affected by these captures; explain useful relationships and update the relevant task map. Do not stamp existing pages reviewed merely for new links. Document the specific offline gap answered and any remaining uncertainty, preserving separation between first-party guide instructions and derived source claims.
10. Validate YAML, exact citation targets and claim support; regenerate the index catalog and applicable hubs; inspect the diff and retrieval of the new knowledge. Write one ingest log naming the source set and substantive changes. Commit the ingest operation, inspect its actual files and index notices, then push and verify the upstream contains its commit.

User response after successful checks: “Ingested [actual number, no more than two] new authoritative sources for the Atlas offline gap and pushed the updates. [Name the captured sources, exact pages changed, and what the evidence resolves.] [State any capture limits or remaining gap.]”

Stop condition: the bounded successful source set is captured, inspected, summarized with exact provenance, validated, logged, committed, and published with upstream verification. If no usable capture exists, report why rather than claiming ingestion; report any later failure precisely.

## 6. discovery-only

Action trace:
1. Use wiki-discover. Resolve the vault and helper paths, read the relevant instructions, and inspect the Atlas guide/task map to name the offline gap.
2. Collect and normalize existing raw source URLs and consult decline records before external searching. Resolve any suspiciously empty collection.
3. Run the bounded research and independent selection passes for this gap, retaining two useful authoritative sources if two can be found. Avoid endless replacements if the evidence is sparse; report a shortfall.
4. Save a discover token before the first decline or capture. Clip candidates through the supported clipping tools with a consistent --topic and assessed quality. Preserve returned raw bodies and pipeline metadata; never rewrite a degraded extraction into a seemingly clean source.
5. Inspect both actual captured artifacts and record missing sections, extraction limits, unsupported exact quotations, or other fidelity problems. Queue unresolved issues through the supported tooling where appropriate.
6. Validate the returned paths and metadata, write one discovery log, and close op-commit.mjs --op discover with the retained token. Inspect the actual commit and any index-refresh notices. If existing vault/session instructions authorize raw capture publication, push and verify it; otherwise accurately report the captures as locally committed.
7. Present the two exact raw paths, source URLs, quality rationale, gap relevance, and capture limitations for the user's review. Do not create source summaries, concepts, or guide changes. Describe the pending question: “After reviewing these two captures, would you like me to ingest them?” Ask that question only in the real workflow, not in this simulation.

User response: “The captures are ready for your review at [actual raw paths]. [Give each source URL and any capture limits.] They are committed [and published only if verified], and have not been ingested. After you've reviewed them, let me know whether to add them to the wiki.”

Stop condition: the authorized capture operation is committed and reported, with any authorized sync verified. Wait for an ingestion decision on the named source set; elapsed time does not grant authorization.

## 7. uncertain-write

Action trace:
1. Use wiki-author and the access/operation recovery rules. Treat the timeout as an unknown result, not a failed write.
2. Read the known exact target path directly from the filesystem before issuing any create or edit. Check its current contents, frontmatter, and whether the intended guide already exists fully or partly. Do not pick another filename.
3. Recover the existing operation token and pre-write ownership information from the interrupted session/operation record. Inspect the scoped Git diff and any existing log or commit to establish what already finished. Reuse the original operation if it remains open.
4. If the target already contains the intended content, skip the content write. If it is partial, reconcile the exact missing changes with the current file, preserving concurrent edits. If absent, create only the exact intended target after confirming the operation is open and the absence is real.
5. If the previous operation cannot be recovered, identify the timeout-produced diff explicitly before starting a recovery operation. A newly opened token may classify that diff as already dirty; do not pretend it will commit those excluded changes. Preserve them and report any ownership ambiguity instead of sweeping them into a commit.
6. Validate the complete guide's content, YAML, placement, metadata, and exact links. Verify only claims for which evidence or project behavior was checked. Refresh affected catalogs, inspecting shared generated changes.
7. Reconcile the operation log so completion is recorded once. Close the recovered operation with its saved token, inspect actual committed paths and index notices, and complete any already-authorized publication with upstream verification. If ownership or concurrent edits cannot be safely reconciled, retain the work and explain the exact unresolved diff rather than reporting completion.

User response after successful reconciliation: “The timed-out call [had already created the guide / left a partial guide / had not created it]. I checked the exact target, [completed only the missing content if needed], validated it, and completed its operation. [Report verified commit and sync state.]”

Stop condition: the single intended target and its operation state are reconciled and verified. No duplicate is created. An unresolved ownership conflict or excluded target remains explicitly incomplete.

## 8. app-only

Action trace:
1. Use obsidian-cli and its shared access guidance to determine whether the requested surface can be controlled.
2. The fixture already establishes that the CLI is unavailable and there is no app UI control. Opening an Obsidian workspace and showing its live graph requires a working app control channel.
3. Report this specific limitation immediately. Ordinary Markdown access does not expose the live app graph and does not establish that the workspace has been opened.
4. Do not edit vault files, build a substitute graph, repeatedly retry the CLI, or invent an app-success result. A brief manual next step is appropriate.

User response: “I can't open the Atlas workspace or show its live graph from this session: Obsidian control is unavailable. Open the Atlas vault in Obsidian and select Graph view.”

Stop condition: the unavailable app action is reported honestly. No app state change is claimed.

## Loaded skill and reference paths

- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-author/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-search/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-stale/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-discover/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-ingest/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/obsidian-cli/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/access.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/authoring.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/evidence.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/operations.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/efficacy.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/maintenance.md
