# Design: `log/` folder + `log.base` (multi-machine conflict elimination)

**Date:** 2026-07-19
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/log-folder`

## Problem

The wiki syncs across machines via the Obsidian Git plugin (plain-merge). New wiki
pages have unique filenames and auto-merge fine, but `log.md` is a single shared
append-only file that **every** operation (`ingest`, `discover`, `lint`, `relink`,
`query`) writes via `obsidian append path=log.md`. When two machines both append
before syncing, plain merge blocks on a conflict. `log.md` is the routine, recurring
source of merge conflicts.

A `.gitattributes merge=union` rule already prevents *blocking* on `log.md`, but that
is a mitigation (git keeps both sides, possibly interleaved). This design removes the
shared file entirely so a log conflict becomes **structurally impossible**.

## Goal

Never a merge conflict on the log, with low-friction multi-machine use. Achieved by
never writing a shared file: each log entry is its own uniquely-named file. Two
machines writing different filenames cannot collide — git simply takes both.

## Decisions (locked)

- **Migration:** *Freeze as archive.* The existing `log.md` moves verbatim into the
  `log/` folder as a single dated archive note. History is preserved byte-for-byte;
  no lossy parsing. New entries are per-entry files going forward.
- **Log view:** *Obsidian Base only.* A `log.base` renders `log/` chronologically.
  No generated rollup file, nothing to regenerate, nothing that can conflict.

## Architecture

### 1. `scripts/log-entry.mjs` (new — the centerpiece)

A single shared script owns writing a log entry, so naming/frontmatter live in one
tested place rather than being hand-rolled in five skills' prose (mirrors how
`index-gen.mjs` centralizes catalog logic).

- **Invocation:** `node scripts/log-entry.mjs --op <op> --title "<title>"`, with the
  entry body piped on stdin. Resolves the vault via the shared `resolveVault()`
  (same lib `index-gen.mjs` uses).
- **Filename:** `log/YYYY-MM-DD-HHmmss-<op>-<slug>.md`
  - `<slug>` = slugified `title` (lowercase, non-alphanumeric → `-`, collapsed,
    trimmed, length-capped).
  - Sortable by name == chronological. Same-second + same-op + same-slug on two
    machines is effectively impossible; if the target path already exists, the
    script appends a short numeric suffix (`-2`, `-3`, …) so a write never clobbers.
- **File contents:**
  ```
  ---
  date: YYYY-MM-DD
  op: <op>
  title: <title>
  ---
  ## [YYYY-MM-DD] <op> | <title>

  <body from stdin>
  ```
  Frontmatter drives the Base and is typed/queryable. The `## [date] op | title`
  heading preserves the current grep-parseable convention.
- Prints the written path to stdout (so a skill can confirm / link it).

### 2. `log.base` (new Obsidian Base)

Modeled on the vault's existing `stale.base`. Source: the `log/` folder. Default
view: table sorted by `date` descending (newest first), columns `date · op · title`.
This *is* the log view; there is no aggregate markdown file to maintain.

A template lives in `templates/` and is written by `init.mjs` for new vaults.

### 3. `scripts/init.mjs` (modified)

New-vault scaffolding creates `log/` (empty) and `log.base` instead of an
append-target `log.md`. It also writes the immutable `log.md` pointer stub (below).

### 4. Skill prose (modified)

The five logging skills — `wiki-ingest`, `wiki-discover`, `wiki-lint`,
`wiki-relink`, `wiki-query` — replace `obsidian append path=log.md` with
`node scripts/log-entry.mjs --op <op> --title "…"` (body on stdin), resolved
relative to the skill directory like the existing `index-gen.mjs` calls.

The `wiki-maintainer` "The log" contract section is rewritten:
- Log = the `log/` folder, one file per operation, viewed via `log.base`.
- Remove the "append ONLY / never rewrite / unreconstructable lost-update" guardrail
  — per-entry files remove the read-modify-write race that warning existed for.
- Keep the grep-parseable heading convention note (now: grep the `log/` folder).

### 5. Vault migration (one-time, run against the live vault — not plugin code)

1. `git mv log.md log/2026-07-19-000000-archive.md` (valid timestamp shape,
   consistent with the naming scheme; the `000000` places it at the start of the
   freeze day).
2. Prepend frontmatter to the archive: `date: 2026-07-19`, `op: archive`,
   `title: "Log archive (through 2026-07-19)"`. The Base sorts by this `date`, so the
   archive shows as a single dated "everything before the switch" entry at the freeze
   boundary. Body unchanged — verified by a byte-diff of the archive body against the
   pre-move `log.md`.
3. Recreate a tiny **immutable** `log.md` pointer stub: one line pointing to the
   `log/` folder / `log.base`. Never appended to again → cannot conflict. Preserves
   existing `[[log]]` links in `vault-schema.md` and `moc/bid-master-data-quality.md`.
4. Add `log.base` to the vault.

## Data flow

Operation completes → skill runs `node scripts/log-entry.mjs --op … --title …` with
the narrative on stdin → script writes `log/<timestamp>-<op>-<slug>.md` → Obsidian
indexes it, `log.base` shows it, obsidian-git commits it → other machines pull it as
a new file (never a conflict, since the filename is unique to the writing machine's
timestamp).

## Testing (TDD)

Added to the existing `test/*.test.mjs` suite:
- `log-entry.test.mjs`: correct filename shape; slugify rules (case, punctuation,
  length cap, unicode); frontmatter + heading contents; body from stdin passthrough;
  collision → numeric suffix (never overwrites an existing file).
- `init` scaffolding: creates `log/` + `log.base` + stub `log.md`; does **not**
  create an append-target log.md.
- Migration verified operationally: archive body byte-identical to pre-move `log.md`;
  `## [` entry count preserved.

## Rollout

- Implemented on `feat/log-folder`; published, then `/plugin update` on each machine.
- **Order matters:** update all machines *before* running the vault migration. An
  un-updated machine would still `obsidian append` and recreate a shared `log.md`.
  (A stray recreated `log.md` is harmless — foldable into the archive — but updating
  first keeps it clean.)
- The existing `.gitattributes merge=union` rule for `log.md` stays (now moot, since
  `log.md` becomes an immutable stub) — harmless belt-and-suspenders. The `index.md`
  union rule remains genuinely useful.

## Non-goals / YAGNI

- No generated `log.md` rollup (Base-only was chosen).
- No splitting historical entries into per-entry files (freeze-as-archive chosen).
- No random/host suffix in filenames — seconds precision + collision-suffix is enough.
- No plugin-side git operations — obsidian-git remains the sole sync engine.
