---
name: clip-gh
description: Clip a GitHub repository into the wiki as a bounded set of Markdown clippings — clone it to a temp directory (never into the vault), then write per-file clippings for a small repo, or an automatic bounded digest (manifest + per-module listings + a few anchor-file clips) for a large one, so output never scales 1:1 with file count. Use when a source is a GitHub repository (code, docs, or both) rather than a single page, PDF, or document.
argument-hint: "<owner/repo | github-url> [--ref=<branch>] [--quality=high|medium|low] [--topic=\"<topic>\"] [--max-files=N] [--max-groups=N] [--force-full] | --doctor"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/clip-gh.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location and the provenance/`raw/`-immutability
> and clipping guardrails these steps assume. Skip the load if you arrived here mid-run
> from a wiki-master skill that already pulled it in.

# Clipping a GitHub repository into the wiki

A GitHub repository is not one document — it is dozens, hundreds, or (for a
real enterprise monorepo) many thousands of files, each independently
citable. `/wiki-discover`'s clipper (`clip.mjs` → Defuddle) reads a repo's
HTML landing page and gets a thin, mostly-chrome extraction; `clip-docx`/
`clip-pdf` don't apply at all. This skill is the repo path, and it is
deliberately **not** "dump the whole tree into one file" — nor, for a large
repo, "dump the whole tree as one clipping per file" either. `clip-gh.mjs`
clones the repo to a **temp directory** (cleaned up afterward; the clone
itself never touches the vault), walks its real files, excludes
dependency/build/binary/oversized noise, and then picks one of two output
shapes depending on size:

- **Per-file mode** (repo has ≤300 includable files, the default cap): one
  clipping per included file under `raw/clippings/gh/<owner>/<repo>/`, plus
  one `_repo-overview.md` manifest. Multiple small, citable clippings beat
  one giant unquotable blob — the same reasoning behind every other `clip-*`
  script's per-item output.
- **Digest mode** (repo is over the cap): a manifest + a **bounded** number
  of per-module *listing* documents (never one per file) + a small set of
  full-content clips for universally valuable "anchor" files. See its own
  section below — this is the mode a large repo actually needs, and the one
  most likely to matter for an internal platform/monorepo clip.

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

### Per-file mode (small repos)

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

### Digest mode (large repos — output bounded, not 1:1 with file count)

Built after a real clip against a ~10,000-file Salesforce DX monorepo, in
per-file mode, wrote 5,118 separate clippings — one per source file — none
linked from anywhere yet, which flooded the vault's (and Obsidian's own)
orphan/graph view before `/wiki-ingest` had a chance to cross-reference any
of them. Digest mode is "some combination of listings and summary" instead:

- **`_repo-overview.md` (digest manifest)** — description, primary language,
  ref, and two BOUNDED tables: a **composition** breakdown (extension →
  count — bounded by the number of distinct extensions, not files) and a
  **modules** breakdown (module name → file count for every module group,
  bounded by the group cap below). Never a per-file bullet list — that
  would itself scale 1:1 with file count, the exact thing digest mode
  exists to avoid.
- **One *listing* document per module group** — a table of file path, size,
  and language hint, **never file content**. Groups are computed by
  recursively splitting the repo's real directory structure only where a
  directory has too many files to summarize in one listing (see
  `groupIntoModules` in `clip-gh.mjs` for the exact algorithm), capped at
  150 groups by default (`--max-groups=N` to change it) with each group
  capped at 150 files before it is split further. A repo with 10 files and
  one with 10,000 both produce a small, bounded number of listings — the
  big repo's groups are just bigger, up to the cap, never more numerous
  without limit. Verified against the real repo that motivated this:
  9,874 files represented across exactly 150 listings, zero files lost —
  the sum of every listing's file count equals the total included count.
- **A small set of full-content "anchor" clips** — README (and common
  variants/monorepo-package READMEs), LICENSE, CHANGELOG, and top-level
  project manifests (`package.json`, `sfdx-project.json`, `pom.xml`,
  `Cargo.toml`, `go.mod`, etc.), matched by basename only and capped at 15 —
  never a heuristic "biggest file" or "most complex" guess, which would have
  no principled basis for "important."

**Digest mode does NOT try to auto-generate "key modules" or "notable
pattern" prose.** That is a genuine summarization/judgment task — reading
real code and deciding what is actually architecturally interesting — and
belongs in `wiki/sources/` (or `wiki/concepts/`) as a normal, human/agent-
curated `/wiki-ingest`-style synthesis citing the digest's manifest and
listings as evidence, not something a deterministic extraction script should
guess at. After a digest lands, read the manifest's module table plus a
representative sample of the largest/most distinctive modules (the listings
tell you what exists and roughly how large each module is), then write a
**small, bounded** number of `wiki/sources/` pages — a handful, not one per
module — covering genuinely notable modules, architectural patterns, or
approaches. Conservative: most modules in most repos do not warrant their
own write-up; a handful of the most interesting ones do.

**Dedup is per-repo, content-hash-based, not URL-based like other
`clip-*` scripts**, in both modes. Because a repo clip produces many files,
not one, `clip-gh.mjs` reads the `source-hash` already recorded in every
existing clipping under that repo's own output directory and skips writing
any file whose extracted content hashes the same as before — so re-running
against an unchanged repo (or one where most content didn't change) reports
things as `unchanged` rather than rewriting them. There is no separate
`--decline` re-clip guard keyed on file-within-repo; declines are recorded
and checked at the whole-repo level (`github.com/<owner>/<repo>`), same
shape as every other source type's decline key.

**Digest mode re-clips prune stale listings automatically.** Module
grouping is recomputed fresh on every run (see `groupIntoModules`'s own
comment for why groups are bounded, not 1:1 with file count) — so a re-clip
of a repo that has grown, shrunk, or reorganized enough to cross a
splitting threshold can produce different group boundaries than the prior
run. Rather than leaving the old run's now-meaningless listings sitting in
`raw/` forever (a slow-motion version of exactly the clutter problem digest
mode exists to avoid), `clip-gh.mjs` compares this run's expected filenames
(manifest + every current listing + every current non-thin anchor) against
what is actually in the output directory and deletes anything unexpected,
reporting it as `pruned`. Verified against the real repo that motivated
digest mode: forcing a grouping change via a lower `--max-groups` between
two runs correctly pruned every one of the prior run's now-obsolete
listings, with zero data loss (the module table's file counts still summed
to the full included total) and a further identical re-run pruning nothing.
This only applies to digest-mode output (listings/manifest/anchors); a
per-file-mode clipping for a source file renamed or deleted upstream is
**not** currently pruned — that remains a known gap.

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
   - `--max-files=N` raises the default 300-includable-file per-file-mode
     cap. Above the cap, digest mode kicks in automatically (see above) —
     nothing is refused silently, and nothing floods the vault with
     thousands of files either.
   - `--max-groups=N` raises the default 150-module-listing cap in digest
     mode, if a repo's real structure warrants more (or fewer) groups than
     the default gives it.
   - `--force-full` bypasses digest mode and forces the old exhaustive
     per-file behavior on a large repo — combine with a `--max-files` raised
     past the repo's real file count, since the size cap still applies.
     Only reach for this if per-file fidelity on every single file is
     genuinely needed; it reintroduces the exact scaling problem digest
     mode exists to avoid.
   - **`--topic` whenever this clip belongs to a research run** — pass the
     topic string `/wiki-discover` was given, identical across every clip in
     the run, so `/wiki-triage` can group the run's leftovers together.
     **Topic is recorded going forward only and no tool can retro-fit it**,
     so a clip made without it is an *Unattributed* triage row permanently.
     Omit it only when there is no research run behind the clip; never
     invent one.
   - A `too-many-files` result (only reachable with `--force-full`) means
     the cap was hit — re-run with a higher `--max-files` per the message,
     or drop `--force-full` to get a digest instead; nothing was written.
   - A `failed` result means `gh repo clone` itself errored (bad repo name,
     no access, network) — report it for manual handling; do not invent files.
3. **Verify** the clippings landed: `ls raw/clippings/gh/<owner>/<repo>/` and
   spot-read a few files plus `_repo-overview.md` — confirm the language
   fencing and blob-URL citations look right for a couple of samples (per-file
   mode), or that the composition/module tables and a listing or two look
   sensible (digest mode).
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping batch —
   summarize into `wiki/sources/`, cross-reference, index, log. Start from
   `_repo-overview.md` for the repo-level summary, then pull in individual
   files (per-file mode) or a curated set of key-module write-ups informed
   by the listings (digest mode) as evidence for specific claims. The
   ingest is gated by the user as usual.

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
- **A digest's "key modules" write-ups are synthesis, not evidence** — they
  belong in `wiki/sources/` (or `wiki/concepts/`) with `ai-generated: true`
  and `sources:` citing the digest's manifest/listings, exactly like any
  other ingest summary; never written into `raw/` as if they were
  verbatim source content.

