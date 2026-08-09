# Vault Commit Helper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use h-superpowers:subagent-driven-development, h-superpowers:team-driven-development, or h-superpowers:executing-plans to implement this plan (ask user which approach). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every vault-mutating wiki-master operation commit its own work as one semantic unit, so durability stops depending on obsidian-git's timer.

**Architecture:** Two small scripts bracket an operation. `op-begin.mjs` snapshots the already-dirty set; `op-commit.mjs` computes the delta and calls the existing `commitPaths` from `scripts/lib/git.mjs`. No new git primitives — that layer shipped with `/wiki-purge` and every one of its behaviours was found the hard way.

**Tech Stack:** Node 20+ ESM, `node --test`, `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-08-vault-commit-helper-design.md`

**Prerequisite:** PR #52 must be merged — this builds on `scripts/lib/git.mjs`. Rebase this branch onto `main` before starting.

---

## Background

**The gap, measured.** 16 scripts under `scripts/` write to the vault; only `purge.mjs` commits. 7 skills instruct an agent to write; only `wiki-purge` commits. `/wiki-ingest` alone touches 10–15 pages per run.

**Why not `git add -A`.** The vault carries the user's in-progress writing. Observed on the real vault during the purge work: eight uncommitted files at one point, and an auto-commit that swept a settings change together with all of them. `commitPaths` exists precisely to avoid that, and the helper must not undo it.

**Why snapshot-diff over skill-enumerated paths.** Enumeration makes every skill responsible for listing everything it wrote; one missed path is an uncommitted change, which is the original bug. Snapshot-diff structurally cannot commit what the operation didn't touch.

**`commitPaths(cwd, paths, message)` already handles**, and you must not re-derive: NUL-delimited stdin via `--pathspec-from-file` (argv ceiling + em-dashes in filenames), `--literal-pathspecs` (a `[` in an NTFS name would glob a sibling), filtering to paths git can actually stage (a never-committed file that has moved would sink the whole commit atomically — `EXIT=128`), and narrowing the **commit** as well as the add (bare `git commit -m` commits the whole index including pre-staged user work).

`.wiki-master/` is gitignored in the vault, so token files under `.wiki-master/ops/` are never committed. Skills invoke scripts as `node ../../scripts/<name>.mjs`, per `skills/wiki-ingest/SKILL.md:40`.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/op.mjs` (create) | Pure: `dirtySet(porcelain)`, `deltaPaths(before, after)`. No fs, no git. |
| `scripts/op-begin.mjs` (create) | Snapshot the dirty set to a token file; print the token. |
| `scripts/op-commit.mjs` (create) | Read token, compute delta, `commitPaths`, report, delete token. |
| `test/op.test.mjs` (create) | Pure-function tests. |
| `test/op-cli.test.mjs` (create) | Both scripts against temp git repos. |
| `skills/wiki-ingest/SKILL.md` (modify) | Bracket the operation. |
| `skills/wiki-relink/SKILL.md` (modify) | Same. |
| `skills/wiki-lint/SKILL.md` (modify) | Same. |
| `skills/wiki-discover/SKILL.md` (modify) | Same. |
| `skills/wiki-query/SKILL.md` (modify) | Bracket **only** the file-the-answer-back branch. |
| `skills/wiki-maintainer/SKILL.md` (modify) | One contract line: every mutating operation brackets itself. |
| `CHANGELOG.md`, 5 manifests (modify) | 0.10.0. **Five**, not four — `.github/plugin/marketplace.json` is the Copilot one, and `test/drift-guard.test.mjs` pins that all five agree. |

**Not modified:** `scripts/lib/git.mjs` — it is complete for this purpose.

---

### Task 1: `lib/op.mjs` — the pure delta

**Files:** create `scripts/lib/op.mjs`, `test/op.test.mjs`

- [ ] **Step 1: failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirtySet, deltaPaths } from '../scripts/lib/op.mjs';

// Porcelain lines are fixed-width `XY <path>` and the leading space in " M path"
// is meaningful. A blanket trim eats it and shifts every column — this exact bug
// shipped once in lib/git.mjs before being caught.
test('dirtySet parses porcelain without eating the leading status column', () => {
  const out = dirtySet(' M wiki/a.md\n?? wiki/b.md\nA  wiki/c.md\n');
  assert.deepEqual([...out].sort(), ['wiki/a.md', 'wiki/b.md', 'wiki/c.md']);
});

test('dirtySet strips the quote pair git adds around non-ASCII paths', () => {
  assert.deepEqual([...dirtySet(' M "Gottman — R.md"\n')], ['Gottman — R.md']);
});

test('dirtySet on a clean tree is empty', () => {
  assert.deepEqual([...dirtySet('')], []);
});

// The whole point: work the user already had in flight is never attributed to
// the operation.
test('deltaPaths excludes what was already dirty', () => {
  const before = new Set(['wiki/draft.md']);
  const after = new Set(['wiki/draft.md', 'wiki/new.md']);
  assert.deepEqual(deltaPaths(before, after), ['wiki/new.md']);
});

test('deltaPaths is sorted, for the same cross-machine reason planPurge sorts', () => {
  const r = deltaPaths(new Set(), new Set(['wiki/b.md', 'wiki/a.md']));
  assert.deepEqual(r, ['wiki/a.md', 'wiki/b.md']);
});

test('deltaPaths on no change is empty', () => {
  assert.deepEqual(deltaPaths(new Set(['x']), new Set(['x'])), []);
});
```

- [ ] **Step 2: verify RED** — `node --test test/op.test.mjs` → module not found.

- [ ] **Step 3: implement**

```js
// Porcelain is `XY <path>`, fixed width, and the leading space in " M path"
// means "modified but not staged". Slice by column; never trim the line.
// git wraps non-ASCII paths in quotes even under core.quotePath=false — measured
// against git-for-windows 2.55 — so the pair is stripped with an anchored match
// that cannot eat a lone quote from a POSIX filename.
export function dirtySet(porcelain) {
  return new Set(
    porcelain
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"(.*)"$/, '$1'))
  );
}

// What this operation touched: dirty now, minus dirty before it started. Sorted
// so two machines produce identical commits from identical work.
export function deltaPaths(before, after) {
  return [...after].filter((p) => !before.has(p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
```

- [ ] **Step 4: verify GREEN**, then `npm test`.
- [ ] **Step 5: commit** — `git add scripts/lib/op.mjs test/op.test.mjs && git commit -m "feat(op): pure dirty-set delta for operation-scoped commits"`

---

### Task 2: `op-begin.mjs` and `op-commit.mjs`

**Files:** create `scripts/op-begin.mjs`, `scripts/op-commit.mjs`, `test/op-cli.test.mjs`

- [ ] **Step 1: failing tests.** Build temp git repos (`git init`, set `user.email`/`user.name`), point `WIKI_MASTER_VAULT` at them (save and restore), capture console output and `process.exitCode`. Cover at minimum:

| # | Test | Guards |
|---|---|---|
| 1 | An op commits exactly the files it touched | The core claim |
| 2 | A file dirty **before** the op is not committed, and is reported | The `git add -A` failure this exists to avoid |
| 3 | A file the user pre-**staged** is not committed | `git commit` narrowing — this bit once already |
| 4 | An op that changed nothing creates no commit | No empty "ingest" commits |
| 5 | A never-committed new file commits fine | `--pathspec-from-file` atomicity — this bit once already |
| 6 | A missing or corrupt token fails loudly with `exitCode = 1` | An unbracketed op must not look successful |
| 7 | Not a git repo → clear message, exit 0 | A vault need not be a repo |
| 8 | The token file is deleted after a successful commit | No leaked scratch state |

- [ ] **Step 2: verify RED.**

- [ ] **Step 3: implement.** `op-begin.mjs` writes `{ op, startedAt, dirty: [...] }` to `.wiki-master/ops/<token>.json` and prints the token on stdout (so a skill can capture it). `op-commit.mjs --op <op> --title "<title>" --since <token>` reads it, computes `deltaPaths`, calls `commitPaths(vaultPath, paths, \`<op>: <title>\`)`, prints what it committed and what it deliberately left alone, deletes the token, and **never pushes** — same rule as purge; pushing is outward-facing and belongs to a confirmation step. Report unpushed commit count (`git rev-list --count @{u}..HEAD`, tolerating no upstream) so the gap is visible without being acted on.

- [ ] **Step 4: verify GREEN**, then `npm test`.

- [ ] **Step 5: MANDATORY mutation table.** For each guard — the pre-dirty exclusion, the pre-staged exclusion, the empty-delta check, the token-missing check — delete it, confirm a test fails, restore. Report real numbers. A guard no test defends is the failure mode this project hit repeatedly.

- [ ] **Step 6: commit.**

---

### Task 3: bracket the four mutating skills

**Files:** modify `skills/wiki-ingest/SKILL.md`, `skills/wiki-relink/SKILL.md`, `skills/wiki-lint/SKILL.md`, `skills/wiki-discover/SKILL.md`

- [ ] **Step 1.** In each, wrap the mutating workflow:

```markdown
0. **Open the operation.** `TOKEN=$(node ../../scripts/op-begin.mjs --op <op>)`
   — records what was already uncommitted, so your work is never mixed with the
   user's in-progress writing.

   … existing steps …

N. **Close it.** `node ../../scripts/op-commit.mjs --op <op> --title "<what happened>" --since $TOKEN`
   Commits exactly what this operation touched, as one revertable unit. It does
   not push; offer that separately if the user wants it.
```

- [ ] **Step 2.** `skills/wiki-query/SKILL.md` — bracket **only** the "file the answer back" branch; a read-only query must not open an operation.

- [ ] **Step 3.** `skills/wiki-maintainer/SKILL.md` — one contract line under the vault contract: *every mutating operation brackets itself with `op-begin`/`op-commit`; obsidian-git's timer is a safety net for hand edits in Obsidian, not the mechanism.*

- [ ] **Step 4: commit.**

---

### Task 4: 0.10.0

- [ ] Bump **five** manifests: `package.json`, `plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`. `test/drift-guard.test.mjs` pins that they agree — it caught a four-of-five bump during the purge work.
- [ ] CHANGELOG entry.
- [ ] `npm test`, commit.

---

### Task 5: verify against the real vault

- [ ] Clone the vault to a **short** temp path (`C:/Users/ehart/AppData/Local/Temp/<short>`). A deep path hits Windows `MAX_PATH` — ~50 files fail with `Filename too long` at ~130 characters of prefix, measured.
- [ ] Run a bracketed operation end to end against the clone. Confirm: the commit contains exactly the operation's files; a file left dirty beforehand stays dirty and is reported; the token file is gone.
- [ ] Remove the clone. Confirm the real vault is untouched.

---

## Self-review notes

Covers every section of the spec. Two things deliberately deferred to the user:

1. **Whether `op-commit` should offer to push.** Purge does not; the plan matches it and reports the unpushed count instead. Spec §7 raises it as an open question.
2. **obsidian-git stays on at 15 minutes.** The goal is to make the timer redundant for agent operations, not to remove it — nothing brackets a hand edit made in Obsidian itself.
