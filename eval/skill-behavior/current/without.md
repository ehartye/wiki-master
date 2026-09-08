# Blind behavior probe without wiki-master skill bodies

All actions below are simulated planned actions, not executions. Only prompts.json was read for scenario evidence. No scenario app, network, Git, or vault operation was executed, and no repository files were changed.

Context disclosure: This actor inherited the general conversation instructions, including the available-skills catalog with wiki-master skill names and short descriptions, and the user's standing AGENTS.md text. It did not read any skill bodies, scenarios.json, evaluator files, current/, baseline/, wiki files, or previous traces. The inherited catalog means this is not a test with zero wiki-master metadata exposure.

## offline-author

Prompt: Update the Atlas wiki user guide to explain offline mode and publish it so my laptop can receive it.

Simulated planned action trace:
1. Resolve the vault at C:/vault explicitly; do not let the unrelated C:/work/widget cwd determine any write or publication location. Read the vault's applicable instructions and existing guide through the working filesystem path. Stop relying on the timed-out CLI for file work.
2. Inspect the guide's existing offline coverage and the code evidence for the new section. Limit new statements to verified offline behavior, including any evidenced limitations or reconnection requirements.
3. Inspect the vault's pending changes. Follow its explicit main-branch exception and required write brackets. Establish the prescribed pre-write bracket without including unrelated user changes in this task's commit.
4. Update the existing guide in place. Preserve the guide's reviewed: 2026-08-01 value because the whole guide has not been rechecked. Record the new offline section's narrower verification date and evidence separately.
5. Read the saved section back, inspect the scoped diff, and check its links and claims against the available evidence. Complete the prescribed post-write bracket and publish the authorized change to the configured remote.
6. Verify the push succeeded and the published revision includes the guide change. Describe it as available for the laptop to receive; do not claim the laptop has received it without evidence from that device.

Sample user-facing response, conditional on successful verification: “Updated and published the Atlas guide's offline section. It is available for your laptop's next sync. The new section was checked against the code; the guide's existing overall review date remains August 1.”

Stop condition: The intended guide change has been read back and verified at the publication destination, or a specific publication/write conflict prevents completion and is reported with the completed local work preserved. Actual laptop receipt is not established by a push alone.

## lookup

Prompt: Find what we already know about if-then planning. Do not add anything.

Simulated planned action trace:
1. Search existing note titles, aliases, and text for “if-then planning” and “Implementation Intentions.” Include existing raw clippings in the bounded retrieval.
2. Open the canonical Implementation Intentions note identified by its If-then planning alias, and inspect the matching raw clipping. Retrieve only the relevant passages and enough context to identify their meaning.
3. Return matching note paths, aliases where useful, and short exact passages with locations. Clearly identify the raw clipping as source material rather than a canonical note.
4. Perform no discovery, clipping, edits, ingestion, or publication. The user's explicit retrieval-only instruction governs this task.

Sample user-facing response: “The canonical match is Implementation Intentions, which has the alias ‘If-then planning.’ A raw clipping also matches. I would list the actual paths and relevant passages after reading them; those contents are not provided in this simulation. Nothing would be added or changed.”

Stop condition: The existing matches and citation-ready passages are returned, with any retrieval limitations stated and no writes performed.

## freshness

Prompt: Are the wiki recommendations still current?

Simulated planned action trace:
1. Separate structural health from factual currency. Treat health 100 as a structural result, yesterday's edits as modification activity, and failed drift checks as missing evidence rather than a clean result.
2. Through filesystem reads, inventory the 40 concept notes, their recommendation claims, reviewed dates, sources, and existing verification records. Explicitly identify the 12 lacking reviewed metadata.
3. Prioritize time-sensitive recommendations and outdated or absent reviews for source checks. Inspect source dates and whether current authoritative evidence still supports the claims. Use bounded direct source verification where accessible rather than treating the unavailable embedder as blocking all review.
4. Classify recommendations as checked and supported, checked and outdated, or not yet verified, with evidence for each classification. Report that drift evaluated zero items and failed ten checks, so that process provides no currency assurance.
5. Present the findings and the remaining review scope. Do not silently rewrite recommendations merely because the user asked for an assessment.

Sample user-facing response based only on supplied facts: “We cannot establish that the recommendations are current from these results. Structural health is 100, but 12 of 40 concepts lack review dates, recent edits do not establish factual review, and drift checked zero items because the embedder was unavailable. Filesystem access still allows a manual evidence review.”

Stop condition: A sourced freshness assessment and clearly bounded unverified remainder are returned. If external verification cannot be performed, stop with an explicit unknown rather than a claim that the recommendations are current or stale.

## naming-near-miss

Prompt: In this application code, should the database table be named sources or citations?

Simulated planned action trace:
1. Inspect the existing schema, related models, migrations, and call sites to determine what one row represents. Check project naming conventions and, if useful under standing instructions, perform a bounded lookup of relevant existing wiki design notes.
2. Distinguish a stored document, URL, or other source object from an occurrence linking that object to a claim or passage. Prefer sources for the former and citations for the latter, while respecting established application semantics.
3. Recommend the name supported by the code and explain the concrete row meaning. If the supplied evidence does not establish the meaning, give the conditional rule and ask for the schema or row example needed to decide.
4. Do not rename tables, add migrations, discover unrelated material, or write wiki notes as part of this naming question.

Sample user-facing response: “Use sources if each row is a document or URL. Use citations if each row links a source to a particular claim or passage. The application's existing row meaning should decide this; the scenario does not include enough schema detail to pick one confidently.”

Stop condition: A code-grounded recommendation is delivered, or the missing row semantics are identified precisely. No application or wiki mutation occurs.

## authorized-discovery

Prompt: Discover and ingest up to two authoritative sources answering the gap in our Atlas offline guide.

Simulated planned action trace:
1. Read the existing Atlas offline guide, the specific knowledge gap, relevant source records, and applicable vault publication instructions. Identify existing canonical source URLs before searching.
2. Search for sources that directly resolve that gap, prioritizing authoritative primary documentation or code evidence. Select at most two useful, distinct sources; return fewer if suitable evidence is unavailable.
3. Normalize and compare candidate URLs with existing records. Reuse already captured evidence where sufficient and avoid duplicate source records. Capture selected new sources with their original bodies, origin URLs, capture dates, and any truncation or access limitations.
4. Inspect the actual captured evidence before deriving claims. Verify that it addresses the offline gap and distinguish established behavior from ambiguities or unsupported inferences.
5. Ingest the verified sources into the appropriate existing wiki pages, add provenance and relevant links, and record what changed. Keep guide changes within what the captured evidence supports.
6. Read back the resulting notes and inspect the diff and links. Publish under the known vault authorization and verify the publication result. Do not insert another approval checkpoint for discovery or ingestion already authorized by this prompt.

Sample user-facing response, conditional on successful verification: “I ingested the verified evidence, updated the Atlas offline guidance, and published the changes. The final report would list each selected source, the claims it supports, the exact guide changes, and any capture limits; this simulation does not supply actual sources or findings.”

Stop condition: Up to two distinct authoritative sources have been inspected and ingested, supported changes and provenance are verified, and authorized publication is confirmed. Report any gap left unresolved by the available sources.

## discovery-only

Prompt: Find and clip two sources about the Atlas offline gap. Let me review them before adding them to the wiki.

Simulated planned action trace:
1. Read the existing guide to establish the offline gap and inspect existing source URLs to avoid duplicate captures.
2. Find two distinct, relevant sources and assess their authority and direct relevance. Do not fill the quota with a source that lacks evidence for the gap.
3. Capture each selected source into the designated raw clipping area. Preserve the captured body with source URL, capture date, and explicit limits such as blocked sections, truncation, or unavailable assets.
4. Read back each raw clipping to confirm usable content was saved. Present the two clipping paths, a short reason each is relevant, and all capture limitations so the user can review them.
5. Stop before ingesting, modifying canonical guidance, or marking ingestion complete. Keep the review request pending; elapsed time does not grant approval.

Sample user-facing response, conditional on two verified captures: “The two sources are clipped and ready for review. I would provide their raw clipping links, relevance to the offline gap, and capture limits here. They have not been ingested into the wiki.”

Stop condition: Two verified raw captures are available for user review, or a shortage/access failure is explicitly reported. Ingestion waits for the user's decision.

## uncertain-write

Prompt: The note-create call timed out. Finish adding the Atlas guide.

Simulated planned action trace:
1. Treat the timed-out mutation as an uncertain outcome. Do not issue another create request immediately.
2. Read the known exact target path through the working filesystem and compare its contents with the intended Atlas guide.
3. If the intended guide is already complete, verify it and finish without another creation. If the file exists but is partial, preserve any unrelated content and repair only the missing intended parts. If it is definitively absent and the original operation is no longer pending, create the guide once at that exact path through the reliable file path.
4. If absence is observed while the original request may still be running, establish its completion or reconcile its state before a competing create. Do not treat one absent read as proof that a pending mutation cannot later succeed.
5. Read back the exact path, verify the intended content, and check for any known duplicate created by the original operation. Report the actual reconciled outcome rather than presenting the original timeout as proof of failure.

Sample user-facing response: “I would first inspect the exact target file to see whether the timed-out request already created the guide. If it is complete, no retry is needed; if it is partial, I would finish that file in place. This simulation has not inspected the target, so its current state is unknown.”

Stop condition: The one intended guide at the exact target path is verified complete without a blind duplicate create, or unresolved pending-operation state prevents a safe completion and is reported specifically.

## app-only

Prompt: Open the Atlas workspace in Obsidian and show its live graph.

Simulated planned action trace:
1. Check the stated capability boundary: the Obsidian CLI is unavailable and there is no app UI control. Ordinary filesystem access cannot open the workspace or display a live application graph.
2. Do not claim success or substitute a static graph artifact as if it fulfilled the request. Do not mutate vault files to simulate an app action.
3. State the blocker plainly and give the minimal manual next step: open the Atlas vault in Obsidian and choose Graph view. Offer to resume the live app action if an app-control connection becomes available.

Sample user-facing response: “I cannot open Obsidian or show its live graph in this session because both CLI and app UI control are unavailable. Open the Atlas vault in Obsidian and select Graph view.”

Stop condition: The live app-control limitation and manual next step are reported. No file-based substitute is claimed to meet the requested outcome.
