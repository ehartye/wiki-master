---
name: wiki-purge
description: Remove a topic from the wiki for good — move its pages, its evidence, and its source URLs into a git-tracked recycle bin, commit the removal so it reaches every machine, and re-bin anything that comes back.
---

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location, the provenance guardrails,
> and the `.recycle/` contract these steps assume. Skip the load if you arrived here
> already holding them.

# Purging a topic

Deleting files does not remove a topic. Three things bring it back:

1. **An uncommitted deletion.** A removal that never becomes a commit is not a
   removal anything else can see; the next sync undoes it. This is the failure that
   motivated the command — verified against the vault's own history, where no commit
   had ever deleted the pages someone believed they had removed.
2. **A `raw/` clipping left behind.** The ingest backlog reports it as
   un-summarized forever, and the next `/wiki-ingest` faithfully rebuilds the topic
   from evidence nobody removed.
3. **A source URL nobody declined.** `/wiki-discover` re-finds and re-clips it.

Purge closes all three in one transaction, and `--reconcile` closes them again on
every other machine.

## Steps

1. **Reconcile first.**
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/purge.mjs --reconcile`
   Sweeps anything an earlier purge lost, on this machine. Cheap and silent on a
   clean vault. It commits whatever it moves.

2. **Plan.**
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/purge.mjs --plan "<topic>"`
   Moves nothing. Prints the seeds it matched, every file it would bin, and two
   lists that need a human decision:
   - **COLLATERAL** — pages that survive but link into the purge set. Their
     references need repairing in step 4.
   - **BLOCKING** — pages whose every cited source is inside the set. `--apply`
     refuses while any exist. Either add them to the purge or keep their sources;
     a claim with no evidence is a defect (guardrail #2), so purge will not decide
     this silently in either direction.

3. **Show the user the plan and get explicit approval.** Never skip this. Purge
   moves many files at once and the closure reaches further than expected when a
   topic is densely linked. Read it back grouped by layer with counts, and name the
   collateral and blocking pages specifically.

4. **Apply.**
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/purge.mjs --apply "<topic>"`
   Writes the manifest, moves the files, records declines, writes the log entry, and
   commits — staging only what the purge touched, never the user's unrelated work.
   Then:
   - repair references on every COLLATERAL page (the log entry lists them);
   - regenerate the catalog: `node ${CLAUDE_PLUGIN_ROOT}/scripts/index-gen.mjs`;
   - commit the repairs **by name**, never `git add -A` — that sweeps the user's
     in-progress writing into a commit labelled as this purge:
     `git -C <vault> add -- index.md <each collateral page>` then
     `git -C <vault> commit -m "purge: repair references"`.

5. **Ask before pushing.** A push publishes the removal to every machine. Ask
   plainly — "push this purge to origin?" — and run `git -C <vault> push` only on a
   yes. If the vault is not a git repo, say plainly that the purge is local to this
   machine and will not reach the others.

6. **Verify — on the broken-link count, not the score.**
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs`, and compare the **broken links**
   line against a run from before the purge. It must not have grown.

   Do **not** verify with the score. Measured on the end-to-end fixture: an
   unrepaired purge moved the score *up*, 92 → 94. Purging an orphaned page removes
   an orphan penalty, and the dangling links left behind are classified `deferred`
   by `classifyBrokenLinks` — which is unscored. A link only escapes `deferred` if a
   similarly-named page still exists (impossible, the target was just purged) or the
   citing page is more than 90 days stale. So on any collateral page touched in the
   last three months, a skipped repair is invisible to the score.

   `obsidian unresolved verbose format=json` also lists them, attributed to the
   pages that carry them.

## When a purge stops partway

`--apply` reports the files it could not move and **stops before committing**. The
usual cause is a Windows file lock — antivirus mid-scan, the Search indexer, a sync
client holding a read-only handle.

Close whatever holds them open, then run **`--reconcile`**. It finishes this purge in
place, into the same bin folder, and commits.

**Do not re-run `--apply`.** The seed pages are already gone, so its plan comes back
empty; it starts a *second* purge under a new id, writes a manifest with no entries,
and commits something that claims a purge and contains none — while the real
half-purge stays uncommitted and gets reported back as the user's own work.

## Restoring

`node ${CLAUDE_PLUGIN_ROOT}/scripts/purge.mjs --restore <purge-id>` puts everything
back and commits.

- It never overwrites a file already at the original path — that is newer work, and
  it is reported as **skipped** instead.
- It clears the declines this purge recorded, so `/wiki-discover` can find those
  sources again. Declines made for other reasons are left alone.
- Anything the manifest claims but the bin cannot supply is reported as **MISSING**
  with a non-zero exit. **Never read a bare `restored N file(s)` as success** without
  checking that line.

## Rules

- **Never read, cite, or count `.recycle/`.** It is excluded from every metric and
  every search by design — `graph.mjs` skips dot-prefixed entries during its walk,
  every other reader filters on an anchored `wiki/` prefix, and Obsidian's own
  indexer ignores dot-folders (measured). A page in the bin is not evidence, not a
  source, and not backlog.
- **Never hard-delete the bin.** Retention is deliberate and unbounded: purge is
  reversible, and that is the only reason it is safe to run at all.
- **Never `--apply` without showing the plan and getting approval first.**
- **Never `git add -A` in a vault.** Stage the paths the operation touched. The
  vault carries the user's in-progress writing, and a commit that sweeps it up is
  both mislabelled and impossible to revert cleanly.
- **An empty result is not an answer.** If `--plan` reports no wiki pages for a
  topic, it has already probed whether the Obsidian backend is alive and will say so
  if it is not. Trust the message; do not re-interpret an empty plan as "this topic
  does not exist" when the tool told you the backend was unreachable.
