# Every vault operation commits its own work — Design Spec

**Date:** 2026-08-08
**Status:** Designed (follow-up to `/wiki-purge`, blocked on PR #52 merging)
**Author:** Design conversation with @Eric-Hartye_HON

---

## 1. Why this exists

`/wiki-purge` was built because a deletion never became a commit and the next sync
undid it. Investigating that turned up a larger fact the purge work only fixed for
itself:

| | Writes to the vault | Commits its work |
|---|---|---|
| Scripts under `scripts/` | **16** | 1 (`purge.mjs`) |
| Skills instructing an agent to write | **7** | 1 (`wiki-purge`) |

`/wiki-ingest` typically touches 10–15 pages. `/wiki-relink` rewrites links across the
graph. `/wiki-lint` applies fixes. None of them commit. Until today the only thing
making that work durable was obsidian-git's timer — which was **disabled** on
2026-08-08 in response to the deletion bug, leaving every operation exposed for
several hours until it was re-enabled at a 15-minute interval.

A timer is a safety net, not a mechanism. It cannot know where an operation begins or
ends, so it produces `vault backup: <timestamp>` commits that mix unrelated work and
cannot be reverted as a unit. Observed live while re-enabling it: a single auto-commit
swept a settings change together with eight in-progress files, then pulled and merged
another machine's work.

**Purge is rare. Ingest is constant.** This follow-up is the higher-value half.

## 2. What already exists

`scripts/lib/git.mjs`, shipped with `/wiki-purge`, is the whole primitive layer:

- `isGitRepo(cwd)`
- `commitPaths(cwd, paths, message)` — stages **only** the named paths, NUL-delimited
  on stdin via `--pathspec-from-file` (argv ceiling, em-dashes), `--literal-pathspecs`
  (a `[` in an NTFS filename would otherwise glob a sibling), filters to what git can
  actually stage (a never-committed file that has since moved would otherwise sink the
  whole commit atomically), and narrows the **commit** as well as the add (otherwise it
  commits the entire index, including the user's pre-staged work)
- `uncommittedElsewhere(cwd)` — what was deliberately not committed
- `push(cwd)`

Every one of those behaviours was found the hard way during the purge work. Nothing
new is needed at this layer.

## 3. The design question: which paths?

`commitPaths` needs a path list. Three ways to get one:

| Option | How | Cost |
|---|---|---|
| **A. Skill enumerates** | Each skill tracks what it wrote and passes the list | Every skill must be exhaustive; a missed path is an uncommitted change, which is the bug |
| **B. Commit everything except a denylist** | `git add -A` minus `.wiki-master/` | Reintroduces the exact failure `commitPaths` exists to prevent — sweeps the user's writing |
| **C. Snapshot the dirty set, diff at the end** ← **recommended** | Record `git status --porcelain` before the operation; commit (dirty-now − dirty-before) | One extra git call per operation; correctly excludes work the user already had in flight |

**C is chosen.** It requires no skill to be exhaustive, and it structurally cannot
commit something the operation didn't touch — the property A depends on discipline for
and B abandons.

Its one failure mode is worth stating: if the user edits a file *during* a long
operation, that edit is attributed to the operation. Acceptable — it is a mislabelled
commit, not lost work, and the alternative (A) fails in the worse direction.

## 4. Shape

Two small scripts, mirroring how `log-entry.mjs` is already invoked from skills:

```
node scripts/op-begin.mjs                    # prints a token; records the dirty set
node scripts/op-commit.mjs --op ingest \
     --title "<what happened>" --since <token>
```

`op-begin` writes the pre-operation dirty set to `.wiki-master/ops/<token>.json`
(gitignored — it is scratch state, not vault content). `op-commit` reads it, computes
the delta, calls `commitPaths`, reports anything it deliberately left alone, and
deletes the token file.

**Commit granularity is the operation, not the script.** An ingest calls
`index-gen.mjs` and `log-entry.mjs` as *steps*; committing per-script would fragment
one ingest into several commits. The skill brackets the whole operation.

**Never pushes.** Same rule as purge: pushing is outward-facing and belongs to an
explicit confirmation step, not to a script that could run unattended.

## 5. Scope

**In:** `op-begin.mjs`, `op-commit.mjs`, tests, and bracketing four skills —
`wiki-ingest`, `wiki-relink`, `wiki-lint`, `wiki-discover`.

**Out:** `wiki-query` (read-only unless it files an answer back — bracket only that
branch), `wiki-init` (scaffolding a new vault predates any repo), `obsidian-cli` and
`wiki-maintainer` (reference skills, not operations), `wiki-health` / `wiki-stale`
(read-only), and the `clip*.mjs` scripts (they run inside `/wiki-discover`, which
brackets them).

**Explicitly out: changing obsidian-git's role.** The timer stays on at 15 minutes as
a safety net for hand edits made in Obsidian itself, which no skill brackets. The goal
is to make the timer redundant for agent operations, not to remove it.

## 6. Testing

Same discipline the purge work settled on — every guard mutation-verified, deleted and
confirmed to fail a test before being restored.

| # | Test | Guards |
|---|---|---|
| 1 | An op commits exactly the files it touched | The core claim |
| 2 | A file dirty *before* the op is not committed and is reported | The `git add -A` failure this exists to avoid |
| 3 | A file the user pre-**staged** is not committed | `git commit` narrowing (this bit once already) |
| 4 | An op that changed nothing creates no commit | No empty "ingest" commits |
| 5 | A never-committed new file commits fine | `--pathspec-from-file` atomicity (this bit once already) |
| 6 | A missing/corrupt token file fails loudly, not silently | An unbracketed op must not look successful |
| 7 | Not a git repo → clear message, operation still succeeds | A vault need not be a repo |

## 7. Open question for the user

Whether `op-commit` should **offer** to push when the vault has a remote, or stay
silent and leave pushing to the skill's existing confirmation step. Purge chose the
latter. Consistency argues for matching it; convenience argues that an ingest the user
never pushes is only half-durable — and cross-machine convergence is the whole point.

Recommendation: match purge (no push), and instead have `op-commit` report how many
commits are unpushed, so the gap is visible without being acted on automatically.
