---
name: clip-gh
description: Clip a GitHub repository into the wiki as a series of per-file Markdown clippings — clone it to a temp directory (never into the vault), then write one clipping per included source file under raw/clippings/gh/<owner>/<repo>/, plus one repo-overview manifest. Use when a source is a GitHub repository (code, docs, or both) rather than a single page, PDF, or document.
argument-hint: "<owner/repo | github-url> [--ref=<branch>] [--quality=high|medium|low] [--topic=\"<topic>\"] [--max-files=N] | --doctor"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/clip-gh.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location and the provenance/`raw/`-immutability
> and clipping guardrails these steps assume. Skip the load if you arrived here mid-run
> from a wiki-master skill that already pulled it in.

# Clipping a GitHub repository into the wiki

A GitHub repository is not one document — it is dozens or hundreds of files,
each independently citable. `/wiki-discover`'s clipper (`clip.mjs` → Defuddle)
reads a repo's HTML landing page and gets a thin, mostly-chrome extraction;
`clip-docx`/`clip-pdf` don't apply at all. This skill is the repo path, and it
is deliberately **not** "dump the whole tree into one file": `clip-gh.mjs`
clones the repo to a **temp directory** (cleaned up afterward; the clone
itself never touches the vault), walks its real files, excludes
dependency/build/binary/oversized noise, and writes **one clipping per
included file** under `raw/clippings/gh/<owner>/<repo>/`, plus one
`_repo-overview.md` manifest that lists what was included/excluded. Multiple
small, citable clippings beat one giant unquotable blob — the same reasoning
behind every other `clip-*` script's per-item output.

## How it works

`clip-gh.mjs` shells out to the **`gh` CLI** (`gh repo clone owner/repo <tmp>
-- --depth 1`), so cloning transparently uses the user's existing `gh auth`
session — private repos the user can already see on the command line work
with no extra config. It never runs a bare `git clone`, and it never writes
into the temp clone's own `.git` history.

**"Don't clip the whole repo contents" is enforced by three curated
exclusion rules, not full `.gitignore` parsing:**
- **Directories**, matched by name at any depth: `.git`, `node_modules`,
  `vendor`, `dist`, `build`, `target`, `.venv`/`venv`, `__pycache__`, `.next`,
  `.nuxt`, `coverage`, `.terraform`, `bower_components`. (`.github/` is
  deliberately **not** excluded — CI workflow YAML is real, clippable
  content; only the specific named directories above are.)
- **Extensions**, binary/media/archive/compiled: images, fonts, archives,
  executables/object files, audio/video, PDFs, databases.
- **Exact basenames**, generated lockfiles: `package-lock.json`,
  `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `poetry.lock`, `Gemfile.lock`,
  `composer.lock`, `go.sum`.
- **Size ceiling**: 256 KB per file, regardless of extension.

Each **included** file becomes one clipping: a `.md`/`.mdx` file is stored
as-is (never re-fenced — fencing a Markdown file would nest its own headings
and code fences inside an outer fence and break both); every other file is
wrapped in a language-hinted fenced code block (```javascript, ```python,
etc. — a small lookup table, not exhaustive; falls back to a bare fence with
no hint for anything unrecognized) so it reads as quotable source. The
citation is the file's real GitHub blob URL at the exact commit clipped
(`.../blob/<sha-or-ref>/<path>`), not the repo root — so a later reader lands
on the exact file and line range, not a generic landing page. A file whose
extracted content is under ~20 words (a stub, a near-empty config) is skipped
as **thin** — lower than the ~100-word floor other clippers use, since a real
5-line script or config is still worth a clipping even though a 5-line HTML
snippet usually isn't.

The **`_repo-overview.md`** manifest is the one clipping that represents the
repo itself rather than a file in it: it cites the repo's tree URL (not a
blob), and lists the description, primary language, ref clipped, and the
full included/excluded file lists. It is the natural entry point
`/wiki-ingest` reaches for first when summarizing a freshly-clipped repo.

**Dedup is per-repo, content-hash-based, not URL-based like other
`clip-*` scripts.** Because a repo clip produces many files, not one,
`clip-gh.mjs` reads the `source-hash` already recorded in every existing
clipping under that repo's own output directory and skips writing any
file whose extracted content hashes the same as before — so re-running
against an unchanged repo (or one where most files didn't change) reports
files as `unchanged` rather than rewriting them, and only genuinely new or
edited files get a fresh clipping. There is no separate `--decline` re-clip
guard keyed on file-within-repo; declines are recorded and checked at the
whole-repo level (`github.com/<owner>/<repo>`), same shape as every other
source type's decline key.

## Steps

1. **Preflight** (once, or whenever a clip fails unexpectedly):
   `node ../../scripts/clip-gh.mjs --doctor` — reports whether the `gh` CLI
   is installed and authenticated.
2. **Clip** (this is the only writer to `raw/` for GitHub repos):
   `node ../../scripts/clip-gh.mjs <owner/repo | github-url> --quality=<tier> --topic="<topic>"`
   - Accepts a bare `owner/repo`, a full `https://github.com/owner/repo` URL
     (`.git` suffix optional), or a `git@github.com:owner/repo.git` remote —
     all resolve to the same identity.
   - `--ref=<branch-or-tag>` clips a specific branch/tag instead of the
     repo's default branch.
   - `--max-files=N` raises the default 300-includable-file cap. If a repo
     has more includable files than the cap, **nothing is written** and the
     script reports the real count so you can decide to raise the cap or
     narrow with `--ref` to a smaller subtree — this vault does not clip a
     huge repo silently.
   - **`--topic` whenever this clip belongs to a research run** — pass the
     topic string `/wiki-discover` was given, identical across every clip in
     the run, so `/wiki-triage` can group the run's leftovers together.
     **Topic is recorded going forward only and no tool can retro-fit it**,
     so a clip made without it is an *Unattributed* triage row permanently.
     Omit it only when there is no research run behind the clip; never
     invent one.
   - A `too-many-files` result means the cap was hit — re-run with a higher
     `--max-files` or a narrower `--ref` per the message; nothing was written.
   - A `failed` result means `gh repo clone` itself errored (bad repo name,
     no access, network) — report it for manual handling; do not invent files.
3. **Verify** the clippings landed: `ls raw/clippings/gh/<owner>/<repo>/` and
   spot-read a few files plus `_repo-overview.md` — confirm the language
   fencing and blob-URL citations look right for a couple of samples.
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping batch —
   summarize into `wiki/sources/`, cross-reference, index, log. Start from
   `_repo-overview.md` for the repo-level summary, then pull in individual
   files as evidence for specific claims. The ingest is gated by the user as
   usual.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped content is
  immutable source-of-truth (guardrail #1). Frontmatter is pipeline state,
  tooling-only.
- `clip-gh.mjs` is the **sole writer** to `raw/` for GitHub repos — the model
  never writes a clipping by hand (that would bypass dedup, decline, and
  hashing), and never leaves the temporary clone behind (cleaned up in a
  `finally`, success or failure).
- **Fidelity, not truth**: a faithful clip of the wrong branch or an outdated
  fork is still wrong — confirm the `owner/repo` (and `--ref`, if given) is
  the one actually meant before citing it.
