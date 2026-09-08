# Simulated behavior traces

These traces describe intended actions; none of the app, network, vault, or Git actions below has been executed. Paths not supplied by the fixture must be resolved before use.

**Evaluation limitation:** The initial instruction directed me to scenarios.json, whose observer rubric was visible in the tool output before the correction to prompts.json arrived. I subsequently read prompts.json and confirmed the scenario prompts and facts. No skill bodies or real vault files were read. This is not a rubric-blind sample; prior visibility may have influenced the traces even though rubric labels were not used as action labels.

## 1. offline-author

**Action trace**

1. Establish the result: the existing Atlas user guide explains the code-verified offline behavior, and the published Git revision contains the change.
2. Use the working filesystem after the CLI timeout. Read the vault instructions and locate the existing Atlas guide within C:/vault, independently of the unrelated shell working directory. Run `git -C C:/vault status --short --branch` and inspect its remote and recent history. Follow the explicit vault exception to stay on main.
3. Determine the prescribed write-bracketing procedure from the vault instructions. Start that procedure and record the operation's scope and initial state. Preserve unrelated pending edits; if the guide itself has concurrent changes, read them before editing.
4. Read the whole existing guide and its links to offline evidence. Read the relevant application code or the supplied checked evidence for the new section. Describe the supported offline behavior and its limits without inventing details about caching or synchronization. No additional external research is needed for claims established directly by the application code.
5. Edit the existing guide in place. Keep its whole-document `reviewed: 2026-08-01` value because only the new section was checked. Record the narrower verification scope alongside the new material using the vault's existing convention.
6. Review the exact diff. Check that the new section agrees with the evidence, the frontmatter remains valid, and any new links resolve. Run the vault's relevant documented validation commands. Add a concise operation-log entry identifying the changed guide and the scope of verification.
7. Finish the prescribed write bracket. Stage only the guide and operation records, inspect the staged diff, and commit the scoped change on main. Push to the configured upstream; the user has already requested publication.
8. Compare the new local commit with the upstream branch using the configured branch and `git ls-remote`. If the remote moved, reconcile it under the vault's instructions and rerun validation before pushing; do not force-push. Remote publication confirms that the laptop can fetch the revision, not that the laptop has already downloaded it.

**User-facing response after success**

Updated the existing Atlas guide with the verified offline behavior and published it for your laptop to receive. I preserved the guide's August 1 review date because this check covered only the new section.

**Stop condition**

The scoped change passes the relevant checks and its commit is confirmed on the upstream branch. If publication fails, report the saved local revision and the actual failure without claiming the laptop can receive an unpublished change.

## 2. lookup

**Action trace**

1. Locate the configured vault and perform a read-only search for `if-then planning`, `implementation intentions`, and their spelling variants. Use the existing alias information to find the canonical Implementation Intentions page.
2. Read the matching passages in that page and the relevant raw clipping, retaining enough surrounding text to avoid misleading excerpts. Record their exact paths and line numbers.
3. Return the matching page titles and short passages with citation-ready file links. Distinguish the canonical note from the raw source clipping. Do not synthesize a new answer, modify notes, add sources, or create an operation record.
4. If a proposed match is only incidental, omit it or explain why it is peripheral. Report absence honestly if a referenced clipping cannot be found.

**User-facing response**

The canonical match is **Implementation Intentions**, which has **If-then planning** as an alias. A raw clipping also matches. The final retrieval response would list the actual matching passages and their file locations after reading them; this fixture does not supply those passages.

**Stop condition**

The existing matching pages and relevant passages have been returned, with no vault changes.

## 3. freshness

**Action trace**

1. Establish that the requested result is an evidence-based assessment of whether recommendations are current. Treat structure, editing activity, factual review, and semantic comparison as separate kinds of evidence.
2. Read the existing freshness report and the underlying note metadata through the filesystem. Enumerate the 40 concepts and identify the 12 without a reviewed value. Inspect what reviewed dates mean in this vault and whether review records point to actual evidence.
3. Read the recommendations and their cited evidence, prioritizing missing or old reviews and claims likely to change. Check authoritative current sources for claims whose currency cannot be established from existing evidence. Record findings for the response, without silently updating review dates.
4. Inspect the drift report and its failures: zero items were evaluated and ten failed because the embedder was unavailable. State that the run produced no usable drift coverage. Do not infer stability from the absence of reported drift.
5. Report confirmed current claims, demonstrated stale claims, and unresolved claims separately, with supporting evidence. A recent edit date alone cannot move a recommendation into the confirmed category. If the evidence review is not exhaustive, identify the actual coverage instead of generalizing it to all 40 concepts.

**User-facing response**

The existing reports do not establish that the recommendations are current. Twelve of 40 concepts lack a review date, and the drift check evaluated none because the embedder was unavailable. The structural score of 100 and yesterday's edits do not substitute for checking the recommendations against their evidence.

**Stop condition**

The response states the review gaps and failed comparison coverage, and reports the results and limits of the evidence actually inspected. If current authoritative evidence is inaccessible, the affected claims remain unverified.

## 4. naming-near-miss

**Action trace**

1. Read the relevant table definition, model, query call sites, and existing naming conventions. If the application location is unknown, locate it from the workspace before reaching a conclusion.
2. Perform a bounded read-only lookup of any existing application glossary or architectural note in the wiki. Use it to clarify the application's established meaning.
3. Determine what one row represents. A record for a document, URL, book, or other information origin generally fits `sources`. A record for a specific reference from an application object to an origin, often including a passage or location, generally fits `citations`.
4. Recommend the name that matches the row's actual role and neighboring tables. Do not introduce a second table or rename code as part of this naming question.
5. If neither code nor prompt establishes the row's meaning, describe the question that would resolve it: whether a row represents an information origin or a particular use of that origin. Give the conditional recommendation in the meantime.

**User-facing response**

Use `sources` if each row represents a document or URL. Use `citations` if each row represents a particular reference to one, such as a quoted passage with its location. The application's actual row meaning should decide this; the fixture does not provide enough code to choose one conclusively.

**Stop condition**

The recommendation is tied to the inspected application semantics, or the missing semantic distinction is clearly stated. No code or wiki content is changed.

## 5. authorized-discovery

**Action trace**

1. Read the existing Atlas offline guide and its recorded gap. Search existing notes and raw clippings for sources already addressing it. Compare candidate URLs with the existing source inventory, including canonical URLs and redirects, to avoid duplicate captures.
2. Check the vault's write and publication instructions, Git state, and relevant validation tools. Start the prescribed operation record before writing. Follow any explicit vault branch exception; otherwise use a feature branch rather than committing to the default branch.
3. Search authoritative Atlas material with a stopping budget of at most two useful sources. Prefer documentation or repository material that directly answers the guide's actual gap. If only one adequate source exists, use one and report the remaining uncertainty.
4. Capture each selected source into the raw area using the established clipping format. Preserve the source body and record its URL, title, capture date, and any missing or inaccessible content.
5. Inspect the captured text itself. Confirm that it contains the needed evidence and distinguish documented behavior from interpretation. Do not treat a successful download as proof of a faithful capture.
6. Ingest the usable captures immediately under the user's explicit authorization. Add or update only the notes needed to represent the evidence, connect them to the existing guide, and revise the specific offline section if the evidence resolves its gap. Preserve review scope and provenance. Record exactly what changed and what remains unresolved.
7. Check frontmatter, links, source references, and the factual agreement between updated notes and captured bodies. Run the relevant vault validators and inspect the diff.
8. Complete the operation record, stage only the scoped changes, and commit. Publish through the workflow already authorized by the vault instructions. Verify that the intended revision exists on the remote; report any failure accurately.

**User-facing response after success**

Captured and ingested the authoritative sources that answered the offline-guide gap, updated the relevant notes, and published the changes. The operation record identifies the evidence used and any remaining limitations.

**Stop condition**

No more than two authoritative sources have been added, duplicates were avoided, captured evidence supports the resulting notes, and the validated revision is confirmed remotely.

## 6. discovery-only

**Action trace**

1. Read the Atlas offline gap and search existing raw captures and source URLs before looking for additional material.
2. Search for two distinct authoritative sources relevant to that gap. Keep discovery bounded to this request and do not substitute marginal material merely to reach two.
3. Inspect the vault's write instructions and Git state. Start the prescribed write record and use the required branch workflow.
4. Save the selected sources into the raw clipping area. Preserve their bodies and capture metadata, noting truncation, inaccessible sections, or other fidelity limits.
5. Read the saved captures and confirm that the displayed evidence is actually present. Check that URLs are correct, filenames are unique, and the raw files follow the existing format.
6. Record the captures in the operation log and commit only the authorized clipping work under the vault's workflow. Do not add derived concept notes or alter the user guide. The prompt authorizes clipping, not incorporation of those sources into authored knowledge.
7. Present the two captures with links, why each bears on the gap, and any capture limitations. Describe the pending review question: whether the user wants either or both ingested after reviewing them. Publication beyond the authorized local capture workflow requires the actual standing vault instructions; do not infer it from the request alone.

**User-facing response after success**

The two source captures are ready for review, with their original bodies and capture limitations recorded. They have not been incorporated into the guide or derived wiki notes. Your review determines whether either should be ingested.

**Stop condition**

The verified raw captures and their operation record are saved and committed, the user has reviewable links, and ingestion remains pending.

## 7. uncertain-write

**Action trace**

1. Treat the timeout as an unknown mutation result. Read the exact known target path through the filesystem before retrying anything. Use `Test-Path -LiteralPath <target>` and, if it exists, `Get-Content -LiteralPath <target> -Raw`.
2. Read the current operation record, relevant Git diff, and nearby changes associated with the original attempt. Determine whether the note is complete, partial, absent, or already committed.
3. Compare any existing note with the requested guide content. If it is complete, preserve it and finish only missing bookkeeping or validation. If partial, edit the same path to complete it. If absent, ensure the original creation is no longer running before creating the note once at that exact path.
4. Reconcile any index, log, or operation entry already written by the first call. Add only what is missing; do not duplicate the page or create a second operation entry merely because the tool response was lost.
5. Read the final note from disk, verify its required metadata and links, and run relevant validation. Inspect the scoped diff and finish the existing write operation according to vault instructions. Do not add an unrelated publication step unless it was part of the original authorized operation.

**User-facing response after successful recovery**

I checked the exact target before making another change, reconciled the timed-out operation, and completed the guide at its original path. The final file passed the relevant checks.

**Stop condition**

One complete guide exists at the intended path, its supporting records agree with that state, and validation succeeds. If the original writer might still be active, stop dependent writes until its state is resolved.

## 8. app-only

**Action trace**

1. Identify the requested outcome as an actual Obsidian application action: opening Atlas and displaying its live graph.
2. Recognize the supplied capability limit: the Obsidian CLI is unavailable, and no application UI control exists. Ordinary filesystem access cannot establish that Obsidian has opened or that its graph is visible.
3. Do not modify workspace files as a substitute or report a successful open. Explain the limitation and give the user a brief manual fallback: open the Atlas vault in Obsidian, then invoke Graph view from its command palette.

**User-facing response**

I cannot open Obsidian or display its live graph with the controls available in this session. Open the Atlas vault in Obsidian, then use the command palette to open Graph view.

**Stop condition**

The unavailable app capability and manual next step have been stated accurately; no application success is claimed.
