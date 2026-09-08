# Simulated intended actions using revised skills

These are simulations, not executed actions. I have not accessed a real vault, invoked an app, run a helper, used Git or the network, or applied any of the actions below. The only file created is this simulation record. Sample responses are conditional examples of what I would report after obtaining the stated evidence; they are not claims about this run.

## Scenario: large-guide

Ordered intended actions:

1. Use the supplied vault root `C:/vault` and installed plugin root `C:/plugins/wiki-master`; read the vault instructions and schema, then locate and read the existing Atlas architecture page. Preserve its filename and confirm its resolved path stays inside the vault. Inspect current content and existing changes before deciding what to replace. Treat the 40 KB verified text as the supplied design-section update, not permission to replace unrelated sections. Check that architecture claims describe implemented behavior; do not silently promote planned behavior to as-built documentation.
2. Respect the other agent's ongoing search. Ordinary Markdown editing uses the filesystem even though the CLI is healthy. If any app command is actually needed, call only `node 'C:/plugins/wiki-master/scripts/obsidian.mjs' ...` through PowerShell, serially under its shared guard. Do not send the note through `content=`, divide it into CLI chunks, launch raw native calls, or bypass the guard.
3. Set the operation's vault environment with restoration afterward. Before the first write, open `node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op relink` and retain its token. Inspect its baseline dirty paths: it excludes already-dirty paths at commit time and does not isolate overlapping edits. The scenario's scoped main and push authorization permits that lifecycle without another permission request. Coordinate any overlapping file writer before changing an overlapping target.
4. Re-read or compare the exact target against the version used to prepare the patch. Reconcile new edits rather than overwriting them. Apply a narrowly bounded filesystem patch to the design section and required metadata, preserving other user text. Retain valid authored metadata, explicit `sources: []`, and honest authorship. Set `updated` to the actual edit date. Keep page-level `reviewed: 2026-08-01`, since only the changed section was verified; document that verification's limited scope without implying the rest of the page was checked.
5. Read back the file and inspect its diff, frontmatter, links, and supplied section content. Run applicable cheap structural checks and affected catalog generators from the absolute plugin root: `index-gen.mjs`, and `moc-authored-gen.mjs --apply` if the project's authored-page count requires it. Inspect generated changes and preserve other agents' and users' unrelated changes. Do not edit generated fences manually or regenerate backlog material for this architecture-only task.
6. Write one relink operation log through `log-entry.mjs`, then close with `op-commit.mjs --op relink --title 'Update Atlas architecture' --since <saved-token>`. Verify the actual commit paths and diff, and inspect semantic index refresh notices. Never stage the whole vault. If the architecture page was already dirty and excluded, do not sweep it into the commit or claim it published: resolve ownership and a scoped way to publish only the authorized changes, or report that concrete exclusion as a publication blocker while retaining the token and work.
7. Once the requested page and applicable operation changes are verifiably committed within scope, perform the authorized `git -C 'C:/vault' push`, then verify the upstream contains the intended commit. Do not equate `op-commit` with a push. If push is rejected, report that specific failure without forcing it. Disclose any index-refresh limitation separately from publication status.

Sample user response after a successful path:

“Updated and published the Atlas architecture design section, preserving existing unrelated edits. The page's reviewed date remains August 1 because only that section was verified. The committed diff and upstream state are confirmed.”

Sample response if the existing dirty target prevents a scoped commit:

“The design-section update is validated locally. Publication is pending because the architecture page already contained user changes and was excluded from the operation commit. I have preserved those changes and the operation token; the page is not yet published.”

Stop condition: The exact requested section, metadata, links, applicable catalogs, one log, scoped commit, and authorized upstream sync have been verified. Otherwise stop only at a concrete unresolved content conflict, scoped-commit exclusion, validation failure, or rejected sync, reporting the precise pending work and retaining recoverable operation state.

## Scenario: busy-read

Ordered intended actions:

1. Treat the supplied `CLI_BUSY: request not sent` after ten seconds as a guard refusal before launch, not as zero matching pages or an uncertain write. Do not retry in a loop, raise the lock limit to bypass contention, invoke native Obsidian, or ask the user to restart the app. No canary is needed to reinterpret an explicit busy diagnostic.
2. Use any usable results and diagnostics from the preferred bounded `search.mjs` lookup, including the available local search index. Do not start another CLI attempt merely to get past the busy result. Fall back once to bounded filesystem search over `C:/vault/wiki` and `C:/vault/moc`, using terms such as `offline`, `offline mode`, and `disconnected`. Exclude `.recycle/`, dot folders, dependency trees, and binary originals. Do not search raw clippings unless evidence lookup becomes necessary for a requested passage.
3. Open the current files around matching lines, verify that each passage actually discusses offline mode, and return a concise set of existing page paths and line citations. Check index freshness and current file content so stale index results do not stand in for live passages. Separate proposals from documented implemented behavior when that distinction appears in the matched passage.
4. Report the unavailable CLI channel and the actual fallback channels used, even if other channels returned plausible matches. If nothing matches, state that no matches were found within those searched directories and terms, with the coverage limitation; do not assert that no wiki knowledge exists. Do not discover or ingest sources, create notes, open an operation, log, refresh indexes, commit, or push for this read-only request.

Sample user response, with placeholders to fill only from observed matches:

“Obsidian's search channel was busy, so I used the available local index and checked current files. Existing offline-mode passages: [actual page and matched line], [actual page and matched line]. Nothing was added or changed.”

Stop condition: Verified existing matching passages are returned with usable paths and line numbers plus the degraded-channel disclosure, or an accurately scoped no-match report is returned. No vault mutation has occurred.

## Scenario: uncertain-write

Ordered intended actions:

1. Treat the timeout and main-process JSON parsing dialog as an uncertain mutation outcome. Do not replay the old overwrite, issue an app probe as a prerequisite, create a duplicate architecture note, force-close Obsidian, or claim the old request failed without changing anything. Use known roots `C:/vault` and `C:/plugins/wiki-master` and retain the available current operation token.
2. First inspect the exact filesystem target `C:/vault/wiki/authored/atlas/architecture.md`. Read its current bytes/content and compare them with the intended update and available operation baseline. Read the vault instructions/schema and operation context needed to continue safely. Determine whether the intended section is fully present, partially present, absent, or mixed with unrelated user changes. If the intended text is not recoverable from the handoff or authorized task context, ask for that missing text rather than invent it.
3. Consider whether the old writer can still act. Lock cleanup or a timeout does not establish that a surviving child or submitted app mutation has finished. Inspect available evidence about that request and current target state before writing. If the target keeps changing or a still-pending writer cannot be ruled out sufficiently to preserve user work, stop the dependent overwrite and report the specific uncertainty; a single successful read is not proof of quiescence.
4. If the intended update is already fully present, do not rewrite it: validate and continue the existing operation's completion steps. If absent or partial and safe to reconcile, construct only the missing scoped filesystem change against the current exact target. Recheck that it has not changed since inspection and reconcile any differences before applying. Preserve unrelated sections and metadata; retain `reviewed` unless corresponding factual verification supports advancement. Do not send Markdown through CLI `content=` or split it into smaller requests.
5. Read back and compare the final target to the intended update and preserved user content. Validate frontmatter, links, and placement; refresh only applicable catalogs using filesystem-capable helpers from the known plugin root. Inspect generated diffs. Check whether the enclosing operation already logged or committed the work to avoid duplicate bookkeeping. Continue with its existing token rather than opening a replacement operation.
6. Record the one required relink log if it is not already recorded, complete and inspect the scoped operation commit, and inspect index refresh notices. Do not include unrelated dirty paths. Inspect existing session/vault authorization for sync and carry out any already-authorized publishing without asking again; otherwise accurately report the local commit. Verify actual upstream state before calling a page published. Preserve the token and identify unfinished checks if any completion step fails.

Sample user response after discovering the old write had landed and completing the remaining authorized steps:

“The timed-out request had already applied the architecture update. I verified the exact page, preserved unrelated content, and completed the remaining operation checks without replaying the overwrite. [Report the observed commit, index, and sync status here.]”

Sample response if the old writer remains unresolved:

“The architecture page is readable, but the previous write may still be pending. I have not replayed or overwritten it. Completion is paused at that specific uncertainty; the current operation token is retained.”

Stop condition: The exact target contains the verified intended update with unrelated changes preserved, no uncertain writer can undermine the reconciled result, and the existing operation's applicable validation/log/commit/authorized-sync steps are confirmed. If intended content, overlapping edits, or the previous writer remains unresolved, report that concrete blocker without claiming completion or performing a blind retry.

## Files loaded and inherited exposure

Loaded exactly these files:

- `C:/Users/ehart/repos/wiki-master-cli-guard/eval/cli-safeguards/prompts.json`
- `C:/Users/ehart/repos/wiki-master-cli-guard/skills/wiki-maintainer/SKILL.md`
- `C:/Users/ehart/repos/wiki-master-cli-guard/skills/wiki-author/SKILL.md`
- `C:/Users/ehart/repos/wiki-master-cli-guard/skills/wiki-search/SKILL.md`
- `C:/Users/ehart/repos/wiki-master-cli-guard/skills/obsidian-cli/SKILL.md`
- `C:/Users/ehart/repos/wiki-master-cli-guard/skills/wiki-maintainer/references/access.md`
- `C:/Users/ehart/repos/wiki-master-cli-guard/skills/wiki-maintainer/references/authoring.md`
- `C:/Users/ehart/repos/wiki-master-cli-guard/skills/wiki-maintainer/references/evidence.md`
- `C:/Users/ehart/repos/wiki-master-cli-guard/skills/wiki-maintainer/references/operations.md`

Inherited exposure: the task delegation requesting this simulation and its restrictions; general system/developer tool, collaboration, safety, and writing instructions; the available-skill catalog and tool descriptions; the user-provided AGENTS.md instructions and workspace environment; and the recommended-plugin list. No scenarios.json, test files, evaluation scripts, implementation files, other evaluation artifacts, prior probe transcripts, or real vault contents were loaded or visible in this agent's provided task context. No self-grading or rubric inference was performed.
