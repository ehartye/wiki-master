# Changelog

## 0.30.0 — 2026-09-01

### Feat: split wiki-query into wiki-search (retrieval) + wiki-query (synthesis), and give search real raw/ coverage

`wiki-query` bundled three distinct responsibilities under one name: search
the wiki, synthesize a cited answer, and optionally file that answer back
as a new page. Only the first is actually "search" — reported after a user
noticed agents grepping `raw/` directly instead of using any wiki-master
tool, prompting a closer look at why.

**Root cause, confirmed live, not guessed**: Obsidian's own full-text index
already covers `raw/` fine (`obsidian search query=... path=raw` returns
real hits) — the semantic/chunk index deliberately excludes it (a
documented, unchanged decision: embedding raw/ would roughly triple the
index), but the **keyword** tier had zero reason to exclude it and did
anyway, via one hardcoded `path=wiki` in `keywordSearch()`. There was
previously no tool-assisted way to search `raw/` at all, which is exactly
why agents fell back to a shell grep.

**Fixes the actual gap**: `keywordSearch()` gains an optional `path` param
(default `'wiki'`, unchanged for every existing caller). `search()` gains an
optional `rawKeywordSearch` dep — absent for every existing caller
(`purge.mjs`'s `collectSeeds` included, fully unaffected) — that appends
`raw/` hits after the normal tiering result, tagged `zone: 'raw'`, never
blended into the RRF-fused ranking (raw/ isn't chunked, so there's nothing
to fuse it against, and blending unvetted evidence into reviewed wiki/
results would erase a distinction that matters). `renderResult()` discloses
the raw hit count explicitly, including `0`, so a caller can tell "checked,
found nothing" apart from "never checked." New CLI flag:
`node scripts/search.mjs "..." --include-raw`.

**Splits the skill** to match: new `skills/wiki-search/SKILL.md` is pure
retrieval (search + health disclosure + `--include-raw`, no synthesis, no
writes). `skills/wiki-query/SKILL.md` keeps its name (still the natural fit
for "ask a question, get a filed answer") but is narrowed to synthesis and
optional filing, now delegating retrieval to `/wiki-search` instead of
duplicating its search-mechanics prose. `wiki-maintainer`'s workflow list
and `README.md`'s skill table updated to match.

Adds 12 new tests across `test/search.test.mjs`. Full suite (excluding two
pre-existing, unrelated flaky server-timing test files, both confirmed
passing 24/24 in isolation): 817 passing, 1 skipped, 0 failing. Live-tested
against the real vault: ordinary search output is byte-identical to before;
`--include-raw` correctly surfaced real `raw/clippings/` hits alongside
unchanged `wiki/` results, with an explicit disclosed hit count.

## 0.29.1 — 2026-09-01

### Fix: clip-pptx hardcoded `python3`, which is broken on Windows

`clip-pptx.mjs` invoked `python3` directly. The python.org Windows installer
only ever creates `python.exe` — it never writes a `python3.exe` — while
Windows itself ships an always-on-PATH WindowsApps `python3.exe` App Execution
Alias that exits nonzero with "Python was not found". So on Windows `python3`
resolves *and* fails, and because the clipper's fallback reachability probe was
hardcoded to the same name, it then reported `python-pptx not found` on
machines where Python and python-pptx were both correctly installed — pointing
the user at the wrong fix entirely.

New `pickPython()` in `scripts/clip-pptx.mjs` resolves the interpreter by
RUNNING candidates (`python3`, `python`, `py`) rather than trusting a name. It
makes two passes: the first accepts only a candidate that can `import pptx`, so
a working interpreter lacking the library never shadows a later one that has it;
the second accepts any interpreter that merely runs, which keeps "no Python at
all" distinguishable from "Python, but no python-pptx" — the two need different
fixes and previously produced the same message. The missing-library error now
names the resolved interpreter and suggests `<cmd> -m pip install python-pptx`,
since installing into a different interpreter than the one running the helper is
the exact silent failure this bug produced.

`skills/clip-pptx/SKILL.md`'s preflight step carried the same hardcoded probe
and is updated to match, so an agent following the skill no longer reaches the
same wrong conclusion.

Verified on Windows with the real Store-alias shape in place: the previous code
exits 1 with the misleading message; the new code falls back to `python` and
clips the deck successfully.

## 0.29.0 — 2026-08-27

### Fix: clip-gh digest mode re-clips no longer leave stale listings behind

Digest mode (0.28.0) recomputes module grouping fresh on every run — so a
re-clip of a repo that has grown, shrunk, or reorganized enough to cross a
splitting threshold produces different group boundaries than the prior
run, and the old run's now-meaningless listings had nowhere to go: nothing
cleaned them up. Left unaddressed across repeated re-clips of an
actively-developed repo, that is a slow-motion version of the exact
clutter problem digest mode itself exists to avoid — just smaller and
quieter than one big 1:1 dump.

New `findStaleDigestFiles()` in `scripts/clip-gh.mjs`: after writing a
digest, compares the run's actual expected filenames (manifest + every
current listing + every current non-thin anchor) against what is really in
the output directory, and deletes anything unexpected — reporting it as
`pruned` in the run's console output. An anchor file that has since become
thin is correctly treated as no longer expected too, not just a grouping
change.

Verified against the real repo that motivated digest mode: forcing a
grouping change between two runs (via a lower `--max-groups`) correctly
pruned all 132 of the prior run's now-obsolete listings, with the module
table's file counts still summing to the exact full included total (zero
data loss), and a further identical re-run pruning nothing (fully stable,
no oscillation).

Scoped to digest-mode output only — a per-file-mode clipping for a source
file renamed or deleted upstream is not currently pruned; documented as a
remaining known gap in the skill doc rather than silently left unstated.

Adds 6 new tests in `test/clip-gh.test.mjs`. Full suite: 827 passing, 1
skipped, 0 failing.

## 0.28.0 — 2026-08-26

### Feat: clip-gh digest mode — bounded output for large repos, never 1:1 with file count

A real clip against a ~10,000-file Salesforce DX monorepo, in the original
one-clipping-per-file mode, wrote 5,118 separate clippings — none linked
from anywhere yet — which flooded the vault's (and Obsidian's own)
orphan/graph view before `/wiki-ingest` had a chance to cross-reference any
of them. Removing that clip and rethinking the approach led to digest mode:
for a repo over the per-file cap (default 300 files), `clip-gh.mjs` now
writes a **bounded** set of documents instead of refusing or scaling
linearly with file count — "some combination of listings and summary."

- **Digest manifest** (`_repo-overview.md`): description/language/ref plus
  two bounded tables — a **composition** breakdown (extension → count) and
  a **modules** breakdown (module name → file count) — never a per-file
  bullet list, which would itself scale 1:1 with file count.
- **One *listing* per module group** — a table of file path/size/language,
  never file content. New `groupIntoModules()` computes groups by
  recursively splitting the repo's real directory structure only where a
  directory has too many files to summarize in one listing, capped at 150
  groups by default (`--max-groups=N`) with each group capped at 150 files
  before further splitting. A repo with 10 files and one with 10,000 both
  produce a small, bounded number of listings — the big repo's groups are
  just bigger, up to the cap, never more numerous without limit. The
  grouping algorithm's core invariant — no file is ever lost or
  double-counted across groups — is directly unit-tested, including a
  stress test against 5,000 synthetic top-level directories.
- **A small set of full-content "anchor" clips** — new `selectAnchorFiles()`
  deterministically matches README (and monorepo-package variants),
  LICENSE, CHANGELOG, and top-level project manifests (`package.json`,
  `sfdx-project.json`, `pom.xml`, `Cargo.toml`, `go.mod`, etc.) by basename
  only, capped at 15 — never a heuristic "biggest file" guess, which would
  have no principled basis for "important."

Digest mode does **not** attempt to auto-generate "key modules" or "notable
pattern" prose — that is a genuine summarization/judgment task belonging in
`wiki/sources/` as a normal `/wiki-ingest`-style synthesis citing the
digest as evidence, not something a deterministic script should guess at.
The skill doc now describes this as an explicit follow-up: read the
manifest's module table plus a sample of the largest/most distinctive
modules, then hand-write a small, bounded number of `wiki/sources/` pages —
conservative, not one per module.

A repo over the cap no longer refuses outright: digest mode is now the
default over-cap behavior, with a new `--force-full` flag (combined with a
raised `--max-files`) to opt into the old exhaustive per-file behavior when
genuinely needed.

Re-verified against the real repo that motivated this: **9,874 files
represented across exactly 150 listing documents** (down from 5,118
separate per-file clippings) — the sum of every listing's file count
equals the total included count (zero data loss), re-running is fully
idempotent, and the vault's own orphan metric showed zero new orphans from
the clip (it already excludes `raw/`; the practical win is Obsidian's own
native graph view now sees 160 total documents instead of 5,118).

Adds `groupIntoModules`, `moduleListingContent`, `selectAnchorFiles`, and
`digestManifestContent` to `scripts/clip-gh.mjs`, plus 24 new tests in
`test/clip-gh.test.mjs`. Full suite: 821 passing, 1 skipped, 0 failing (one
unrelated pre-existing flaky test file — `triage-auth`, port/timing-based —
confirmed passing reliably in isolation).

## 0.27.0 — 2026-08-26

### Fix: clip-gh silently overwrote clippings on repos with long, deeply-nested paths

Found in real production use, clipping a large Salesforce DX repo
(`sfdx-source/.../lwc/SomeVeryLongComponentName/SomeVeryLongComponentName.js`
-style paths, routinely 130+ characters deep): `clip-gh.mjs` reused
`clip.mjs`'s shared `slugify()` — built for short article titles — to name
each per-file clipping. `slugify()` truncates at a fixed 120 characters, and
many real repos have several sibling files sharing one long directory prefix
that differ only in their last few characters (`Foo.js` vs `Foo.html` vs
`Foo.js-meta.xml`, or `...MockWith4Records.json` vs
`...MockWith8Records.json`). Truncating at a fixed length collapsed every
one of them to an **identical output filename**, and each subsequent write
silently overwrote the file written before it — no error, no warning.
Measured against the real repo that surfaced this: **49 files silently lost**
in a single clip run (a reported `clipped: 5118` did not match the 5,069
distinct files actually left on disk afterward — that discrepancy is what
led to the investigation).

New `slugifyRepoPath()` in `scripts/clip-gh.mjs`, used only for per-file
output naming (repo/owner directory naming is unaffected — those are short
GitHub identifiers with no collision risk). Same character-substitution rule
as `slugify()`, but truncation only kicks in above a longer, filesystem-safe
ceiling (100 characters), and when a path does exceed it, a short hash of
the **full original path** — not the truncated remainder — is appended, so
any two paths differing anywhere, even only in their last few characters,
still resolve to different filenames. A pure function of the repo-relative
path alone (no dependency on write order or which sibling files exist), so
re-running against an unchanged repo still maps one source file to the same
output filename every time, preserving dedup correctness.

Adds 6 new tests in `test/clip-gh.test.mjs`, including a direct regression
pin using the real colliding paths from the bug report. Re-verified against
the real ~10k-file repo that surfaced this: 5,118 non-thin files now produce
5,118 distinct slugs — zero collisions, longest slug safely bounded at 100
characters. Full suite: 797 passing, 1 skipped, 0 failing.

## 0.26.0 — 2026-08-26

### Fix: repair the vault's actual DOMINANT `sources:` YAML defect (508 pages), missed by 0.25.0's validation

0.25.0 fixed 322 pages with an inline/quoted-scalar `sources:` defect, and
claimed "0 problems across all 1,139 `wiki/*.md` files" — but that validation
only checked that `yaml.safe_load()` did not throw, never that the *parsed
value* was actually a list of strings. That missed the vault's real dominant
defect shape, reported live by a user after 0.25.0 shipped: an unquoted block
list —

```yaml
sources:
  - [[A]]
  - [[B]]
```

— parses **successfully**, but into a nested list (a list containing a
one-item list containing a string), not a list of strings. This is silently
wrong, not a parse error, which is exactly why the earlier exception-based
check missed it. A fresh scan that actually inspects each parsed item's type
found it on **508 pages** across `wiki/sources`, `wiki/concepts`,
`wiki/entities`, and `wiki/syntheses` — more than the 322 pages the previous
release fixed. A further one-off, `wiki/concepts/Models API.md`, had a
distinct triple-dash corruption (`- - - wiki/sources/X`, wikilink brackets
stripped entirely) and was hand-fixed directly rather than folded into a
general-purpose fixer for one occurrence.

**Root cause, not just the symptom**: `templates/vault-schema.md` and two
skill files (`wiki-maintainer/SKILL.md`, `wiki-ingest/SKILL.md`) all showed
this exact unquoted shape as the canonical `sources:` example. Every
hand-authored page kept reproducing the defect even after 0.25.0's repair —
including pages written earlier in the *same session* that shipped 0.25.0.
All three docs now show the correct quoted shape (`sources: ["[[A]]",
"[[B]]"]`), with an explicit callout in `wiki-ingest/SKILL.md` naming both
invalid shapes so this does not recur a third time.

New `fixBlockSources()` in `scripts/lib/backfill.mjs` rewrites only block-list
item lines that are exactly `- [[...]]` (nothing else on the line) into
`- "[[...]]"`, preserving the block-list shape (better for long multi-source
pages than collapsing to one inline flow-sequence line) — already-quoted or
prose-prefixed items in the same list are left untouched. Wired into
`scripts/repair-inline-sources.mjs` alongside the existing `fixInlineSources`,
so one driver run now repairs both defect shapes. Adds 10 new tests in
`test/backfill.test.mjs`, and corrects one existing test (and its
supporting comment in `backfill.mjs`) that had wrongly asserted a bare block
list was "already correct."

Re-validated the real vault with a stricter checker (parses `sources:` and
asserts every item is a string, not just that parsing succeeds): **0
problems across all 1,140 `wiki/*.md` files.** `health.mjs` confirms no new
broken links (6 broken, all pre-existing deferred forward-links, 0
defect/stale).

## 0.25.0 — 2026-08-26

### Feat: clip a GitHub repository into the wiki as per-file clippings

A GitHub repository is not one document — it is dozens or hundreds of
independently-citable files, and dumping a whole tree into a single clipping
would be both unquotable and unreviewable. New `scripts/clip-gh.mjs` +
`skills/clip-gh/` close this gap: it shells out to the `gh` CLI to clone a
repo to a **temp directory** (`gh repo clone owner/repo <tmp> -- --depth 1`,
transparently using the caller's existing `gh auth` session; cleaned up in a
`finally`, success or failure — the clone never touches the vault), walks its
real files, and writes **one clipping per included file** under
`raw/clippings/gh/<owner>/<repo>/`, plus one `_repo-overview.md` manifest
citing the repo's tree URL and listing what was included/excluded.

"Don't clip the whole repo contents" is enforced by three curated exclusion
rules rather than full `.gitignore` parsing: dependency/build directories at
any depth (`node_modules`, `vendor`, `dist`, `build`, `.venv`, `__pycache__`,
etc. — `.github/` is deliberately spared, since CI workflow YAML is real
content), binary/media/archive/compiled extensions, and generated lockfiles
by exact basename, plus a 256 KB per-file size ceiling. A repo whose
includable-file count exceeds a 300-file default cap writes nothing and
reports the real count instead of clipping silently; `--max-files=N` raises
it and `--ref=<branch>` can narrow to a smaller subtree.

Each included file is clipped with a real GitHub blob URL citation at the
exact commit clipped (`.../blob/<sha-or-ref>/<path>`, not the repo root) —
`.md`/`.mdx` files are stored as-is, everything else is wrapped in a
language-hinted fenced code block from a small extension lookup table. A
file under a ~20-word floor (lower than other clippers' ~100-word floor,
since a real short script or config is still worth a clipping) is skipped as
thin. Dedup is per-repo and content-hash-based rather than URL-based like
other `clip-*` scripts: because one clip produces many files, `clip-gh.mjs`
reads the `source-hash` already recorded under that repo's own output
directory and only writes files whose content actually changed, reporting
`unchanged` for the rest — verified end-to-end against a real small public
repo (multiple real clippings landed, re-running was fully idempotent, temp
clone directories left no trace, and `health.mjs --backlog` correctly
recognized the new subdirectory files as part of the ingest backlog).

Adds `skills/clip-gh/SKILL.md` and `test/clip-gh.test.mjs` (pure unit tests
covering repo-spec parsing across `owner/repo`/URL/SSH-remote shapes, the
exclusion rules, blob-URL construction, language-hint lookup, and the
frontmatter/hash contract for both the per-file and manifest clippings; no
live network call in the suite itself).

### Fix: repair vault-wide invalid `sources:` frontmatter YAML

Obsidian's "type mismatch, expected list" lint surfaced a real, widespread
defect: 322 vault pages had a `sources:` frontmatter value that Obsidian's
own link renderer tolerated but was not actually valid YAML, discovered via
exhaustive PyYAML validation (the vault's own tooling uses a
regex-tolerant convention that didn't catch it, and no existing health/lint
check did either). Three distinct shapes were found and fixed:

- **283 files** — an inline, comma-joined list of wikilinks
  (`sources: [[A]], [[B]], [[C]]`): each `[[X]]` is a nested flow sequence
  one bracket pair too many, and multiple comma-joined bracket groups don't
  parse as one legal flow value without an enclosing pair.
- **35 files** — a quoted single scalar (`sources: "[[X]]"`): valid YAML,
  but a string, not a list.
- **4 files** — an otherwise-correct block list where an item's link title
  ended in a bare `?` immediately before `]]`, which breaks flow-sequence
  parsing one level down even inside a block list; hand-fixed directly
  rather than generalized into a broader "quote every risky character"
  pass, since that would have touched 54 files when only these 4 actually
  failed to parse.

New `fixInlineSources()` in `scripts/lib/backfill.mjs` (with
`scripts/repair-inline-sources.mjs` as its dry-run/`--apply` driver) rewrites
both bulk shapes into a **quoted flow-sequence** —
`sources: ["[[A]]", "[[B]]"]` — matching the vault's own pre-existing
`insertSources()` convention, chosen specifically because quoting sidesteps
the nested-bracket/special-character ambiguity an unquoted block list
reintroduces. Exhaustive PyYAML re-validation after the repair: 0 problems
across all 1,139 `wiki/*.md` files. Adds 15 new tests in
`test/backfill.test.mjs`.

## 0.24.0 — 2026-08-26

### Feat: clip Confluence pages into the wiki

`clip.mjs`'s anonymous Defuddle fetch cannot reach a Confluence Cloud page —
it sits behind Atlassian auth, so the request hits the login wall or an empty
SPA shell, reads as thin content, and gets auto-declined. New
`scripts/clip-confluence.mjs` + `skills/clip-confluence/` close this gap by
shelling out to the separately-installed `confluencer` plugin's `page.mjs`
(the same authenticated fetch the `confluence` skill itself uses), parsing its
provenance header (title / space / page ID / version / updated / URL), and
writing the standard clipping frontmatter — mirroring clip-docx/clip-pdf's
pipeline (thin-content floor, hash-based dedup, slug disambiguation, decline
tracking).

Exporting the page to PDF and running it through the existing `/clip-pdf`
instead was considered and rejected: it is a double lossy conversion
(Confluence storage format → PDF render → `pdftotext` extraction) versus the
one clean hop `page.mjs` already does to Markdown, `clip-pdf.mjs` itself
documents that table extraction can silently mispair rows while reading as
clean prose, and Confluence validation/compliance corpora are dominated by
exactly that shape of content (approval blocks, signature tables,
requirement-to-test traceability matrices). It also would not fix live Jira
macros that already fail to render for `page.mjs`, and stays fully manual per
page regardless.

**Deliberate exception to the portability principle 0.23.0 just established**:
every other `clip-*` skill is self-contained specifically so wiki-master works
the same whether or not some other plugin is installed. This one breaks that
on purpose — `confluencer` is a whole configured, authenticated Atlassian
integration (base URL, account email, API token, connectivity), not a generic
stateless library like `pandoc`/`python-pptx`, and re-implementing an
Atlassian client inside wiki-master to preserve portability would be the wrong
trade. So `confluencer` is treated as an **optional** runtime dependency:
`clip-confluence.mjs` searches every `~/.copilot/installed-plugins/*/`
marketplace folder for it (an explicit `WIKI_MASTER_CONFLUENCER_SCRIPTS`
overrides the search), and degrades gracefully rather than failing confusingly
when it is absent — one clear message and a `confluencer-missing` status,
never a raw `ENOENT`. A new `--doctor` flag reports whether it was found and,
if so, hands off to confluencer's **own** `doctor.mjs` for the auth/config
check wiki-master has no business performing itself.

**Known limitation, documented rather than fixed**: Confluence pages mutate in
place at a stable URL (we watched one page's `Version` climb from 1 to 10 in
an afternoon), but dedup is keyed on bare URL like every other `clip-*`
script — so deliberately re-clipping an updated page currently reads as
`duplicate (already clipped)` and is silently skipped. Flagged in the skill doc
as a candidate for version-aware dedup (URL + Version) if it becomes a real
workflow; not built now to keep this change scoped.

Adds `skills/clip-confluence/SKILL.md`, `test/clip-confluence.test.mjs` (pure
unit tests only — provenance-header parsing, frontmatter/hash contract, and
the plugin-search helper against a scratch temp directory; no live network
call or real confluencer invocation), and a short pointer from `/wiki-discover`
alongside the existing PDF/Word/spreadsheet routing.

## 0.23.0 — 2026-08-26

### Feat: clip PowerPoint decks (.pptx) into the wiki

PowerPoint was the last common Office format `/wiki-discover`'s HTML clipper
(`clip.mjs` → Defuddle) couldn't reach — it only handles web pages, and the
existing `clip-docx`/`clip-xlsx` scripts only handle Word documents and
spreadsheets. A `.pptx` slide deck has neither flowing HTML nor a pandoc input
format at all (`pandoc --list-input-formats` lists `docx`/`odt`/`rtf` but no
presentation format), so it fell through every existing path.

New `scripts/clip-pptx.mjs` + bundled `scripts/lib/pptx-extract.py` close the
gap using **python-pptx**, not LibreOffice — the same category of problem
`clip-xlsx` solved (an OOXML zip pandoc can't read), but pptx's clean answer is
a small, targeted Python library rather than pulling in a large LibreOffice
dependency for one format. The helper is invoked as a subprocess from Node
(`execFileSync('python3', [...])`), mirroring how `clip-docx`/`clip-xlsx` shell
out to `pandoc`/`soffice` — zero new npm packages, one new external-tool
dependency (`pip3 install python-pptx`), with the same reachability-check and
graceful "not installed" error path as its siblings.

**Deliberate design choice**: this is a brand-new, self-contained
implementation shipped inside wiki-master itself — it does not shell out to, or
otherwise runtime-depend on, any other installed Copilot plugin's copy of
python-pptx glue. That keeps wiki-master portable: it works the same whether or
not some other plugin happens to be installed on a given machine.

Covered: slide text (bullets/paragraphs), tables (rendered as markdown tables),
and speaker notes, one `## Slide N` section per slide (numbered to match the
real deck for citation, even when a slide has no extractable text). Explicitly
**not** covered: legacy binary `.ppt` (PowerPoint 97-2003) — python-pptx cannot
read that format at all, so `clip-pptx.mjs` detects the extension and fails
clearly, telling the user to convert to `.pptx` first, rather than attempting a
workaround extraction. New `skills/clip-pptx/SKILL.md` documents the preflight,
usage, and the same "fidelity not truth" / sole-writer-to-`raw/` guardrails as
`clip-docx`/`clip-xlsx`.

## 0.22.2 — 2026-08-25

### Fix: a real, working pdftotext could be misreported as absent

`node scripts/clip-pdf.mjs --doctor` reported `pdftotext is not installed -- no
PDF can be clipped at all` on a machine with a real, working poppler `pdftotext`
(26.01.0) on `PATH`. Two independent bugs in the capability probe, both found live:

- **Bug 1 (the fatal one): stderr silently discarded on a successful probe.**
  `pdftotextCapabilities()` used `execFileSync`, which returns only `stdout` on a
  successful (exit-0) call — stderr was captured only inside the failure
  (non-zero exit) branch. This poppler build exits **0** for both `-h` and `-v`
  and writes its entire banner and usage listing to **stderr**, so the probe saw
  nothing at all and classified a fully functional install as `flavor: 'unknown'`
  — which `pdftotextPresent()` then reported as absent. Switched to `spawnSync`,
  which returns both streams unconditionally regardless of exit code, so this no
  longer depends on which exit-code/stream convention a given build happens to
  use. `probe` is now injectable so this exact regression (exit 0, banner on
  stderr) is asserted deterministically in a test rather than depending on
  whichever `pdftotext` happens to be on the machine running the suite.
- **Bug 2 (found while fixing bug 1): poppler misclassified as Xpdf.** Once
  stderr was actually captured, the flavor heuristic checked for `Glyph & Cog`
  (Xpdf's author) *before* `poppler` — but poppler is a fork of Xpdf's original
  codebase and its own real banner still credits `Glyph & Cog, LLC` alongside
  `The Poppler Developers`, so this real poppler install classified as `'xpdf'`.
  Reordered to check for an explicit `poppler` mention first; a genuine Xpdf
  banner never says "poppler", so this cannot produce a false negative on a real
  Xpdf install.
- **Test-suite side effect, also fixed**: the whole tabular-PDF integration test
  file (`test/clip-pdf-tabular.test.mjs`) had always been silently *skipped* on
  any machine hitting bug 1 (its own `skip` flag was driven by
  `pdftotextPresent()`), so it had never actually run here. Fixing detection
  un-skipped it and surfaced one pre-existing, unrelated test-design gap: a
  scenario simulating "an Xpdf machine" via an injected fake capability set
  still let `detectTabular` invoke the *real* installed binary with `-table` —
  which throws on a poppler build that doesn't support the flag, silently
  defeating the assertion. Fixed by also injecting a fake `detect` for that
  scenario, so it verifies `planExtraction`'s wiring without depending on which
  `pdftotext` flavor happens to be installed.

Full suite: 734 passing, 1 skipped (no real `-table` mode on this machine —
correct, not a gap), 0 failing, verified stable across repeated runs.

## 0.22.1 — 2026-08-22

### Google developer documentation is clippable again

`clip.mjs` could not clip `ai.google.dev` at all — it failed with an opaque
`Error: fetch failed`, taking an entire class of high-value sources with it. The
cause was the hardcoded browser `User-Agent`, but not by being blocked. The site
offers silent OAuth sign-in to any client it reads as a browser:

```
docs → /oauth2authorize?prompt=none → accounts.google.com
     → /oauth2callback?error=interaction_required → docs → …
```

A real browser escapes because its cookie jar carries `signin_details` forward and
the server stops retrying. `undici` keeps no cookies across redirects, so it spun
until `redirect count exceeded` — which surfaces as `fetch failed`.

Simply dropping the User-Agent would have traded one broken class for another: it
is there because NCBI PMC serves a bot-check shell without it (17 words vs 14,885).
So each launcher now tries the browser UA first and falls back to a bare request.
The order follows how each site fails — PMC fails *silently*, returning a short but
valid payload with no error to retry on, so its fix must come first; Google fails
*loudly*, which is precisely what a fallback can catch.

### Clippings can no longer arrive machine-translated

Found while verifying the above: the first successful clip came back in Japanese.
Defuddle defaults to `Accept-Language: *` — "any language at all" — and Google takes
it literally. Six cookieless fetches of one page returned two English and four
machine translations (zh-CN, ja, id, ar, each tagged `-x-mtfrom-en`), varying per
request. A clipping is quoted verbatim later, so a silently translated one is worse
than a failed fetch: it is wrong content wearing the same frontmatter as right
content, with nothing downstream able to tell.

Every attempt now pins `--lang en`, which held English 6/6 in the same test. The
`CLIP_LANG` constant is the knob if the vault is not English.

## 0.22.0 — 2026-08-22

### Triage can be driven from another machine, behind a session token

The triage server was built as a loopback companion: no authentication, a random
port, and a URL derived on the assumption the browser was on the same box. It was
one env var away from being reachable from the LAN and nothing about it was ready
for that. Every route now requires a session token.

The token is delivered through the terminal, because that is already an
authenticated channel — Claude prints a link that carries it, opening the link
trades it for an `HttpOnly; SameSite=Strict` cookie and redirects to a clean `/`,
so the credential does not linger in the address bar, a bookmark or a screenshot.
128 bits is what lets the login be a link rather than a form: a short PIN would
need a rate limiter, a lockout table and per-IP attempt state to survive being
reachable off-machine, and entropy removes all of it. `SameSite=Strict` also closes
the DNS-rebinding path that existed even on loopback.

The token is stable and re-printable rather than memorized — it lives in the
gitignored `state/` dir at mode `0600`, so losing the link costs nothing and
rotation is deleting one file. The port is remembered for the same reason: a cookie
is scoped to `host:port`, and a fresh random port each start would silently force a
new login every run. A remembered port already in use now moves instead of killing
the server.

`--remote` is opt-in and binds every interface. Binding by default would be a change
in exposure nobody asked for, and it must not happen just because an env var was
lying around.

### `http://0.0.0.0` is never advertised as a URL

Setting `WM_TRIAGE_HOST=0.0.0.0` produced `url: "http://0.0.0.0:PORT"` — the address
the server binds, not one any browser can open; Chrome blocks it outright. A wildcard
bind now advertises a real interface address, and `WM_TRIAGE_URL_HOST` overrides it.

### Live reload survives an HTTPS front

The client hardcoded `ws://`. Behind a tunnel, a reverse proxy or `tailscale serve`,
that is blocked as mixed content and live reload dies with nothing the user can see.
It now follows `location.protocol`.

### An idle shutdown no longer leaves a zombie holding the port

`server.close()` waits for open connections, and a WebSocket never ends on its own,
so the callback never fired and `process.exit(0)` never ran. The process lingered
holding the port and refusing every new connection while the page still showed itself
connected — and since only HTTP requests and file writes counted as activity, a
browser tab sitting on the live-reload socket was the *most* likely way to reach it.
Sockets are now closed before `server.close()`, with a timeout that exits regardless.

## 0.21.0 — 2026-08-21

### One oversized chunk no longer discards the whole index build

`chunkMarkdown` computed its size budget from body text only, then prepended the
entire frontmatter block to chunk 0 afterwards with no cap. On a source page citing
35 clippings that made chunk 0 ~6,500 characters against `nomic-embed-text`'s
2048-token context; Ollama answered HTTP 500, the rejection propagated out of the
worker pool before `persistIndex` was ever reached, and **every successful embed in
the run was thrown away**. Three consecutive builds failed at 66–84 of 113 chunks and
persisted nothing, while `search.mjs` kept reporting `hybrid` for the files it already
had — so the vault sat on a stale index with nothing visibly wrong. Reported as #70.

Four independent faults, each fixed on its own merits:

- **`source-hashes` is no longer embedded.** It is a machine join key for the
  ingest-backlog metric — 35 sha256 digests, 2,325 of that page's 5,126 frontmatter
  characters. Hex tokenizes badly, so its token cost exceeds its length, and it
  carries no retrieval signal at all: those tokens could only dilute the vector.
  The `sources:` wikilinks beside it *are* signal (clipping slugs are topical) and
  are kept.
- **The embedded frontmatter is now capped** at 1,200 characters, truncated at a line
  boundary so the head — `type`, `status`, the earliest sources — survives. This is
  the general guarantee that dropping one key cannot give: a page citing 200 sources
  is bounded too. Measured against the reference vault, only **8 of 2,403** indexed
  pages reach the cap, so it is close to free.
- **A chunk that fails to embed no longer discards the run.** Failures are collected,
  the successful work is persisted, and the count and reasons are reported. A missing
  vector is already something `search.mjs` skips, so a partial index is usable rather
  than broken. If a run of real size embeds *nothing*, that is infrastructure rather
  than one awkward page and it still throws — partial tolerance must not become silent
  acceptance of a dead backend.
- **Missing vectors are now repaired on the next run.** `planRefresh` keeps an
  unchanged file out of the changed set, so a chunk that failed once would never have
  been offered again without `--rebuild`. The build now asks which live chunks lack a
  vector and re-chunks just those files — derived from state rather than a remembered
  failure list, so it also repairs vectors lost to an interrupted run.

Two reporting fixes, because this was invisible for three runs:

- **`embed()` includes Ollama's response body in the error.** The failing call said
  `{"error":"the input length exceeds the context length"}` and the thrown error said
  only `HTTP 500`, discarding the one sentence that explained it.
- **`refreshAfterOp` names an incomplete build.** Its own contract is that it "is never
  silent — a silently stale index is precisely the failure mode the 0.11.0
  search-health work exists to prevent", but it printed the same notice whether or not
  chunks had failed.

**Re-embedding:** chunk 0's text changes for any page carrying `source-hash`/`source-hashes`
— 1,502 of 2,403 pages in the reference vault. That is one chunk per page, it happens
incrementally on the next `index-embed` run, and it removes pure noise from those vectors.

## 0.20.0 — 2026-08-20

### Every clipper takes `--topic`, not just the HTML one

`clip.mjs` has carried `--topic` since topic attribution landed. The binary-path
clippers never did — so a research run that clipped a PDF, a Word file or a
spreadsheet produced clippings with no `topic:` frontmatter, and `/wiki-triage`
filed every one of them under **Unattributed**.

The cost is not cosmetic, because **topic is recorded going forward only and no tool
can retro-fit it**. Attribution is captured at clip time or lost permanently, and the
loss is silent: the clip succeeds, the row just never joins its run. A PDF-heavy topic
routes most of its candidates away from `clip.mjs`, which is exactly when the gap
bites hardest — one measured run lost attribution on **16 of 41 clippings (39%)**
this way, and those rows cannot be repaired.

`clip-pdf.mjs`, `clip-docx.mjs` and `clip-xlsx.mjs` now accept `--topic` and thread it
into frontmatter through the same `buildFrontmatter` they already shared, so the
frontmatter contract is unchanged — an absent topic and a blank one remain one state,
and interior whitespace is normalized so `"BPD  research"` and `"bpd research"` stay
one triage group.

Flag parsing moved into `lib/topic.mjs` as `parseTopicArg`, giving it a single owner
across all four clippers. That closes a latent truncation bug on the way: the previous
inline parse in one script would have been fine, but `split('=')[1]` — the idiom used
for every other flag in these scripts — silently cuts `--topic="cost=benefit framing"`
down to `cost`. `parseTopicArg` rejoins on `=`.

The skills were the other half of the defect, and are updated too: `/clip-pdf` and
`/clip-docx` now document the flag in their argument hints and clip steps, and
`/wiki-discover`'s Phase 3 spells out that "every clip in the run" includes the
non-HTML paths, with the commands for each. A script gaining a flag changes nothing
if the instructions never tell the agent to pass it.

`clip-and-repoint.mjs` deliberately does **not** take `--topic`: it is a repair pass
over binaries already in the vault, with no research run behind it, and an invented
topic is worse than none — it files a row under a heading the user has already
worked through.


## 0.19.0 — 2026-08-19

### `clip-pdf` yells when its toolchain is incomplete

A missing external tool used to be invisible. `ocrReachable()` returned `false`, the
run carried on, and the consequence surfaced later disguised as a fact about the
document. `clip-pdf` now probes every tool it needs and prints a banner on **every**
run when one is missing, naming the capability lost rather than the package: not
"tesseract missing" but "scanned/image PDFs cannot be read at all". `--doctor` runs
the same probe on its own. A missing `pdftotext` is fatal and exits; the rest are
degradations.

### A missing OCR toolchain is no longer recorded as a decline

This is the bug the banner was hiding. A thin extraction was declined as
`thin text (scanned/encrypted; OCR unavailable or also failed)` whether OCR had run
and failed or had never been installed — and a decline carries a 180-day TTL. The two
cases are opposites: one is a finding about the PDF, the other is a fact about the
machine, and only the first justifies suppressing a retry. A thin extraction with no
OCR toolchain now returns `ocr-unavailable`, records **no** decline, and says what to
install. (One casualty is already in the wild: `army.mil`'s AFT_Scoring_Scales PDF,
declined 2026-08-10 by a run that had no Tesseract. Re-clip it once OCR is installed.)

### `--mode` overrides the reading-mode detector

0.18.0 added per-document routing between reading-order and aligned (`-table`)
extraction. The detector is a heuristic on a continuum and it has a measured
false-positive class: **a body column with margin annotations beside it**. The CCSS
Progressions volume scores 0.30–0.37 against a 0.35 threshold along its whole length,
so it trips as tabular; read with `-table` it splices each margin standards note into
the body line beside it and leaves hyphenated breaks unjoined, leaving no quotable
span anywhere in a 637k-word document.

0.18.0's own note that a false positive is "ugly and obviously wrong to any reader"
turns out not to hold. It reads as ordinary prose and is stamped only
`fidelity: tabular`, which a reader takes as a minor caveat rather than as "every
sentence has a margin note spliced into it". That comment is corrected in place.

`--mode=auto|reading-order|table` settles it. An override that **diverges** from the
detector is recorded rather than silent — the clipping is stamped
`extraction: reading-order-forced` and the run warns — because a human override
asserts the detector was wrong about this document, which is a provenance fact a
later reader needs. An override that agrees with the detector is a no-op and is not
annotated, so the common case stays byte-identical. An unknown `--mode=` value is an
error, and `--mode=table` without a `-table`-capable `pdftotext` is refused rather
than quietly downgraded.

## 0.18.1 — 2026-08-18

### Fix: wiki-author/SKILL.md was missing its frontmatter entirely

`skills/wiki-author/SKILL.md` was created with pure body text and no `---` YAML
header at all — every other skill declares `name:`/`description:` (optionally
`argument-hint:`), but this one went straight into prose. Without that header the
skill loader has no name/description to register it under, so `wiki-author` never
appeared as an available skill, and reportedly caused `/skills` (and skill loading
on session start) to error while scanning the full skill set.

The existing drift-guard test for skill frontmatter silently `continue`d past any
file with no frontmatter block instead of failing on it — a missing-frontmatter
file looked identical to one with a frontmatter block simply lacking an
`argument-hint`, which is valid. Added a new test asserting every
`skills/<name>/SKILL.md` has a frontmatter block with `name: <name>` (matching its
own directory) and a non-empty `description`, closing the gap that let this ship
undetected. Verified independently with a real, spec-conformant YAML parser
(PyYAML) against all 15 skill files.

## 0.18.0 — 2026-08-18

### Tabular PDFs no longer claim a fidelity they do not have

`clip-pdf` read every PDF in `pdftotext`'s reading-order mode. That is the right
choice for a two-column paper and exactly the wrong one for a **table**: reading-order
emits a table column-block-wise — the whole key column, then the whole value column —
so every row's key is detached from its value, and the pairing cannot be recovered from
the output.

The characters all survive, so nothing downstream had any signal. `assessFidelity`
tests for mangled math, `U+FFFD`, `(cid:NN)` and low alphabetic density; a flattened
table trips none of them and the clipping was stamped **`fidelity: high`**. Under
guardrail #5 (clippings win) that is the worst possible failure: a page can state every
cell correctly while pairing the wrong key to the wrong value — a fidelity failure that
looks exactly like a fact. Reported as #66, after a human had to hand-write a warning
onto a wiki page telling readers not to trust its code-to-text pairings.

- **The reading mode is now chosen per document.** The clipper samples the first pages
  both ways and asks whether aligned mode *re-attaches* anything: a short standalone
  line that becomes the leading token of a longer line is a key cell rejoining its
  value. Measured, not guessed — the promotion ratio runs 0.45–0.51 on real standards
  PDFs and 0.24–0.26 on two-column academic papers, and the threshold sits at 0.35.
  Prose keeps today's behaviour exactly.
- **Recovered rows are stamped `extraction: table-aware` + `fidelity: tabular`**, never
  a bare `high`. The pairings were *reconstructed from horizontal position*, not read
  off a structured source, so ingest must confirm one before quoting it as verbatim.
  Verified against an independent `pdfplumber` cell-geometry extraction of the reported
  source document: every spot-checked standard matched.
- **`-table` is an Xpdf feature; poppler has no equivalent.** Where it is unavailable
  the clipper **warns and stamps `extraction: table-flattened` + `fidelity: degraded`**
  rather than writing a clean-looking clipping with mispaired rows. `-layout` is
  deliberately *not* used as a fallback: measured on the real source PDF it stacks
  consecutive keys into a column while their values drift, so `5.36` visually pairs
  with the tail of `5.35` — confidently wrong, which is strictly worse than visibly
  broken.
- **`refresh-fidelity` can no longer erase a table flag.** It re-derives fidelity from
  the stored text and clears flags that no longer hold — but a table flag has no basis
  in the characters, so the next maintenance run would have deleted the only record
  that the rows are untrustworthy. Flags on `table-aware` / `table-flattened` clippings
  are preserved and reported separately.
- **Fixed: `pdftotext` presence was mis-probed on every Xpdf install.** The check ran
  `pdftotext -v`, which exits **99** on Xpdf — so the "not found" path fired on exactly
  the builds that carry the `-table` mode. Presence is now decided by what the probe
  *said*, not by its exit code, and the skill's preflight step was corrected too.

Existing clippings are unaffected until re-clipped; `fidelity: tabular` and
`table-flattened` both surface in `/wiki-triage` as needing a human decision.

## 0.17.0 — 2026-08-15

### Project documentation: honest, not just well-placed

0.14.0 and 0.15.0 settled **where** each project document goes — the canonical table,
the project folder, the collision rule. They said nothing about whether the document is
still worth reading a month later, and a document filed perfectly in the right folder
can still be a liability.

Seven items added to `wiki-maintainer`, each one a failure that actually happens rather
than a style preference. Several are drawn from a vault where all four projects had
drifted the same way.

- **`architecture.md` is as-built, not as-planned.** The moment it describes something
  that does not exist, a reader cannot tell which half is true — and the page stops being
  usable as a reference at all, not just in the part that is wrong.
- **`roadmap.md` records state, not history**, with a specific named failure: it keeps
  listing as "next" three things that shipped a fortnight ago. Update it in the *same
  operation* as the work — a roadmap updated later is a roadmap updated never.
- **An ADR's consequences section must carry the bad ones.** A section listing only
  benefits is a sales pitch, not a record; the reason to revisit a decision is always in
  the half that gets left out.
- **Label a retrospective ADR as reconstructed.** Reasoning recovered from code and commit
  history is not the reasoning that was used, and saying so is the difference between a
  record and a plausible story.
- **Record the failures** — stalls, refuted hypotheses, measurements that contradicted a
  confident diagnosis. They are precisely what nobody remembers and everybody repeats.
- **Distinguish "not built" from "built and broken".** From outside they look identical
  and only one of them is a bug.
- **The wiki owns intent; the repo owns behaviour** — and the disagreement between them is
  usually where the next defect is.

Deliberately adds no placement guidance: that is already covered, and a second competing
table would be worse than none.

**Process note.** This content first landed as `4c78cc4`, pushed straight to `main` past
the "changes must be made through a pull request" rule (which warns rather than blocks,
since `enforce_admins` is off) and carrying no version bump — so the six-manifest guard
never ran on it and the marketplace had no signal to serve it. Reverted in #64 and
re-landed here through the normal path. The bypass is worth recording rather than
quietly fixing: a release that skips the version bump is invisible to every consumer,
which is the same class of defect as the drift the manifest guard exists to catch.

## 0.16.0 — 2026-08-12

### Hard-wrapped wikilinks: detection, repair, and visibility at commit time

`/wiki-health` surfaced 30 broken links whose actual cause was one thing, not thirty:
hand- or LLM-authored prose gets word-wrapped at some column width, and a `[[Target]]`
straddling the wrap point survives as one link with an embedded newline in its
target — which Obsidian, and this vault's own `resolveLinkTarget`, can never resolve.
The only thing catching these before was a generic edit-distance "did you mean"
fallback, which happens to work when the wrapped form's normalized whitespace matches
an existing page closely enough — but a wrapped link to a not-yet-written page had
nothing to flag it: it silently fell through to `deferred` (scored as healthy).

- **`scripts/lib/dewrap-links.mjs`** — detection is a structural fact, not a
  heuristic: a `[[...]]` span containing a raw newline is unambiguously invalid,
  since no legitimate wikilink spans a line break. Repair is a lossless whitespace
  collapse — the mechanical reversal of the wrap, never a guess at content. The one
  genuinely ambiguous shape — a hyphen glued to the word right before the break
  (`[[Diagno-\nstics]]`) — is indistinguishable by character shape alone from a title
  that legitimately ends a line in a trailing hyphen (`[[Wizards-\n  Definition and
  Design Recommendations]]`, a real title in this vault; both match the identical raw
  pattern). A first, syntax-only "risk" flag design was wrong — caught by writing
  both real, vault-derived cases as tests before trusting it, not by inspection.
  The fix checks both candidate readings (hyphen kept vs. removed) against the real
  page index and only applies the one that resolves, mirroring
  `repair-provenance-links.mjs`'s own "never guess" discipline.
- **`classifyBrokenLinks`** now always defects a hard-wrapped link, regardless of
  whether a suggestion resolves — closing the gap where one with no near-match page
  could previously hide in `deferred`. `health.mjs`'s report gives an unresolved one
  its own actionable message (pointing at the repair script) instead of the silence
  a plain unexplained target used to get.
- **`scripts/repair-wrapped-links.mjs`** — dry-run/`--apply`, matching every other
  repair script's convention; only ever touches `wiki/` content, never `raw/`.
- **`op-commit.mjs` reports a hard-wrapped wikilink introduced by the files an
  operation just committed** — visibility at the moment of commit, not just whenever
  someone later happens to run `/wiki-health`. Never blocks the commit itself:
  `op-commit` has no existing "fail the commit" contract to extend safely.
  `/wiki-relink`'s workflow now runs the repair script as its first step, since a
  hard-wrapped link is a mechanical fix, not a judgment call about what to link.

Full suite: 648/648 passing.

## 0.15.0 — 2026-08-11

### Real folders and a real backlog split for `wiki/authored/`

0.14.0 added `project:`/`kind:` frontmatter and a generated MOC on top of `wiki/authored/`'s
existing flat file layout — metadata and an index, with the files themselves untouched. Direct
follow-up made clear that didn't fix what was actually asked for: `ls wiki/authored/` still
showed 36 flat siblings with no folder structure at all, and the monolith-detection signal added
in 0.14.0 only *reported* the one 9,500-word, continuously-appended roadmap file — it never split
it. This release changes the actual file layout and the actual per-item granularity, the two
things metadata alone cannot fix.

- **Real physical folders**, keyed by each page's existing `project:` value —
  `wiki/authored/<project>/[<subproject>/]`, with `decisions/`, `guides/`, `diagrams/`,
  `reference/`, `notes/`, and `backlog/` subfolders per a new canonical placement table (verb →
  location → `kind:`, e.g. "write a user guide" → `<project>/guides/user.md`). Verified empirically
  before committing to the design: every existing script that reads `wiki/authored/`
  (`buildGraph`, `checkStyle`, `checkQuotes`, `renderCatalog`, `moc-authored-gen.mjs`) already
  tolerates arbitrary nesting depth via `path.startsWith('wiki/authored/')` — zero code changes
  needed to support folders. Existing filenames are not renamed, only relocated — a bare
  canonical leaf name (`overview.md`) repeated across every project would be a guaranteed
  cross-project wikilink collision (this vault has been bitten by exactly that class of bug
  twice before).
- **A backlog-item format**: one small file per tracked item (`<project>/backlog/<slug>.md`,
  `kind: backlog-item`, `backlog-status: planned | in-progress | shipped | blocked | dropped`),
  edited in place — never appended to. `scripts/backlog-gen.mjs` generates a thin
  `<project>/roadmap.md` index over them, grouped by status ("what's live" before "what's done"),
  the same fenced-region contract `index.md` and the per-project MOC already use.
- **`scripts/lib/roadmap-split.mjs`** — a pure, mechanical extractor that splits a monolithic
  roadmap into individual items verbatim (never a rewrite). Applied to the real vault: the
  1,261-line, ~9,500-word `sparta-migrator-roadmap.md` became 32 individual backlog-item files
  plus a ~200-word `roadmap.md` (renamed to the canonical bare name), verified 100% byte-exact
  against the source before trusting it. `health.mjs`'s `monolithCandidates` is now empty.
- **`skills/wiki-author/SKILL.md`** — a new dedicated skill wrapping the placement table,
  template selection, and post-write regeneration steps, matching every other wiki-master action's
  own dedicated skill (`/wiki-ingest`, `/wiki-query`, `/wiki-lint`, `/wiki-relink`,
  `/wiki-discover`, `/wiki-purge`, `/wiki-triage`) instead of a paragraph inside the
  general-purpose `wiki-maintainer` skill.
- A **piped-link convention** for cross-project references to a bare `overview.md`/
  `architecture.md`/`roadmap.md` — these names are deliberately reused across projects, so a bare
  `[[roadmap]]` link becomes ambiguous the moment a second project has one. Documented in both
  skill docs; two real, previously-unresolved bare `[[roadmap]]` references in the vault
  (comparing to sparta-migrator's roadmap structure) converted to the explicit piped form.
- Fixed a bug found while validating the above against the real vault: both
  `moc-authored-gen.mjs`'s per-project catalog and `index-gen.mjs`'s whole-vault catalog were
  listing every `kind: backlog-item` page individually — recreating, one layer up, the exact
  per-item sprawl this release removes. Both generators now exclude `kind: backlog-item`; the
  project's own `roadmap.md` is the index for those.

Design: `docs/superpowers/specs/2026-08-11-authored-project-structure-v2-design.md`; plan:
`docs/superpowers/plans/2026-08-11-authored-project-structure-v2.md`.

## 0.14.0 — 2026-08-11

### A project-documentation pattern for `wiki/authored/`

`wiki/authored/` (added 2026-07-22) had grown to 36 files across two organically-formed
projects — visible only as a string baked into each filename, invisible to every piece of
tooling that reads frontmatter. `index.md`'s generated `## Authored` catalog was one flat,
alphabetical list; the two hand-maintained MOCs built to compensate were already straining
(one had improvised an ad hoc sub-heading for a nested feature; the other's 8-file sub-project
had no hub at all); and one file — a continuously-appended roadmap mixing forward plan,
changelog, and stacked emoji-tagged status updates — had grown to 9,500+ words with no way to
answer "what's the current state of item X" short of reading every update about it in order.

Four additive layers, grounded in this repo's own recent, shape-identical fix (triage's
topic-grouping, 0.13.0) plus two established documentation patterns (Diátaxis; Nygard's
Architecture Decision Records):

- **`project:` and `kind:` frontmatter** — free-text project slug (one `/` deep for a
  sub-project) and a small, escapable kind vocabulary (`overview | architecture | reference |
  guide | diagram | decision | roadmap | note`), normalized the same way `topic:` already is.
  `kind: decision` additionally carries `decision-status:` (Nygard's own proposed/accepted/
  superseded/deprecated), turning "is this decision still live" into queryable data instead of
  prose under a `## Status` heading.
- **A generated per-project MOC** (`scripts/moc-authored-gen.mjs`) — the exact fenced-region
  contract `index.md` already uses: hand-prose is never touched, the fenced section is a pure,
  kind-grouped, deterministic function of the pages. Where a MOC already exists with no fence,
  one is appended (mirrors `index-gen.mjs`'s own precedent) rather than a second, more complex
  "flag for manual migration" convention invented for an identical problem.
- **A monolith-detection signal** (`monolithCandidates` in `computeGraphMetrics`, reported by
  `health.mjs` — same "reported, never scored" treatment as `hubStubs`) — calibrated directly
  against the real vault: word count over 3,000 **and** 3+ dated "Update (...)"-style callouts,
  together, flag exactly the one genuine offender while sparing a second long-but-healthy file
  and a normal file with one isolated, legitimate update note. A deliberate design choice, not
  house-style prose: the authors of these pages are coding agents without cross-session memory
  of a file's history, and appending one more update is always the lowest-friction move
  available in the moment — a signal is the only thing with a chance of interrupting that.
- **`scripts/backfill-authored-metadata.mjs`** — deterministic, filename- and content-shape-driven
  classification for the pre-existing files (dry-run/`--apply`, idempotent, matching every other
  repair script this repo ships). Every bare `<project-name>.md` with no doc-kind suffix resolves
  structurally (`# <slug>` immediately followed by `## Summary` — confirmed against the real
  files, not assumed) rather than being left for manual review.

New `templates/_templates/authored-decision.md` (the Nygard ADR shape both real vault ADRs had
already converged on unprompted). `skills/wiki-maintainer/SKILL.md` and `templates/vault-schema.md`
document the new fields and the monolith-splitting guidance, stated as a direct instruction to an
authoring agent rather than a hope. Design: `docs/superpowers/specs/2026-08-11-authored-project-
docs-design.md`; plan: `docs/superpowers/plans/2026-08-11-authored-project-docs.md`.

## 0.13.0 — 2026-08-10

### Triage groups by the research run that produced it

Triage grouped by **kind** — clip failures, fidelity flags, backlog, hub-stubs. Kind decides
which actions a row offers, so that structure is load-bearing. But it is the wrong axis for
*deciding*: nobody sits down to disposition "all fidelity flags", they sit down to deal with
the research run that produced them. Twelve failed clips from a BPD sweep and three from an
audio-DSP sweep were two unrelated decisions wearing one label.

**Nothing recorded a research topic before this.** It existed only in `/wiki-discover`'s
argument and in log-entry prose. Deriving it from log dates was considered and rejected —
several runs happen per day and `created:` is a date, so the join would mis-attribute silently
rather than fail. A wrong topic is worse than none: it files an item under a heading the user
has already worked through.

**Two carriers, one resolver.** `clip.mjs --topic="<topic>"` writes `topic:` into the
clipping's frontmatter — the durable carrier, because `.wiki-master/` is gitignored and
frontmatter is the only one that reaches other machines. For items that never became a file (a
clip that 403s), `recordIssue` carries a `topic` field in the append-only triage log. One flag
feeds both, so no caller has to know which population a URL is about to land in. Resolution is
own-event, then clipping-by-URL, then clipping-by-path (backlog rows *are* clipping paths),
then Unattributed.

**In the UI, topic is a filter across the kind groups, not a replacement for them.** Making it
the outer grouping would multiply every group header and its bulk buttons by the number of
topics and scatter each kind across the page. A topic bar scopes the whole queue to one run
instead; rows carry a topic chip.

The subtle part is the **bulk-count invariant**. `group()` already refuses to let "apply to all
N" mean more than the rows rendered; a filter is a second way to show fewer rows than exist, so
selecting a topic recomputes every bulk button's count and label from the visible rows, and the
bulk handler acts only on those. Verified in a real browser: with a topic selected, "retry all
2" wrote exactly the 2 matching dispositions and left the other two rows in the same DOM group
untouched. A group emptied by the filter hides itself and disables its bulk actions.

**No back-fill.** Every clipping predating this has no topic and there is no sound way to infer
one; they group under Unattributed, which the skill tells the agent to explain rather than
present as a defect. No taxonomy, hierarchy, or aliasing — a topic is free text the user
already typed.

## 0.12.0 — 2026-08-10

### The index keeps itself current, and the purge skill stops teaching a wrong cause

**`op-commit` now refreshes the semantic index.** The index only moved when someone ran
`index-embed` by hand, so it drifted behind the vault between manual runs and search answered
from a stale picture. `op-commit` is already the single choke point every mutating operation
passes through, so one call there covers ingest, relink, purge and a filed query — instead of
a refresh line in four skill files, which is four places to forget.

It cannot hurt an operation. It runs *after* the commit lands, so a failure cannot reach it;
no outcome sets an exit code; and nothing it writes can pollute a commit, because the index
lives under the vault's gitignored `.wiki-master/`. A **missing** index is reported, never
built — an incremental refresh is a fraction of a second, but a cold build is minutes (54s
over 1,821 files), and starting one as a side effect of an ordinary commit would stall an
operation the user believed had finished.

Advisory is not the same as silent. Every skipped or failed refresh prints why, with the
command that fixes it — a silently stale index is the exact failure the 0.11.0 search-health
work exists to prevent.

**The purge skill's root cause was wrong, and it has been corrected.** `/wiki-purge` shipped
claiming the removal that motivated it "never became a commit," verified against the vault's
own history. The removal *did* become a commit — through a **history rewrite**. Origin was
force-updated with 261 rewritten commits; this clone never received it, the two lineages
shared **no merge base at all** (git reported "unrelated histories," not a conflict), and
obsidian-git's auto-backup went on committing to the original lineage, which still held all
72 removed files.

The method had a hole worth naming: `git log --full-history` was run against the orphaned
clone and was correct *about that clone*. `--full-history` defends against history
*simplification*; nothing defended against history *replacement*. The query proved "this
lineage never deleted these files" and it was read as "no lineage ever did."

So the skill now names **four** resurrection vectors instead of three, and says plainly that
purge closes the first three and **cannot close the fourth**, with a `git merge-base` check to
run before purging and instructions to stop if there is none. From inside an orphaned clone a
purge succeeds, commits, and is invisible to every other machine — which looks exactly like
the topic coming back. The spec keeps the original §2 with a correction at its head, so the
record shows what was believed, the evidence for it, and the measurement that overturned it.

The feature itself is unchanged and still correct; only the causal story it told was wrong.

## 0.11.0 — 2026-08-09

### Semantic search over every character, and it says when it is degraded

Two problems, one of which was invisible.

**Search was silently substandard.** Every tier degrades to a working answer, so a query
returned plausible results whether it ran the best path or the worst, and neither the user
nor an agent could tell. Worse than mislabelling: a reachable Ollama with the model not
pulled threw an unhandled `HTTP 404` and returned *nothing*. Now every query prints a status
line to stderr — `(hybrid · 5518 chunks)` or `(lexical — ollama not running · run --health)`
— the first query in a 4-hour window prints the full block with fixes, and
`--health` / `--setup` report and remediate. `modelPresent()` closes the one case where a
tier label was actively false.

**Semantic search only saw the first 4,000 characters of each page.** 395 of 1,820 pages
exceeded that; 979,529 characters — 16.8% of the wiki — were never embedded. There is now a
chunk-level index: heading-aware chunks with overlap, keyed by chunk-content hash, stored as
binary Float32.

| | before | after |
|---|---|---|
| Coverage | 83.2% of characters | **every character** |
| Query | 1,500 ms | **104 ms** (14 ms load + 81 ms embed + 9 ms cosine) |
| Retrieval, mean rank on a 5-query benchmark | 3.0 | **2.6** |
| Storage | 28 MB JSON | 17 MB binary |
| Results | page paths | `path:line` — the passage that matched |

**The aggregation was chosen by measurement, and the first design was wrong.** Ranking a page
by its best chunk scored *worse* than the truncated status quo (5.0 vs 3.0) — a 1,200-char
window is a weaker topical fingerprint than a whole-document vector. RRF-fusing the two was
also worse (3.4). Ranking by the **mean of a page's chunk vectors** won (2.6), because it
reconstructs the whole-document fingerprint over complete coverage. Best chunk still supplies
the line number: mean picks the page, max picks the passage. n=5 with hand-picked targets is a
weak benchmark; what makes it actionable is that mean was never worse on any single query.

**qmd was installed, measured and removed.** `qmd search` is BM25-only despite the tier name,
and it sat *above* the actually-hybrid tier, so any keyword hit preempted semantic search
entirely — installing it made semantic queries worse. True hybrid is reachable
(`qmd query $'lex:…\nvec:…' --no-rerank`, 0 MB of extra models) but runs at 3.0 s against
1.5 s because each invocation reloads its model, and the daemon meant to fix that measurably
changed nothing. Ollama is already the persistent server qmd lacks. Full evidence in
`docs/superpowers/specs/2026-08-09-chunk-semantic-index-design.md` §4.

Also: `keep_alive` on embeds (a query embed measured 2,142 ms with the model unloaded, 30 ms
warm), and the query path no longer re-reads and re-hashes the whole vault — 211 ms of
avoidable work per search.

Build or refresh the index with `node scripts/index-embed.mjs`. A cold build of 1,821 files
took 54 s; an incremental refresh of 2 changed files took 0.2 s.

## 0.10.0 — 2026-08-09

### Every mutating operation commits its own work

0.9.0's `/wiki-purge` was built because a deletion never became a commit and the next
sync undid it. That fixed the problem for purge and nothing else. Measured afterwards:
**16 scripts write to the vault and one committed; 7 skills instruct an agent to write
and one committed.** `/wiki-ingest` alone touches 10–15 pages per run.

Until now the only thing making that durable was obsidian-git's timer — which cannot
know where an operation begins or ends, so it produces `vault backup: <timestamp>`
commits that mix unrelated work and cannot be reverted as a unit. Observed directly
while re-enabling it: one auto-commit swept a settings change together with eight
in-progress files, then pulled and merged another machine's work. Purging is rare and
ingesting is constant, so this was the larger exposure.

`ingest`, `relink`, `lint` and `discover` now bracket themselves:

```
TOKEN=$(node scripts/op-begin.mjs --op ingest)
…
node scripts/op-commit.mjs --op ingest --title "…" --since $TOKEN
```

- **Snapshot-diff, not enumeration.** `op-begin` records what was already dirty;
  `op-commit` commits (dirty-now − dirty-then). Making each skill list its own writes
  would put the burden of exhaustiveness on every skill, and one missed path is an
  uncommitted change — the original bug. This cannot commit what the operation did not
  touch.
- **The user's work is never swept in**, including anything they had already *staged* —
  `git commit` with no pathspec commits the whole index, which bit once during 0.9.0.
- **It never pushes.** Outward-facing, so it belongs to an explicit confirmation. It
  reports the unpushed commit count instead, so the gap stays visible.
- **`query` brackets only the file-the-answer-back branch**; a read-only query opens
  nothing. `discover` and `ingest` nest correctly, and `discover` commits on decline
  too — the clippings exist either way, and a later ingest would otherwise cite a file
  the other machines do not have.

Found while building it, and not anticipated by the design: `git status --porcelain`
collapses an entirely-untracked directory to one `?? wiki/` line. That stages fine but
never matches `git diff --cached --name-only`, which lists individual files — so a new
file in a fresh subdirectory reported "nothing to commit" while sitting staged and
uncommitted. `--untracked-files=all` fixes it.

obsidian-git's timer stays on as a safety net for hand edits made in Obsidian itself,
which no skill brackets. The goal was to make it redundant for agent operations, not to
remove it.

## 0.9.0 — 2026-08-08

### `/wiki-purge` — removing a topic in a way that survives sync

Deleting pages in the vault did not remove them. Investigating the reported case
against the vault's own history settled why, and it was not the reported cause: **no
commit had ever deleted those pages** — checked with `--full-history`, which defeats
the merge simplification that hides one side of a merge. Nothing was "synced back in,"
because the removal had never become a fact anyone could sync. It existed in one
working tree and the next pull undid it.

So the bin is not the fix. `/wiki-purge` owns the whole transaction through commit,
and is re-runnable so anything that does return converges.

**Three layers, because removing one is not removing a topic.** Taking the `wiki/`
pages alone leaves clippings the ingest backlog reports as un-summarized forever, and
the next `/wiki-ingest` rebuilds the topic from them. Taking the clippings without
recording their URLs lets `/wiki-discover` re-clip them. Purge moves pages and
evidence and records a decline per source URL.

- **The closure never admits a page anything outside the topic references.** Those
  become *collateral* (references to repair) or *blocking* (every source they cite is
  inside the set — `--apply` refuses until you decide). The asymmetry is deliberate:
  over-matching destroys work and is discovered late; under-matching leaves one page
  to delete by hand and is discovered immediately.
- **`--reconcile` re-bins anything that came back**, matching by path and by
  `source-hash` so a re-clip under a new filename is caught too. Idempotent, and it
  commits what it moves.
- **`--restore <id>`** puts a purge back, never overwriting newer work, and clears the
  declines that purge recorded so the sources become discoverable again.
- **The bin is excluded structurally, with no changes to any reader.** `graph.mjs`
  skips dot-prefixed entries during its walk; `search.mjs`, `drift.mjs` and
  `stale.base` all filter on an anchored `wiki/` prefix that a `.recycle/` path fails;
  and Obsidian's own indexer ignores dot-folders — probed live rather than assumed.
- **Commits stage only what the purge touched.** A vault with obsidian-git
  auto-commit disabled carries the user's in-progress writing, and `git add -A` would
  label it as part of the purge and make the purge impossible to revert cleanly.

Also in this release: `removeDecline` in `scripts/lib/decline.mjs`, a narrow
`scripts/lib/git.mjs` (stage, commit, push — no force, no history rewriting), and
`log-entry.mjs` now returns a forward-slash path on every platform.

## 0.8.4 — 2026-08-03

### `sources:`/`source-hashes:` ordering — one more bare-YAML defect, found the same way

Found while reviewing a live vault's health report by hand rather than trusting the
score alone: `health.mjs` read 0 `provenanceGaps` on 476 `wiki/sources` pages, but
`obsidian properties` reported **"No frontmatter found"** on 193 of them (~40%).
Every property — not just `sources` — was invisible to Obsidian, Bases, and any
property-driven view, while wiki-master's own scripts stayed silent because they
regex-scan the raw frontmatter text rather than parse it as YAML.

Root cause: `insertSourceHashes` (`scripts/lib/backfill.mjs`) anchored its
insertion point on `/^sources:.*$/m`, which only ever matches a `sources:` line's
FIRST line. That is correct when `sources:` is written inline (`sources: [[X]]`),
but when it is a YAML block list (`sources:` bare, then `  - [[X]]` continuation
lines — the shape every affected page happened to use), the new `source-hashes:`
line landed between the bare key and its own list item. A real YAML parser
rejects that outright (`expected <block end>, but found '<block sequence
start>'`) — this is not a formatting nit, it takes the whole frontmatter block
down, which is why Obsidian reported nothing rather than just a missing field.
No existing test exercised the block-list form, so nothing caught it.

Fixed the insertion point to walk past every continuation line before inserting,
so no future run of `backfill-source-hashes.mjs` can reproduce this. Existing
damage needed its own repair, since re-running the (now-fixed) backfill only
merges hash *values* and never repositions an already-present `source-hashes:`
line: new `scripts/repair-sources-order.mjs` recognizes and reorders only that
exact defect shape (pure string surgery, no YAML parsing, so anything else is
left untouched), dry-run by default, `--apply` to write, idempotent. On the live
vault this was 193 pages, 192 single-citation and 1 multi-citation.

## 0.8.3 — 2026-07-30

### Hub-stubs are a worklist, not a grade

`hubStubs` is still detected and still printed in the health report — it is now
surfaced in `/wiki-triage` instead of subtracting from the score. Four reasons, in
increasing order of how much they mattered:

- **It was the only content-shaped signal in a structural metric.** Every other
  penalty is a broken or missing *edge* — objectively wrong, fixable mechanically.
  "This page is unwritten" is the normal state of a growing wiki, and `status: stub`
  is a sanctioned value in the vault schema. The report literally prints
  `declared stubs (not scored)` on the next line, which scoring them contradicted.
- **The cap made it useless as a gradient.** At weight 5 capped at 15, a vault went
  from 10 hub-stubs to 3 with *no score movement at all*; only the last two moved the
  number. It reported "15 points of work left" when it meant "more than two."
- **The provenance guardrail forbids the fast fix.** You cannot write these pages
  without sources, so the score penalized a state the contract bars you from clearing
  quickly.
- **It was the only category whose cheapest fix makes the wiki worse.** A hub-stub
  clears if you delete inbound links until it drops under `HUB_MIN_BACKLINKS`, or if
  you pad the page with unsourced prose. Both score better; both damage the vault.
  Everywhere else the cheapest fix is the correct fix. That asymmetry is what settled
  it.

Health now means one clean thing: **no broken edges** — defects, orphans, dead-ends,
provenance gaps, unreachable provenance. A structurally sound vault reaches 100
however many hub-stubs it carries, and there is a regression test pinning exactly
that.

The signal itself is real — five or more pages routing a reader into an empty page —
so `/wiki-triage` grows a **Hub-stubs** group, framed as *"needs sources, not
padding"* with `find sources` / `leave stub` dispositions, counted in the summary
strip, and enough on its own to keep the queue from reading all-clear.

On the live vault this moved the score from 85 to **100/100** while the ten hub-stubs
stayed fully visible — they just stopped being a grade.

## 0.8.2 — 2026-07-30

### Bare wikilinks resolve by channel, and title-shaped citations can be repaired

Two defects found while repairing a live vault, which scored 31/100 almost entirely
because of them. Both made a metric lie in the direction that invents work: one
reported orphans that were not orphans, the other hid broken provenance inside the
"deferred" bucket where nothing looks wrong.

- **`buildNameIndex` decided bare-name collisions by filesystem walk order.**
  `raw/` sorts before `wiki/`, so the clipping won every time. A concept page linked
  as `[[Parallel Transport]]` had all of its backlinks credited to
  `raw/clippings/Parallel transport.md` and read as an orphan with zero inbound
  links — while Obsidian resolved that very same link to the concept page. The
  comment at `graph.mjs:225` had already documented this (it cites 117 false
  orphans); registering the full path as its own key only fixed it for links that
  *qualified a directory*, and bare links kept losing. On the live vault five pages
  read as orphans this way, each with several real backlinks.

  The index now carries **both** answers, because the right one depends on which
  link channel is asking — a distinction `graph.mjs` already drew but did not act
  on. A **body wikilink is navigation**: a content page (`isContent`) outranks a
  raw/log/template file, matching where Obsidian actually lands the reader. A
  **`sources:` wikilink is provenance**: it still resolves to the evidence file.
  `resolveLinkTarget(byName, target, { nav })` selects the channel; every
  path-qualified form is unchanged, and collisions *within* a class remain
  first-wins (genuinely ambiguous — qualify the path to disambiguate).

  Preferring content for both channels was tried first and is a trap worth naming:
  it fixed the orphans and regressed the same vault from 0 to **126** provenance
  gaps, because `sources: [[Foo]]` means `raw/clippings/Foo.md`, and resolving it to
  `wiki/sources/Foo.md` reports a gap on a page that cited its evidence correctly.
  There is a regression test for exactly that.

- **New `scripts/repair-provenance-links.mjs` — citations that name a title, not a
  file.** The clipper slugifies a title into a filename (`/`, `:`, `#`, `*`, `?`,
  quotes and brackets → `-`, then a 120-char cap), but ingest wrote
  `sources: [[<remembered title>]]`. Every source whose title carried one of those
  characters or ran long cited a file that never existed: the page became a
  `provenanceGap` and its clipping read as unparsed, though the ingest itself was
  correct. On the live vault this was 11 source pages and 11 clippings — a whole
  topic cluster that looked like lost work and was in fact eleven broken links.

  The repair joins on **`source-hash`**, never on the title — the title is precisely
  what drifted. `slugify` is used only to decide which of a page's *own* clippings
  an unresolved citation meant, and only among candidates the hash already vouched
  for. Anything it cannot pin to exactly one clipping is reported, never guessed.
  Dry-run by default, `--apply` to write, idempotent.

- **`/wiki-ingest` and `wiki-maintainer` now say to cite the clipping by path**
  (`[[raw/clippings/<file>.md]]`, copied from the path just read) rather than
  retyping the source's title, so the drift above cannot be reintroduced.

## 0.8.1 — 2026-07-24

### PDF and DOCX clippers get the cross-platform title fix

0.8.0 fixed `titleFromXlsx` deriving titles with `node:path` `basename`, which honors `\`
as a separator only on Windows — a Windows-style path handled on a POSIX runner kept its
`C:\dir\` prefix in the title. The PDF and DOCX clippers carried the identical pattern;
their tests only ever passed POSIX paths, so the bug sat latent there while the xlsx test
alone went red. Both now split on both separators, and both test suites gained the
Windows-path assertion that would have caught it.

## 0.8.0 — 2026-07-24

### `/wiki-ingest` finds the backlog by hash-join, not by hand

The empty-args branch of `/wiki-ingest` told the agent to `obsidian search
query="tag:clippings"` and hand-diff the results against `wiki/sources/` — the exact
fuzzy link-resolution the `source-hashes` content-join was built to replace. It now
runs `node scripts/health.mjs --backlog`: the **not ingested (no summary records
their hash)** count is the backlog, authoritative and drift-proof. The full report
already computed this; it just sat last, under every deferred forward-link, where the
one question `/wiki-ingest` asks was the hardest line to find.

- **New `--backlog` flag on `health.mjs`** prints only the four ingest lines, leading
  with the not-ingested count. `backlogReport()` is exported and covered by a test.
- **The obsidian-cli skill now states the vault path convention** (`WIKI_MASTER_VAULT`,
  default `~/.wiki-master-vault`) so a cold-start agent reads it from the skill instead
  of searching the disk — the convention lived only in `scripts/lib/vault.mjs` and the
  README, neither of which the runtime agent loads.
- **The six standalone skills that don't hard-load `wiki-maintainer`** (`wiki-health`,
  `wiki-discover`, `wiki-stale`, `wiki-triage`, `clip-docx`, `clip-pdf`) gained a **lazy**
  context guard: load `wiki-maintainer` only if it isn't already in the session, so an
  agent entering cold through one of these still gets the vault location, guardrails, and
  shared metrics — and pays nothing when it arrived mid-run with them already loaded.
  `wiki-init` is deliberately excluded — a fresh scaffold has no vault contract to inherit.
- **Fix: `titleFromXlsx` now derives the title cross-platform.** It used `node:path`
  `basename`, which only treats `\` as a separator on Windows, so a Windows-style path
  handled on a POSIX runner kept its `C:\dir\` prefix in the title. Splits on both
  separators instead. (Pre-existing; unrelated to the ingest work but shipped here.)

## 0.7.2 — 2026-07-22

### The obsidian-cli canary goes lazy

The "probe once per session" upfront canary is replaced by a lazy one: nothing runs in advance,
and any command that returns hits proves the backend alive on its own. The probe fires only when
a command returns empty **and** that emptiness is about to drive a decision — the one moment
"vault has nothing" and "backend is dead" are actually indistinguishable. A session whose
commands all return results never probes at all. Detection unchanged; ritual removed.

## 0.7.1 — 2026-07-22

### Oversized pages become searchable (truncate-on-failure) + drift run survives them

0.7.0 shipped "skip and log" for a page exceeding the embedding model's context window. Against
the live vault that had grown to 23 pages (~2% of the corpus) that were invisible to the semantic
channel and re-failed on every single search (23 doomed Ollama calls per run, forever, because a
failure is never cached).

- `semanticSearch` now retries a failing oversized body truncated to its first 4000 chars — the
  page's most representative slice (title, frontmatter, opening) — and caches the vector under the
  **full**-body hash, the same key `drift.mjs` shares. The page becomes semantically searchable and
  no later run re-fails it. A *short* failing body gets no retry: an identical input would fail
  identically (e.g. Ollama is down). Verified live: all 23 pages embedded, two of them immediately
  surfaced in a real query's results.
- `computeDrift` gets the per-page guard `semanticSearch` already had (it was never backported):
  one un-embeddable page or raw source — raw sources run longest, so they're likeliest to trip the
  context limit — no longer crashes the entire drift run. Failures are returned as `failed` and
  reported, never silent.

Full chunking was considered and deliberately deferred: it breaks the one-vector-per-page cache
contract shared with `drift.mjs` and starts re-implementing what the qmd tier already does
properly. If semantic recall on long pages matters, install qmd (tier 1).

### Tier 1 (qmd) actually exercised for the first time — three live bugs fixed

0.7.0 shipped the qmd tier tested only against stubs (qmd wasn't installed). Running it for real:

- **Empty is not an answer.** `qmd search` has no query expansion (deliberately — that's the
  multi-GB model download the integration avoids), so a natural-language query can legitimately
  hit nothing. The ladder returned `(qmd)` with zero results as the final answer; it now falls
  through to a tier that can still answer.
- **Collection-relative paths.** Under the documented setup (collection rooted at `<vault>/wiki`)
  qmd's file URIs come back as `sources/X.md`, missing the `wiki/` prefix every other tier
  carries. The 0.7.0 fixture was captured from a vault-rooted collection, which masked this.
  Either root now normalizes to vault-relative.
- **Slugified filenames.** qmd collapses punctuation runs (spaces, em-dashes, commas) to single
  hyphens inside its URIs — `Foale — A Listener-Centred Approach.md` came back as a path that
  does not exist on disk. Since real filenames legitimately contain hyphens, reversal is resolved
  against the actual vault file list by canonical-form comparison; unresolvable hits pass through
  rather than being dropped.

## 0.7.0 — 2026-07-22

### `/wiki-query` gets real semantic search — tiered, never a hard dependency

`/wiki-query`'s entire retrieval step was one `obsidian search` keyword call. The source pattern
wiki-master implements explicitly anticipates this gap and explicitly names a tool for it (`qmd`),
while explicitly licensing a simpler home-built alternative in the same breath. Measured directly,
this vault (357 sources, 563 wiki pages) is already past the range the source pattern says
index-only navigation covers comfortably.

New `scripts/search.mjs`: three tiers, each degrading to the next.
1. `qmd`, if detected on `PATH` (never a package.json dependency — shelled out to exactly like
   `obsidian`/`defuddle` already are).
2. Ollama embedding + brute-force cosine, reusing the *existing* `embed.mjs` client and
   `.wiki-master/embeddings.json` cache `drift.mjs` already populates (extracted into a shared
   `lib/embed-cache.mjs` so the two features can never drift apart) — merged with the keyword
   channel by Reciprocal Rank Fusion.
3. `obsidian search` keyword-only — the pre-existing baseline, always available.

Two real bugs surfaced only by testing against the live vault, both fixed:
- The `obsidian` CLI's `search` command prints the plain-text `"No matches found."` even with
  `format=json` requested, which broke JSON parsing on any zero-hit query.
- One real wiki page exceeded the embedding model's context window; Ollama returned HTTP 500.
  A single oversized page now degrades to "skip and log," not "crash the whole search."

`qmd`, if used, is invoked via its lightweight `search` subcommand specifically — its `vsearch`/
`query` commands were confirmed, live, to each pull an additional 1.28GB+ model on first use, a
surprise this integration deliberately avoids triggering.

Full design: `docs/superpowers/specs/2026-07-22-semantic-search-design.md`. Implementation plan
+ real findings: `docs/superpowers/plans/2026-07-22-semantic-search.md`. Prior art:
`docs/superpowers/research/2026-07-22-semantic-search-prior-art.md`.

## 0.6.0 — 2026-07-22

### A fifth page type for content that never had a `raw/` source

Everything under `wiki/` was, until now, a summary or analysis derived from a
captured `raw/` source, and the vault contract enforced that: every wiki page
cites its provenance, scored as a defect when it doesn't. That left nowhere to
put a genuinely original document — advisory documentation, policy, house
style — written directly into the wiki rather than derived from anything.

New `wiki/authored/` (`type: authored`): original, primary content that
declares its exception explicitly via the vault's existing `sources: []`
disclosure (unchanged mechanism — a page stating it rests on no external
artifact was already excluded from provenance scoring; this just gives it a
first-class folder, catalog section, template, and a full narrative license
like `wiki/syntheses/`). It is a living page like any other under `wiki/`:
revised in place over time, never requiring a `raw/` counterpart.

Bundled fix: `checkQuotes` (quote-lint) did not consult the `sources: []`
disclosure at all, so any quotation on a declared-no-provenance page was
flagged as unverifiable against zero evidence — 100% false-positive by
construction. It now skips those pages entirely, the same way it already skips
sentences that declare themselves unsourced.

See `docs/superpowers/specs/2026-07-22-authored-pages-design.md` for the full
design and the decisions behind the naming and licensing choices.

## 0.5.4 — 2026-07-22

### The skill asserted a scale bound its source never stated

`wiki-maintainer` told agents that "index-only navigation **is bounded**" at ~100
sources and that "**past that**" entry shifts to search. The source pattern says no
such thing. It reports that index-first navigation "works surprisingly well at
moderate scale (~100 sources, ~hundreds of pages)" — a positive claim about a range,
with no threshold and no failure mode. Six lines later, under a heading marked
*Optional*, it separately says "as the wiki grows you want proper search" and
suggests `qmd`, attaching no number. The two passages are not joined in the source.

Welding them turned "works well at X" into "fails past X" and manufactured a
threshold agents would cite as the source's own. The section now states the range,
says explicitly that ~100 is **not** a ceiling and must not be presented as the
trigger for adopting search tooling, and gives what is fair to assert instead: a
vault far past that figure is outside the range the source reports, and nobody has
measured what that costs.

**Why nothing caught it.** Every quotation in the chain was verbatim. The drift lived
entirely in the unquoted framing around an accurate quote — `bounds`, `explicitly`,
`stated ceiling`, `anticipates this`. Quote-lint compares quoted spans against
clippings and has no way to see that a correct quote has been mischaracterised by the
sentence introducing it. Worth recording as a limit of the verification tier rather
than a bug to fix: guardrail #5 covers fidelity of *quotation*; nothing yet covers
fidelity of *characterisation*.

## 0.5.3 — 2026-07-21

### Health now audits provenance outside `wiki/sources/`

`provenanceGaps` was gated on `isSourcePage()`, so roughly 90% of a vault — every
concept, entity and synthesis — was never checked for provenance at all. A concept
resting on nothing could score a clean 100.

New `unreachableProvenance` metric: a `wiki/` page that cannot be **walked back to
`raw/`** by any route, following frontmatter `sources:` and body wikilinks alike.
Scored 3 each (capped 20), below a source-page gap because it measures reachability
rather than direct citation.

It deliberately does **not** require a `sources:` field. Obsidian indexes frontmatter
and body wikilinks as the same edge — `backlinks` and `links` return both
identically — so demanding a particular channel would enforce house style, not
provenance. What it measures is the property that makes information findable: is
there a trail back to evidence.

Rules that keep it honest:

- **Sideways is not provenance.** A chain of concepts citing each other never reaches
  evidence, however long.
- **Source pages keep the stricter rule.** A summary must cite its own clipping, not
  borrow reachability from a neighbour it links.
- **`moc/` is exempt** — Maps of Content are navigational hubs by the vault contract.
- **`sources: []` is a declaration, not a defect.** The existing disclosure mechanism
  now applies to every page type, reported and not scored.

The evidence walk moved from `lint.mjs` into `lib/graph.mjs` so lint and health share
one definition of "can this be walked back to raw/" rather than drifting into two.

## 0.5.2 — 2026-07-21

### Quote verification was under-reading the evidence trail

Two faults in `/wiki-lint` were manufacturing unverifiable-quote reports.

**The walk was depth-first.** Provenance was followed depth-first with one shared `seen`
set and a depth cap, so a source page reached late down a long chain was marked seen at
the limit — and the page's *direct* citation of that same source, one hop from its own
clipping, then bailed on `seen` and was never expanded. Which evidence counted depended
on the order of a page's links. It is breadth-first now, reaching every page by its
shortest route. Traversal is exported as `evidencePaths` so it is testable without IO.

**Findings carried a truncated quote.** `checkQuotes` clipped each finding to 80
characters, so any tool re-checking a finding verified only the prefix — a long quote
whose opening matches a source and whose tail diverges read as miscited rather than
unsupported. Findings now carry the full quote; truncation moved to the printer.

Together these cut the reference vault's flagged quotes 485 → 454 with no page content
changed, and cut quotes that are verbatim-present-but-unreachable from 104 to 27. The
difference was never drift: those are real quotes whose clipping is interrupted
mid-sentence by extraction furniture (running heads, figure captions).

### Vault repair: `repair-quote-provenance`

`node scripts/repair-quote-provenance.mjs` (dry-run; `--apply`) records the source a
page already rests on, where it quotes a clipping verbatim but cannot reach it. It never
alters a quote, and refuses to attribute on anything short of a 40-character verbatim
run — `quoteFragments` splits on bracketed insertions, so `"what comes after [[Some
Page]]"` reduces to "what comes after", which matches unrelated prose and would write a
fabricated citation. Reachability is tested against the *clipping*, not the link, since
a cover page reachable only at the depth limit leaves its clipping one hop too far.

Quotes that match nothing, or carry no distinctive run, are reported and left for a
human. Nothing gets a citation invented for it.

## 0.5.1 — 2026-07-21

### Re-clip identity is content, not location

A clipper's duplicate check matched on the **binary's path**. Move the binaries — as the
0.5.0 vault rule requires — and every lookup misses, so a re-clip pass writes a second
copy of content the vault already holds, beside the original as `<slug>-<hash7>.md`.
Slug disambiguation was working correctly; it was being asked the wrong question.

`clip-pdf`, `clip-docx` and `clip-xlsx` now check the extracted body's **content hash**
before writing and report `exists (same content): <path>` instead of creating a second
file; `clip-and-repoint` reads that as a reuse, not a failure. Disambiguation is
unchanged, so a genuinely different document sharing a title still gets its own file.

### Vault repair: `dedupe-clippings`

`node scripts/dedupe-clippings.mjs` (dry-run; `--apply` to delete) removes clippings that
duplicate another's content-hash, keeping the copy the vault cites. It **refuses** any
group where every copy is cited or none is — the first case is a deliberate duplicate
(one paper bookmarked twice, documented in the summary's dedup note), the second has no
keeper it can prove correct. Idempotent and convergent.

Vaults synced from another machine should run it once and commit. A vault that ran the
0.5.0 clip-and-repoint pass will also have duplicate `wiki/sources/` pages recording the
same `source-hashes`; those need a judgment call and are reported by `/wiki-lint`, not
auto-merged — the newer page can hold specifics the older one lacks.

## 0.5.0 — 2026-07-21

### The vault holds only `.md` and the images those `.md` files reference

Binaries (`.pdf`, `.docx`, `.xlsx`, `.zip`) are **never** in the vault, and the tooling
**never moves them**. They stay wherever you keep them. `clip-pdf` / `clip-docx` read a
binary **in place** and write only the resulting `.md` into `raw/clippings/`, recording the
binary's own path in the clipping's `source:`. Download a PDF → "clip that" → the PDF does
not move; a `.md` appears in the vault.

### OCR escalation now triggers on quality, not just quantity

`clip-pdf` previously escalated to OCR only when the text layer was *thin*
(`wordCount < 100`). A broken or symbol-font PDF yields **plenty** of words — just corrupted
ones — so those were never escalated and landed as `fidelity: degraded` with OCR untried.
Escalation now also fires when the extraction assesses as degraded, and keeps whichever pass
reads measurably better (`shouldTryOcr` / `preferBetterExtraction`), so OCR can never make a
clipping worse.

### Triage dispositions now do the work they name

A `reclip` disposition used to close the issue without performing the re-clip, so
requests piled up unnoticed (30 sources on the reference vault, one dispositioned
three times because it kept resurfacing). `apply-reclips.mjs` closes the loop:

```
node scripts/apply-reclips.mjs            # dry run
node scripts/apply-reclips.mjs --apply
```

It folds the log for what was asked (latest disposition wins, so changing your mind
is honoured), **derives** from the vault what is still needed — a source whose
clipping now reads clean needs nothing — re-extracts through the right clipper with
OCR escalation, and carries the content hash forward to every citing summary so the
re-clipped source is not orphaned. A re-extraction that is still degraded is
reported and discarded rather than swapped in.

Related: triage no longer *logs* fidelity issues. A degraded clipping leaves its own
artifact (`fidelity:` frontmatter), so it is derived and self-corrects; only problems
that leave no trace (a 403, a blocked domain) belong in the append-only log.
Dispositions now suppress derived flags too — previously "acceptable" never stuck.

### Repairing a vault that has binaries in it

An older vault may contain binaries that summaries cite directly (`sources: ["[[X.pdf]]"]`).
Those citations have no readable provenance and no `source-hash` to join on. To repair:

1. **Move the binaries out of the vault** to any location you choose (this is a one-time
   cleanup — the tooling neither knows nor manages that location).
2. **Clip and repoint**, pointing the pass at wherever you put them:

   ```
   node scripts/clip-and-repoint.mjs --from=<dir>            # dry run
   node scripts/clip-and-repoint.mjs --from=<dir> --apply
   ```

   For each dangling citation it clips the binary in place, writes the `.md` to
   `raw/clippings/`, repoints every citing summary, and stamps `source-hashes`. Re-running is
   safe: a binary already clipped is reused, not re-clipped. Degraded extractions are still
   repointed (their `fidelity:` records the caveat) and filed to `/wiki-triage`.
3. **Stamp any hash-less clippings.** Clippings written before `source-hash` existed
   carry none, so they can never be hash-joined and their summaries stay stuck at
   `backfillPending`:

   ```
   node scripts/repair-missing-hash.mjs --apply
   node scripts/backfill-source-hashes.mjs --apply   # record the new hashes on the summaries
   ```

4. **Verify** with a health run. `provenanceGaps`, `backlog`, `missingHash`, and
   `backfillPending` should all reach 0; any remainder is a source with no text
   extractor (e.g. a spreadsheet), which is reference data rather than a prose source.

### Extraction prerequisites — and a Windows gotcha that will bite you

- **poppler** (`pdftotext`, `pdftoppm`) — PDF text + rasterizing. Required.
- **tesseract** — OCR fallback for scanned/degraded PDFs. Optional but strongly recommended.
- **pandoc** — `.docx` extraction. Required only for Word sources.

**On Windows, run extraction from PowerShell, not Git Bash.** Invoked from Git Bash,
`pdftotext` can emit Latin-1 bytes that Node then decodes as UTF-8, turning every non-ASCII
glyph into `U+FFFD`. The symptom is deceptive: ASCII prose extracts perfectly while every
equation, accent, and symbol becomes `░░░░`, so the clipping looks like a font/OCR problem when
it is purely an encoding artifact of the shell. The same PDF extracts cleanly under PowerShell.
If a clipping shows a high replacement-character count, re-extract from PowerShell before
concluding the source is bad. (See also `CLAUDE.md` §6.)

Also note a freshly-installed tool may be registered on the user PATH but absent from an
already-running shell's environment — verify with `Get-Command <tool>` from a new shell rather
than assuming it is missing.

## 0.4.0 — 2026-07-21

### Ingest-state tracking moves to a content-hash join

The ingest backlog is now computed by matching each clipping's `source-hash`
against the `source-hashes` recorded on `wiki/sources/` pages, instead of testing
whether a `[[wikilink]]` resolves. This fixes two false-positives that inflated the
backlog (172 phantom items on the reference vault, ~0 real):

- **Hash-suffix mismatch** — a summary citing `[[Title]]` never resolved to the
  clipping file `Title-<hash7>.md`. Hash equality is immune to the suffix.
- **Binaries counted as sources** — `.pdf/.xlsx/.zip` originals can never be a
  summary target; only `.md` clippings are now in the backlog universe.

It also delivers **re-ingest-on-change** for free (a re-clipped source gets a new
hash and reappears in the backlog) and adds two health metrics: `missingHash`
(clippings lacking a `source-hash`) and `backfillPending` (migration progress).

New frontmatter: `wiki/sources/` pages carry `source-hashes: [<sha256>, …]`. The
`sources: [[…]]` wikilink is retained for navigation. See
`docs/superpowers/specs/2026-07-21-hash-ingest-state-design.md`.

### Migrating existing vaults — run once per vault

A vault written before this release has source pages without `source-hashes`. A
transitional fallback keeps them credited (nothing regresses), but the backlog will
show phantom items again until the vault is migrated. **Agents: repair the vault by
running the one-time backfill.** From the plugin root:

```
node scripts/backfill-source-hashes.mjs            # dry-run: prints the plan + review queue
node scripts/backfill-source-hashes.mjs --apply    # writes source-hashes into wiki/sources/*.md
```

(The script resolves the vault via `WIKI_MASTER_VAULT`, default `~/.wiki-master-vault`.)

It is **idempotent** (only fills pages still missing the key) and **guesses
nothing**: ambiguous or unresolved citations are reported for human review, never
written. Expected benign residual — citations to binary originals (`unresolved`) and
clippings with no `source-hash` (`nohash`).

- **If your vault is git-synced across machines:** run the backfill on one machine
  and commit the vault. Every other machine is then already repaired — the
  `source-hashes` live in the vault's markdown, not in the plugin — so no per-machine
  action is needed beyond pulling the vault.
- **If machines hold independent (unsynced) vaults:** run it once on each machine.
- **Verify:** a health run should show `backfillPending` approaching 0 and the ingest
  backlog dropping to its true residual.

A follow-up release will remove the transitional link-resolution fallback once
vaults are expected to be migrated (track readiness via `backfillPending`).
