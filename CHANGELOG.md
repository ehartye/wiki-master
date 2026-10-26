# Changelog

## 0.68.0 — 2026-10-26

- A script no longer acts on the real vault by accident. With `WIKI_MASTER_REQUIRE_VAULT=1` and no `WIKI_MASTER_VAULT`, `resolveVault()` stops the script (exit 2, one line) before it reads or writes anything. Under `node --test` (`NODE_TEST_CONTEXT`, which a child process inherits) a vault outside the temp directory and the plugin's own folder throws, so a test that forgets to name a vault fails. `resolveVault(env)` now takes an environment object, and `test/helpers/temp-vault.mjs` gives a test a temporary vault and puts the environment back. Both guards are off in ordinary use.
- `--help` on a script no longer does its work. [measured] On a throwaway vault and home directory, all 51 scripts were run with `--help`: four changed things (`index-gen` rebuilt the index, `index-embed` refreshed the semantic index, `triage` started its server, `init` scaffolded a vault) and two ran in full (`lint`, `stale`). Those six now print their usage from `scripts/lib/help.mjs` before any vault is resolved, and a test compares a vault and a home directory before and after `--help` on every script. The other scripts reject `--help` as an unknown option or run as a dry run.
- New `scripts/scan-private-terms.mjs` (and `scripts/lib/private-terms.mjs`): scans the tracked and untracked (not ignored) text files of a repository for names that belong in the wiki, and exits 1 on a hit. Built in: a home-directory path, a GPU model, and invisible characters. With `--terms-file` (or `WIKI_MASTER_PRIVATE_TERMS_FILE`) it also checks a private list kept outside the repository, one term per line or a `/pattern/flags` regular expression. It reports path, line and rule number and never the matched text. `--known <path>` lists files with hits still to be sanitised: their hits do not fail the scan, a hit elsewhere does, and an entry with no hit left does too, so the list only shrinks. The test suite runs the built-in patterns over the repository on every run.
- [measured] First run on this repository: 421 built-in hits in 40 files (a home-directory path with an account name in recorded evaluation outputs and in four design documents) and three raw invisible characters in source (two in code, one in a test). All are fixed: the account segment is `<user>` in 37 files (362 replacements, JSON still valid), and the characters are written as escapes. A private list of project and machine names then found 287 hits in 36 files; the names are now neutral stand-ins everywhere outside six evaluation files (68 hits), which record questions asked of a private vault and cannot be reworded without re-running those measurements; they are named in `test/private-terms-known.txt`. Git history still holds the earlier text.
- The one-time authored-pages backfill (`authored-classify.mjs` and its test) and the design documents about it used the maintainer's real project names; they now use neutral ones (`acme`, `widget-agent`), with no change in behaviour for any other input.
- `validate-authored.mjs --terms-file <path>` runs the same private list and the built-in patterns over the pages of one ledger and reports each hit as a `private-term` defect with its line and rule number, never the text; `--terms-projects a,b` limits it to the pages of those projects (the first segment of `project:`). Without `--terms-file` the output is unchanged.
- Documentation: README "Tests and the vault" and "Public-repository hygiene", the two new environment variables, the access reference, and a "Public pages" paragraph in the authoring reference.
- Evidence: 28 new tests in four files (the suite is 1,614 passing and one skipped, the check that needs the private list; it was 1,586); 42 mutations were applied and each fails a test (two survivors of the first run, a path on another drive and the `-h` flag, each got a test). Of the 13 existing tests the test guard first flagged, none changed anything in a vault: they only resolved the default path (for a name, a comparison or a path check).

## 0.67.0 — 2026-10-26

- New `scripts/repair-ambiguous-links.mjs`: a dry-run-first helper for `ambiguous-link` defects (a bare `[[architecture]]` when two pages share the name), replacing a throwaway script that two lints in a row had reinvented. On its own it applies one rule: the page lives in a project's folder (`wiki/authored/<project>/`) and exactly one candidate does too. The link is rewritten to that path with the displayed text kept (`[[wiki/authored/<project>/architecture.md|architecture]]`); an existing alias and `#heading` are kept; a link in a table row uses `\|`; a `sources:` entry takes the full path with no alias. Links in code spans, fences, comments and a generated catalog fence stay as written. `--apply` writes, `--project=<slug>` bounds the run, `--json` prints the plan.
- Every other class is reported with its reason and never guessed: `shared-page` (a page outside every project folder), `needs-reading` (several candidates, or none, in the page's own project), `title-citation` (every candidate is a clipping sharing the cited title; it cannot be repaired from the citing page), and `catalog-line` (an occurrence only inside a generated catalog, which regeneration repairs). A reviewed `--mapping=<file>` of `{ "target", "path", "page"? }` settles the ones that need a reading and is refused unless `path` is one of the candidates. `--exclude=<path-prefix>` (repeatable) leaves pages alone that an application reads by title, where a path in a citation would break the reader, and lists them.
- It sets `updated` to the run date in the same write, leaves `reviewed` alone, and checks line by line that only wikilinks changed (a page that fails the check is left alone and reported). A second apply finds nothing.
- The backlog item's "hub MOC and a page share a name" class is not in the code: since 0.57.0 the MOC yields in navigation, so that case is neither ambiguous nor in a candidate list, and a test says so. The second helper the item proposed (an exact-title join for non-source pages in `repair-provenance-links.mjs`) is not built.
- [measured] Calibrated on the maintainer's vault as it stood just before the hand repair of 2026-10-20 (the tree extracted with `git archive` into a temporary directory, so the live vault was not touched): the planner finds 52 same-project (page, target) pairs, 62 links on 40 pages, against the 54 that lint repaired by hand with the same rule, with the same targets (`architecture`, `roadmap`, `drill` and similar). It reports 42 more, among them the 30 pages that point at one shared guide and the single links the item named as needing a reading. Applying it to the temporary copy took ambiguous links from 94 to 42 (all 52 repointed pairs resolved, the 42 left are the reported ones), and every other rule's count was unchanged with no new issue. On the live vault today it finds nothing, because the 0.57.0 resolver fix removed those cases.
- [measured] On that same older tree the 0.61.0 `malformed-frontmatter` rule names exactly one page, the one the backlog item described as having a doubled carriage return on its fence.
- Documentation: `skills/wiki-maintainer/references/maintenance.md` and one sentence in the `wiki-repair` skill.
- Evidence: 13 new tests; fourteen mutations each fail one. The first draft had a hub-and-entity class that the 0.57.0 resolver had made impossible to produce; the test that tried to build it failed and the class was removed.

## 0.66.0 — 2026-10-26

- The HTML fidelity check no longer counts site chrome as lost text. A Microsoft Learn page's `Feedback` widget, a share row, a sidebar: the extractor removes these on purpose, and each was reported as a possible selective loss, marking the clip `fidelity: partial` and queueing a triage entry for nearly every Learn clip even though every sentence relied on was present. A missing heading is now set aside only under one of four narrow rules: it restates the page title (which the clipping keeps in its frontmatter); it is the whole heading `Feedback`, `Share`, `Read next`, `Related posts`, `Recent posts` or `Stay informed`; on `github.com` only, it is one of GitHub's own chrome headings or a comment byline whose comment body was captured; or it sits inside a container whose id or class names a sidebar, menu, dropdown, table of contents, navigation, breadcrumb, widget, promo or banner. The generic and GitHub names also need at most 40 non-link words before the next heading (within the container for the container rule), so a section with a real body still warns. A container above the content root does not count.
- Nothing is set aside silently: the clipping's frontmatter gains `fidelity-ignored: <count>` when the count is above zero, the labels are printed on stderr, and `fidelityAssessment.ignored` carries each label with its reason. `assessFidelity` still returns the warnings array (with an optional fourth argument, the URL); `assessFidelityDetailed` also returns what was set aside. Existing clippings and their queued issues are unchanged.
- What still warns, by test: a missing content heading such as `Remarks` or `Syntax`; `Applies to` (it can hold compatibility information); a `Share your results` section; a `Feedback` section with a long body; a heading in a `menu` container with a long body; GitHub's chrome names on any other host.
- [measured] On five real pages fetched 2026-10-26 (two Microsoft Learn pages, the Git manual, a GitHub pull request, a GitHub repository), the warnings fell from 1, 1, 14, 14 and 18 to 0, 0, 0, 2 and 0. The two that remain are comment bylines on the pull request whose comment bodies are mostly links: the check's evidence that a body was captured is its longest run of non-link text, and on those two comments that run is GitHub interface text, so it cannot confirm and keeps warning. I tried the extractor's own removal log (Defuddle's `debug` option) as the signal first: it covers the Learn `Feedback` and one Git heading but nothing on GitHub, whose site extractor builds its output without a removal log, and trusting the extractor's judgement alone would be circular for a check that exists to catch the extractor removing real content.
- Not covered: the NVIDIA support and Epic documentation headings named in the backlog item (the page layouts were not measured, and their names are not generic enough to list), and the Git manual is covered by the container rule only because its category lists sit in a dropdown panel. A real content section named `Feedback` that the extractor drops with under 40 words would be set aside; that is why the count is recorded.
- Evidence: 18 new tests (16 for the rules, 2 for the clip's disclosure); the test pages are small stand-ins for the structures measured, with no third-party HTML in the repository. Twelve mutations each fail a test; a first run left one survivor (a heading that shares only some words with the title), and a case was added. A bug found while reviewing my own code, the container bound never applying because the text node was not recorded, was caught by a new test before it shipped.

## 0.65.0 — 2026-10-26

- New opt-in `lint.mjs --near`: a triage view of the unverified tier. That tier mixes the page's own wording in quotation marks (a coined question, a label) with a genuine quotation that has been altered, and nothing separated them, so a reviewer opened each one and searched the clippings. For each unverified quote of six or more words, `--near` aligns it with the best stretch of a raw clipping on the page's evidence path and, at 0.85 or better (the share of the quote's words that have a partner), prints the word diff: `[-word-]` is in the page's quote and not in the clipping, `{+word+}` is in the clipping only, and `a~b` pairs a word with its longer form (`know~knowing`, `sim~simulation`). It changes no tier; without the flag nothing is added to the text output or the JSON, and with `--json` it adds a `near` block (`listed`, `summaryOnly`, `threshold`, `minWords`).
- Negations, symbols and numbers never pair with another word, so `not` against `nothing` and `40` against `400` show as changes (the lint's never-skip list is reused). A quote whose only close match is a wiki page is counted in `summaryOnly`, not listed: a summary can match a quote closely without being the source, so only raw clippings are listed, each labelled with its kind. A coined question scores low and is not listed. Output is deterministic (ties go to fewer edits, then the earlier window; the list is ordered by score, page, quote), and a diff is always printed whole.
- The alignment is a word-level longest common subsequence over candidate windows chosen from the quote's rarer words (the three best per document), so a large clipping costs a lookup and a few small alignments. New module `scripts/lib/near-match.mjs`; `quote-match.mjs` now exports `NO_SKIP`.
- [measured] Whole-vault run, read-only, 2026-10-26, on the maintainer's vault: of 1,522 unverified quotes, 456 are listed (184 at 1.00, 73 at 0.95 to 0.99, 98 at 0.90 to 0.94, 101 at 0.85 to 0.89) and 16 more match only a wiki page. Cost of the new step: 31 s after 75 s of classification and 5 s of graph build; the whole process peaked at 3.1 GB resident, so this is an opt-in flag for a machine with room. I read 16 listed diffs across the four bands: each shows a small difference of the kinds the backlog item described (a changed or added word, an extraction split, a symbol). That is a read of a sample, not a precision rate. The Grochola example in the item was repaired in the vault the day it was found, so the fixture (`not know what the sim did` against `not really knowing what the simulation did`, diff `not {+really+} know~knowing what the sim~simulation did`) is its test.
- Documentation: the README "Content lint" section and the `wiki-lint` skill's unverified bullet describe the flag.
- [tested] A blinded reading comparison of the skill text and README, one reader per version, six questions. Old text: 0 of 6 answerable (the feature is not in it, so that contrast is expected). New text: 6 of 6 answered at high confidence, each matching the tested behavior. It shows the new text is sufficient for a cold reader, not that it beats a prior version; one reader per condition.
- Evidence: 16 new tests (10 for the alignment module, 6 for the lint wiring including `--page`, determinism and a long unclipped diff); full gate 1555 of 1555. Eight mutations of the alignment module and eight of the wiring each fail a test; one JSON mutation first produced a syntax error and was redone.

## 0.64.0 — 2026-10-26

- `lint.mjs` no longer lists a quoted document title as unverified. A source page that names its document (`This is Epic Games documentation, "World Partition in Unreal Engine"`) quotes a string that exists only in the clipping's `title:` line, which the body check never searched, so the quote landed in the one tier meant as a worklist of possible fidelity problems. A quote that would be unverified but is wholly the title of a clipping the page cites is now counted on its own (`tiers.title` in `--json`; one new line under the summary in the text report) and not listed.
- Only the unverified tier is reconsidered, so no verbatim, convention or gapped quote changes tier; a title with one word changed stays unverified; and only the titles of clippings on the page's evidence path count, so a quote of an uncited clipping's title stays unverified. `examined` still equals verbatim + title + the listed findings.
- Output contract: `--json` `tiers` gains a `title` key (the existing keys are unchanged; one test that pinned the exact key set was updated). The `Quote tiers:` summary line keeps its exact format, so a parser of that line is unaffected; the count is on its own line below it. `repair-quote-provenance.mjs` reads the strict findings, so it no longer proposes citations for title quotes.
- A clipping's `source:` URL is not matched, although the backlog item asked for it: a URL is a single word and every returned quote has at least five, so no quote can be part of one. The README says so.
- [measured] Whole-vault lint, read-only, 2026-10-26, before and after on the maintainer's vault: unverified 1,604 to 1,522, a title count of 82, nothing added, no quote re-tiered; verbatim (29,014), convention (945) and gapped (237) identical. The 94 of 1,646 in the item (2026-10-23) counted a quote that was a substring of any clipping's title, cited or not (6,153 titles); this release counts cited clippings only, by design. The removed quotes run from 5 to 17 words (median 8). One is a title's tail quoted across a hard-wrapped line break ("rarely based on solid evidence"), which is correct.
- Evidence: 6 new tests; six mutations each fail a test (title check on every tier, titles of uncited clippings, whole-title equality instead of containment, a title match still listed, counted as verbatim, a title line that always reports zero).

## 0.63.0 — 2026-10-26

- Documentation for the nested-quote lint (0.54.1), no scanner change. The README "Content lint" section now says what the scanner does with marks that nest: **only curly marks nest; straight marks alternate** (a straight mark closes the open straight quotation if there is one, else opens one, so `"a b c d e "f g" h"` is two quotes with `f g` outside both), a closing curly mark with no curly opener is ignored even inside an open straight quotation, and **style flags skip a quoted span only when it is one pair of marks with no other quotation mark between them**, so the words of an outer quotation around a nested one are still checked. The `wiki-lint` skill's step 3 points to that section.
- Each documented rule is pinned by a test (`test/lint-quote-pairing.test.mjs`) so the text and the scanner cannot drift apart again; four mutations of the scanner each fail one. A read-only `repair-quote-provenance.mjs` dry run on a throwaway vault holding the Brown-style nested quote proposes nothing for the page whose quote verifies, and only the page with no citation path to the clipping (`test/repair-quote-provenance-nested.test.mjs`). That script's `reachable` filter is a second defense behind the lint's own verdict that no fixture isolates, so it is covered only together with the lint.
- [tested] A blinded reading comparison, one reader per version, six questions answerable only from the README section and the skill's step 3, with "not in the text" allowed. Old text: 5 of 6 answered (the style-exemption question was correctly "not in the text", the skill had no pointer, and the straight-mark question was inferred at medium confidence). New text: 6 of 6 answered, each matching the tested behavior, at higher confidence. One reader per condition is a small sample.
- [measured] Whole-vault lint, read-only, 2026-10-26 on the maintainer's vault: 31,800 quotes examined, 2,786 findings (945 convention, 237 gapped, 1,604 unverified). Findings whose quote carries a run of spaces: 10 of 2,786 (the 0.54.1 item measured 59 of 2,869 on 2026-10-23), and 1 of 237 gapped findings (was 44 of 286). The remaining 10 are a different cause (a quote that spans a hard-wrapped line break and its indentation), not the gap a removed nested phrase used to leave.

## 0.62.0 — 2026-10-26

- New `op-commit.mjs --evidence-map <file>` (with `--paths-file`) certifies the bytes of receipts that record their own size and SHA-256. The map is a JSON object of ledger path to `{ "bytes": N, "sha256": "<64 lower-case hex>" }`. After staging and before committing, each staged blob is compared with its declaration. Before this, a vault's `* text=auto eol=lf` converted a captured CRLF receipt on `git add`, and the published file no longer reproduced its recorded hash; nothing noticed.
- On a mismatch it commits nothing, unstages exactly what it staged, keeps the operation token, and names each failing file with its declared and stored size and hash and the effective `text`/`eol` attributes. When the file on disk is the declared bytes and git converted it, it prints the exact `.gitattributes` line that keeps them (`<path> -text`, quoted for a name with whitespace, glob characters escaped); when the disk file differs from the declaration it says so instead and gives no attribute advice. It never edits an attribute itself: a broad attribute change could disturb unrelated content, so the line is added by the owner, listed in the ledger, and the same close is rerun.
- The map may only name paths in the exact ledger and is validated (non-negative integer size, lower-case 64-hex hash); `--evidence-map` without `--paths-file` is refused. Ordinary Markdown in the same ledger keeps the vault's text policy. A pass prints its own `evidence:` line, separate from the semantic-index notice. `commitPaths` gained an optional `verify` hook for this; its other callers are unchanged.
- [tested] On the maintainer's vault (read-only, 2026-10-26): the 20 files git stores as CRLF or mixed all carry `-text`; declaring their on-disk bytes and verifying the index blobs gave 20 of 20 verified in 622 ms, no false refusal.
- Evidence: 9 new tests on throwaway repositories with `* text=auto eol=lf` and `core.autocrlf=false`: a CRLF JSON receipt refused with nothing committed or staged and the token kept; the same receipt committed byte for byte with an exact `-text` line while a CRLF Markdown page in the same ledger is stored as LF; a binary file passing under the global rule alone; a wrong declaration; a missing path; one bad file refusing the whole commit; the quoted attribute line; map validation; the CLI. Eight mutations each fail a test; the first run left one survivor (the count in the refusal header) and an assertion was added.

## 0.61.1 — 2026-10-26

- Fixed: `repair-wrapped-links.mjs --apply` could collapse paragraphs, headings and list items into one line. The detector read a `[[` named inside a code span (for example "no editorial residue (`%%`, `[[`)") as a link opener and matched it to the next `]]` however far away, then replaced every newline in between with a space. `op-commit` reported that false match as a hard-wrapped link and told the writer to run `--apply`. A span is now a `[[` that is not inside code or a comment, up to the next `]]`, with no other `[[` and no blank line between; a paragraph break ends any link. `findWrappedLinks` and `dewrapText` both use it, so the `op-commit` warning and the repair agree.
- Fixed: a genuine repair on a file with CRLF line endings left a carriage return inside the link (`[[Tooling API\r Guide]]`), because only the LF was collapsed. A CRLF is now collapsed whole. Together these two defects are how a page ended up holding a block of CR-only line breaks (`\r \r`): the false match plus the leftover carriage returns. That block was found by the 0.61.0 frontmatter work and traced to a repair on 2026-08-16.
- `prose()` (the text with code and comments blanked, offsets preserved) moved from `scripts/lib/integrity.mjs` to its own module `scripts/lib/prose.mjs` so the detector can use it without an import cycle through `graph.mjs`; `integrity.mjs` still exports it. The text was moved unchanged (a script compared the two before writing).
- [tested] On the maintainer's vault (2026-10-26) the dry run reported 1 file and 1 fix before and reports 0 and 0 after: the one fix was the false match above, in a page already repaired. Nothing else changed.
- Evidence: 8 new tests, including the real page's shape end to end through `repairWrappedLinks` with and without `--apply`. Each of four mutations (no code masking, no nested-opener guard, no blank-line guard, the CR left in the target) fails a test; a first run of the mutation check showed two survivors because each of the two guards hid the other in my tests, so a case was added where only one of them can help.

## 0.61.0 — 2026-10-26

- New integrity rule `malformed-frontmatter` in `health` (and so in `wiki-repair`'s worklist and `validate-authored`). A page that opens with a frontmatter fence but whose metadata is not read is now named, with the file and line: a fence line with a stray carriage return (`---\r\r\n`), a fence that is never closed, or a carriage return inside the block that is not half of a CRLF. Before this, such a page parsed with no metadata at all and `health` reported a `missing-evidence` on a page that declares `sources: []`, which pointed at the wrong problem; the page also dropped out of its project's catalog. The damaged page no longer also gets that `missing-evidence`, and every other check still runs on it.
- Only the opening region is examined. A stray carriage return in the body parses correctly and is not this rule; a plain CRLF page, an LF page and a page with a byte-order mark are clean. A file that uses carriage returns alone as line endings (no LF at all) is not detected.
- The integrity contract gains one issue type (`docs/wiki-integrity.md`, `wiki-repair` and the authoring reference list it). Issue IDs of every existing rule are unchanged: `malformed-frontmatter` has its own rule name in the ID.
- [tested] On the maintainer's vault (2026-10-26, 10,060 content pages scanned), the scan adds 0 issues and removes 0 (25 defects before and after, 712 unresolved links before and after), so the rule produces no false positive there. The known damage was a page already repaired and two pages whose stray carriage returns are in the body, which is not frontmatter damage.
- Evidence: 9 new tests. Mutations: not suppressing `missing-evidence` fails 3, not reporting fails 5, searching the whole page instead of the opening region fails the body-carriage-return test.

## 0.60.0 — 2026-10-26

- Repository line endings are now a stated policy. `.gitattributes` gains `* text=auto eol=lf`: text files are LF in the repository and in every working tree, whatever `core.autocrlf` says (the `test/fixtures` rule it generalizes was already there). Before this, a Windows checkout with `core.autocrlf=true` held CRLF copies of files that git stored as LF (measured on a fresh worktree: 420 of 477 tracked files `i/lf w/crlf`), so scripted multi-line edits found nothing to match and `git add` printed a warning per file. `git add --renormalize .` stages nothing: the repository already stored LF. The README documents the one-time recipe for a checkout made before the policy (`git rm --cached -r -q . && git reset --hard`, with a clean tree), which was run on a worktree and left 477 of 477 text files LF on disk.
- Test fixtures no longer depend on the machine's git configuration or leave files behind. Every fixture repository pins `core.autocrlf=false`, and the sync fixtures clone inside their world's root, so the world's cleanup removes them. Measured before: one run of `test/wiki-sync.test.mjs` left 55 `wm-sync-*` directories in the temp directory and the full suite printed 274 "LF will be replaced by CRLF" warnings; after: 0 and 0. A new test runs the sync suite with a global `core.autocrlf=true` and its own temp directory, and fails on a warning or any leftover directory.
- The gate was run on Windows under Node 22.23.4 as well as Node 24.18.0: 1500 of 1500 pass on both. A `git archive` export of `test/fixtures` carries 0 CR bytes.
- No script or skill behavior changes. This release is repository and test hygiene.
- Evidence: 6 new tests (`test/line-endings.test.mjs`: the policy rule, a CRLF file stored and cloned as LF under `core.autocrlf=true`, a binary file's bytes unchanged, no tracked file stored as CRLF; `test/git-isolation.test.mjs`: the sync suite under a hostile global config). Removing the `.gitattributes` rule fails two of them; putting the clones back in the shared temp directory fails the isolation test; the isolation test was first run as a child of the test runner without clearing `NODE_TEST_CONTEXT`, where it passed vacuously in 85 ms, and now asserts that the child ran as a normal suite.

## 0.59.0 — 2026-10-26

- New `scripts/rename-doubled-extension-clippings.mjs` renames the clippings whose names double the extension (`README.md.md`) and repoints the citations to them. It shares one engine with `rename-unsafe-clippings.mjs` (0.53.0), whose behavior is unchanged. Dry run by default; `--list-out <file>` writes every rename and repointed page as tab-separated lines for review; `--apply --paths-out <ledger>` applies and writes the `op-commit` ledger. A `clip-gh` file loses its second `.md`; a top-level clipping with an empty title is renamed from its source URL, nearest folder first, as new clips are. File bytes and `source-hash` are untouched, only full-path wikilinks are repointed, `raw/`, `log/` and `_templates/` are never rewritten, a rename onto an existing name (case ignored) is refused, and a second run is a no-op.
- Safety: an apply now refuses to start, and changes nothing, when any file it would rename or rewrite has uncommitted changes in the vault's git, because another writer may be editing it. A dry run never refuses, a vault that is not a git repository is not blocked, and `--exclude=<prefix>` reports a page prefix without rewriting it. `--flag=<prefix>` lists the pages under a prefix for review (for citations an app reads by title). This guard applies to `rename-unsafe-clippings.mjs` too.
- Fixed in the rewrite shared by both scripts: a link to the extension-stripped path of a renamed file was repointed even when an existing file had exactly that path. A vault can hold both `raw/clippings/Build.md` and `raw/clippings/build.md.md`; a link to `Build.md` means the real file (the resolver gives an exact file priority over another file's stripped path), and matching case-insensitively would have repointed 16 pages' citations of the real file to the wrong one. Found when a run on the maintainer's vault was reversed; the rewrite now skips the stripped form when a file of that exact path exists.
- `clip-gh` no longer doubles the extension for new files: `README.md` is `README.md`, `skills/one/SKILL.md` is `skills-one-SKILL.md`, and a source file keeps its own extension (`src/a.js` is `src-a.js.md`). A doubled file that already exists for a path is kept and updated in place on a re-clip, so a re-clip never makes a second copy and never breaks a citation before the rename migration moves it; in digest mode it is not pruned. Two paths that would share one new name in a run (`LICENSE` and `LICENSE.md`) both keep a file, the second under the doubled form.
- [tested] A read-only dry run on the maintainer's vault (2026-10-26): 161 renames, 0 refused, 88 pages and 407 links to repoint, 10 other mentions left as written, pages flagged on request. The vault was not changed by this release.
- Evidence: 31 new tests (7 `clip-gh` naming, 9 planner, 10 migration, 5 dirty-file guard), with mutations of the keep-existing-doubled branch, the same-run collision fallback, the collision guard, the URL rule, `--exclude`, the flagging and the dirty guard each failing a test; the stem-form rule was first written too broadly and a new test caught it.

## 0.58.0 — 2026-10-26

- Fixed: a bulk clip of title-less documents no longer loses all but the first. A document with `title: ""` slugged to `untitled`, the fallback was the URL's last segment (`SKILL.md`, which the writer then gave a second `.md`), and when both names existed the clip returned `duplicate` with a line that named neither the URL nor the file and left no triage row. `clip.mjs` now takes the first free name from a fixed, deterministic list (new `lib/clip-slug.mjs`): the title or first heading, then the last URL segment, then the parent folders nearest first; a document with no title and no heading is named from its folders nearest first, so `.../skills/one/SKILL.md` is `one-SKILL.md`; then URL-hash forms, which differ for any other URL. Names are compared ignoring letter case and the list is bounded at 100.
- New result `clash`: when no name can be taken, or five exclusive writes in a row lose to other sessions, the clip writes nothing, records one open `attention` triage row naming the URL and the file that holds the name, and prints one line naming both. The file is created exclusively (`wx`), so a clip never overwrites a file another session just made; a write that loses a race to a clip of the same URL is `duplicate` with one copy. Existing clippings are never renamed or overwritten. `duplicate` now always means the same URL.
- New clippings no longer end `.md.md`: the source's `.md` is dropped from a URL-derived name and a title ending `.md` is cut, so the writer's one `.md` finishes the name. The 159 existing files that double the extension are unchanged here and are renamed in a later release.
- A new clip does not take a title another clipping already holds: the distinguishing URL part is added, for example `Smith v. Jones (93-1260.ZO)`, in the `title:` and in the file name (parent folders and then the URL hash if that is taken too). An empty title stays empty. [tested] On the maintainer's vault 42 titles are held by 122 of 5,687 clippings (one site's title 13 times, another's 11), which new clips will no longer add to; those existing titles are unchanged.
- New `--slug=<name>` on `clip.mjs` and on `clip-pdf`, `clip-docx`, `clip-pptx` and `clip-xlsx`: the file name without `.md`. A taken name is a recorded `clash`, never suffixed. New `--title="<text>"` on the four document clippers, for a file whose name is not its title (`valve.pdf`). Without the options their behavior is unchanged, including the content-hash suffix on a name clash. An empty value is ignored.
- Changed: the seven clippers (`clip`, `clip-pdf`, `clip-docx`, `clip-pptx`, `clip-xlsx`, `clip-confluence`, `clip-gh`) reject an option they do not know with exit 2 and their usage, before any network or vault activity, and `--help` or `-h` prints the usage and exits 0. `clip.mjs <url> --dry-run` used to perform a real write. Only the command-line entry checks, so a caller that runs `main()` is unaffected, and extra words that are not options are still ignored. The usage text of all seven now lives in `lib/clip-args.mjs` with the accepted options. This is the clipper part of the unknown-flags item; the other scripts are unchanged.
- Skill text: `wiki-discover` now explains what each clip result means (`clipped`, `duplicate`, `clash`), the naming rule with the worked example, how to find the file that holds a colliding name (read its `source:`), `--slug` and `--title`, and that an unknown option is rejected. A blinded reading comparison, one reader per text: the reader of the new text answered all 7 answerable questions correctly and answered "NOT IN THE TEXT" to the two it cannot answer (installing the browser render component, what `fidelity: partial` means); the reader of the old text answered "NOT IN THE TEXT" to all nine. The text says nothing about how to install the browser renderer or produce a saved copy of a rendered page, because no check for it exists.
- Evidence: 14 tests in `test/clip-slug.test.mjs` and 14 in `test/clip-slug-clash.test.mjs` (the four-URL probe, the clash row, five lost writes, both race cases, the unique title, `--slug`, and the document-clipper helpers), 9 in `test/clip-args.test.mjs` including a real process per clipper; mutations of the naming order, the extension rule, the title rule, the race re-check, the exclusive flag, `--slug` and one clipper's guard each fail a test. `test/clip-topic-flag.test.mjs` now checks the shared usage text. `clip-pdf` was also run by hand on this machine with real PDFs: default name from the file, `--title` and `--slug`, a taken `--slug` recorded as a clash, an unknown option and `--help` touching nothing. The DOCX, PPTX and XLSX clippers use the same two helpers (unit-tested) but need pandoc, LibreOffice or Python, so they were syntax-checked and not run.
- Not done: preferring a content heading over a generic site title (`npm Docs`) beyond the unique-title rule; the `clip-gh` file names, which keep their doubled extension until the rename release; and `--help` for the 41 scripts that are not clippers.

## 0.57.0 — 2026-10-26

- Fixed: a link equal to a file's name is no longer ambiguous with other files that only share its `title:`. Some sites serve every part of a document under one HTML title (Cornell LII gives a case's syllabus and opinion one title), so two clippings carried the same `title:` and a link by that title had two candidates. Now a file whose own name equals the link outranks files that share it only as a title or alias, within the same channel: among raw clippings for a citation, among content pages for navigation. Two files with the same name stay ambiguous, and the provenance and navigation channels are still never merged. The integrity resolver (`lib/integrity.mjs`) and the name index (`buildNameIndex` in `lib/graph.mjs`, used by the lint's evidence trail and the navigation counts) both apply it.
- Fixed: in navigation a project's generated hub MOC (`moc/<project>.md`) yields to a page of the same name, so a bare mention of the project reaches the entity page instead of reporting an ambiguous link. The MOC is still reached by its path.
- New: `refresh-catalogs.mjs` names the other projects' generated catalogs (MOCs and the fenced part of a roadmap) whose bare link became ambiguous because of a page in the project being refreshed, as `staleCatalogs` in its result plus a line on stderr. It reads files and edits nothing; the selected project's own catalogs and an unscoped refresh are never reported. Run the refresh for each named project.
- Changed contract, one test: a page that declares `title: C` no longer makes the link `[[C]]` ambiguous with the page actually named `C`; the page named `C` wins. `test/evidence-integrity.test.mjs` pinned the old "ambiguous" result and now pins this one.
- [tested] On the maintainer's vault (one run each, same code before and after): open integrity defects 66 to 25, with the 41 `ambiguous-link` issues gone and no issue ID added; `missing-evidence` (24) and `unresolved-citation` (1) unchanged; unresolved navigation unchanged at 712. The lint moved 6 quotes from the unverified tier to verbatim (unverified 1,610 to 1,604; verbatim 29,008 to 29,014) and listed nothing new. The 41 links were all title collisions on 33 pages; the 26 MOC-versus-entity links the item counted had already been repaired by hand, so that rule is covered by fixtures only.
- Evidence: 9 resolver tests (integrity and name index, with three mutations that each fail a test), 5 `refresh-catalogs` tests (two mutations of the exclusion rule each fail one), and the authoring reference and `wiki-author` step 6 describe both rules and the new field.

## 0.56.0 — 2026-10-26

- New read-only command `scripts/backlog-list.mjs [--project <name>] [--backlog-status <a,b,...>] [--startable] [--json]` lists backlog items by their lifecycle. A search for `status:` finds the page status (`draft`, `maintained`), not the lifecycle `backlog-status`, so a review that grepped first listed no planned items. Each line is tab-separated: project, lifecycle status, path, title (the first heading) and `waiting on <items>` when a prerequisite is unmet. `--backlog-status` takes the five lifecycle words and `unrecognized` (the items a generated roadmap lists under "Unrecognized status"); `--startable` keeps planned items with no unmet prerequisite, declared or not. Exit 2 on bad input. It reads only `wiki/authored/`, builds no whole-vault graph, and writes nothing (tested by snapshot). [tested] On the maintainer's vault it listed a project's startable items in 1.1 seconds, against 36 to 63 seconds for `validate-authored.mjs`. `wiki-search` and the authoring reference name it.
- New, opt-in per project, from the project's own roadmap frontmatter: `backlog-titles: true` shows each item's first heading as its roadmap link text (a pipe or bracket in a heading becomes a space; an ambiguous name keeps its full-path target), and `backlog-shipped: collapse` replaces the Shipped list with a count and a link to a generated sibling page `roadmap-shipped.md` (kind `reference`, created on first use, with its own fence and the same required keys). Turning collapse off lists Shipped again and leaves the sibling page to be deleted by hand. [tested] A project that sets neither regenerates byte-identically: the 0.55.1 and the new generator render the same catalog for all 59 projects (1,795 items) on the maintainer's vault. On the Agent Sprites project (137 items) both settings would shorten the generated section from 144 to 45 lines, with the 101-line shipped list moved to the sibling page; neither was switched on there.
- Internal: `scripts/lib/backlog-read.mjs` reads the backlog items under one folder and is shared by the new command and `validate-authored.mjs`, which had its own copy of the walk.
- Evidence: 14 tests in `test/backlog-list.test.mjs` (breaking the startable rule or the status filter each fails a test) and 10 new cases in `test/backlog-gen.test.mjs`.

## 0.55.1 — 2026-10-26

- Fixed: a backlog item whose `backlog-status` is outside the vocabulary (`proposed`, `done`, `open`) or missing was left out of the generated roadmap without a word. `backlog-gen.mjs` now lists it under `## Unrecognized status` with its value and the allowed words, `regenerateBacklogRoadmaps` returns the item paths as `unrecognized`, and the `backlog-gen.mjs` and `refresh-catalogs.mjs` commands name them (the key is present only when there are some). [tested] On the maintainer's vault the 0.55.0 and the new generator render byte-identical catalogs for 55 of 59 projects; the 4 that differ are the 4 projects holding 10 such items (9 `done`, 1 `proposed`). `proposed` was not added to the vocabulary; the heading names the five allowed words.
- Not done: `health.mjs` and `lint.mjs` still do not report such pages, because a new integrity rule would change the health worklist contract. Tracked as its own item.
- Fixed: a roadmap stub for a project whose name is not a plain YAML scalar (a ` #` or `: ` in it, a leading `-`, quotes and so on) now writes the name double-quoted, so it parses back to the folder name and validates. Plain names (`demo`, `acme/tool`, `demo-valley 2`, `café`) are written bare as before. The `: ` case is tested on the function only, because Windows cannot create such a folder.
- Tests: the vocabulary contract test compared every code span that begins with `backlog-status:` against the full list, so ordinary prose naming one status failed it with an array diff. It now compares only spans that list values with `|`, and a drifted list is reported with its line and span (tested against the real reference with a value removed). A list cut down to a single value is not detected.
- Skill text: `wiki-author` step 5 is split into validate, refresh catalogs (rerun the check when the refresh added paths) and complete; its description now says "check the frontmatter, folder placement and links of the pages an authoring task just wrote". Before writing that the vault holds no source on a topic, it must run two bounded searches and report "not found by these queries". The authoring reference states that `missing-file` also covers a page that does not exist or a different Unicode form, and that `--json` is what `validateAuthored()` returns; it and the backlog-item template now ask that a behavior stated as tested carries the exact call arguments and log text.
- Evidence for the text changes, from reading and not from a live session: nine questions answered by one reader per text from the text alone, old against new. The new text answered all nine (one hedged); the old answered seven, and the two it could not answer are the two added rules. Routing: eight prompts against the old and the new descriptions, 8 of 8 each time with the same skill chosen. One reader per condition, so noise is not measured.

## 0.55.0 — 2026-10-25

- A backlog item can now say what it waits on. `depends-on` in an item's frontmatter lists quoted wikilinks to other backlog items of the same project (`depends-on: ["[[other-item]]"]`). A prerequisite is met once its item is shipped or dropped. The relation is derived and never changes an item's own status, so a hand-set `blocked` stays under Blocked.
- `validate-authored.mjs` checks the key on ledger pages with six new rules: `dependency-dangling` (no such item in the project; a note in `backlog/` is not an item), `dependency-cross-project`, `dependency-self`, `dependency-cycle` (names the whole loop, reported on each ledger page in it), `dependency-malformed` (an entry that is not a wikilink) and `dependency-misplaced` (the key on a page that is not a backlog item). Only the item's own project `backlog/` folder is read, so the checks add no second whole-vault scan. The cycle search is iterative; the tests run a 20,000-item chain and ring.
- `backlog-gen.mjs` (and so `refresh-catalogs.mjs`) appends ` — waiting on [[prerequisite]]` to an open item with an unmet prerequisite (an unresolved one is shown as plain text, never a dead link) and lists every planned item whose declared prerequisites are all met under a trailing `## Ready to start` section. An item that declares nothing is startable and is not listed there.
- Not changed for projects that do not use the key. [tested] The new and the 0.54.1 generator render byte-identical catalogs for all 59 projects (1,781 backlog items) in the maintainer's vault, none of which uses `depends-on` yet. Cross-project dependencies are rejected on purpose. A bare name that is also an item name in another project resolves inside the item's own project; qualify the path if Obsidian should open the other one.
- Evidence: `test/backlog-deps.test.mjs` (13 tests; breaking the closed-status rule or the cycle search each fails a test), 11 new cases in `test/validate-authored.test.mjs`, 8 in `test/backlog-gen.test.mjs` and a pin that the key and all six rule names appear in the schema, the authoring reference and the item template.
- The authoring reference, the vault schema and the backlog-item template document the key. Existing vaults need no migration; copy the updated template comment into a vault's `_templates/` if you want it there.

## 0.54.1 — 2026-10-24

- Test fixtures stay LF on Windows checkouts: `test/rest-reference.test.mjs` read the REST-reference HTML fixtures as they were on disk, so with `core.autocrlf=true` the two exact-example cases (artifacts, workflow-runs) failed with `missing exact example` while the extractor was unaffected (LF and CRLF pages extract to byte-identical Markdown, title and fidelity warnings). The test now reads the fixtures as LF and has a fifth case that extracts both forms and compares them. A new root `.gitattributes` (`test/fixtures/** text=auto eol=lf`) keeps fixtures LF on a fresh checkout and in a `git archive` export. [tested] Before: 4 tests, 2 failed; after: 5 of 5 on Node 24.18.0 and Node 22.23.4 with CRLF fixtures (git 2.55.0.windows.3); removing the reader normalization turns exactly the two original cases red; the attribute alone fixes the unmodified test on a fresh checkout; `git archive` carried 845 CR bytes in 55 fixture files before and 0 after. [general] CI (Linux) was already green and is unchanged; not run on Linux or macOS here. No script, skill or extractor change.
- Drift test: the version check in `test/drift-guard.test.mjs` now compares all nine JSON version fields in seven files against `package.json`, including `.github/plugin/marketplace.json` `metadata.version` and `package-lock.json` `packages[""].version`, which the old check never read; a discovery test fails on any version key not listed in the `VERSION_FIELDS` table (or a listed row whose key is gone), so a new manifest cannot skip the bump. Evidence: on a clone with those two fields one patch behind, the old test passed and the new one fails naming the file and field. The README gained a Releasing section listing the ten places a release changes. Not changed: no script or manifest behaviour; there is no bump script yet.
- Fixed: `lint.mjs` kept a phrase quoted inside a quotation. A curly phrase inside a straight quotation used to be removed from the outer quote and left a run of spaces, so a verbatim quote was reported as gapped (the phrase listed as inserted) or unverified. The extractor now pairs quote marks in document order with a stack: the outer quote keeps the inner words with the inner marks removed, a nested phrase of five or more words is also checked alone, a straight mark no longer pairs across a blank line, and a stray closing curly mark is ignored. Evidence: lint tests 39 of 39, 15 new, 9 of them failing at the base; scanner timing on a 10 MB quote-dense string 148 ms against 104 ms. Not changed: tier definitions, the declared-unsourced exemption, the `checkQuotes` contract, the style-flag quote exemption. A same-paragraph stray straight mark (an inch sign) still pairs with the next straight mark, as before.
- A roadmap that `backlog-gen.mjs` creates (and so `refresh-catalogs.mjs` too) now carries `type`, `created`, `updated`, `status: draft`, `sources: []`, `ai-generated: true`, `project` and `kind: roadmap`, so `validate-authored.mjs` accepts it and the project map lists it. Before, the stub lacked `created`, `updated`, `status` and `project`, which the validator reports as `missing-key`, and the project-less stub was never grouped into its project's map. `reviewed` is left out on purpose, and `created` and `updated` are the UTC day of the run. Evidence: the new tests fail at the base with four missing keys and an empty Roadmap section, and pass after (33 of 33 in `test/backlog-gen.test.mjs` and `test/refresh-catalogs.test.mjs`). The authoring reference describes the generated stub. Not changed: a dry run still creates nothing, an existing roadmap is never rewritten, and a project name that is not a plain YAML scalar is not quoted.

## 0.54.0 — 2026-10-24

- New `scripts/validate-authored.mjs --paths-file <JSON array> [--json]` checks only the pages one authoring task wrote, using the ledger format `op-commit` and `refresh-catalogs` take. Authoring tasks had no scoped check: `health.mjs` and `lint.mjs` report the whole vault, so showing that a task introduced no defect meant filtering that list or writing a throwaway validator. The command is read-only (no cache, no `.wiki-master` directory, no temp file). Exit 0 is clean, 1 means defects, 2 means unusable input. Each defect prints as `path:line rule message`, followed by `validate-authored: N pages checked, M defects`; `--json` emits the same data.
- Rules of `validate-authored.mjs`. For ledger pages under `wiki/authored/`: `missing-key` (type, created, updated, status, ai-generated and a `sources` line; `project` and `kind` inside a project folder; `decision-status` for a decision and `backlog-status` for a backlog item; a blank value counts as missing, so an unfilled template fails), `bad-value` (the allowed values are listed), `kind-folder-mismatch` and `project-folder-mismatch`. For every ledger page that is wiki content, from one integrity scan: `ambiguous-link`, `malformed-link` (a hard-wrapped link is one), `unresolved-citation`, `missing-evidence` and `unresolved-link`, which `health` leaves as an unscored forward link and this command deliberately reports as an error for the pages a task wrote. An absent ledger file is `missing-file`; raw, log, template, root catalog, non-Markdown and dot-prefixed entries are skipped and counted.
- Evidence for `validate-authored.mjs`: `test/validate-authored.test.mjs` (32 hermetic tests on temp vaults) covers the six-defect example, each rule, byte and timestamp equality of the vault before and after, the exit-2 input cases and a drift guard that pins the kind list and the backlog and decision statuses to `templates/vault-schema.md`, the authored templates and the authoring reference. 13 deliberate breaks of the validator were each caught. `wiki-author` step 5 and the authoring reference name the command, and `docs/wiki-integrity.md` describes it; the skill count is still 21 (descriptions changed in the skill-text entry below).
- Not changed by `validate-authored.mjs`: `health.mjs`, `lint.mjs` and the integrity scan. The command reuses `scanIntegrity`, so it still reads the whole vault (ambiguity is vault-wide); only the report is scoped to the ledger. Page `status` is checked for presence only, because older vaults hold values beyond stub, draft and maintained. The unrecognized backlog-status gap is closed for ledger pages only, not vault-wide.
- Skill text corrections found by having readers answer task questions from the plugin text alone, with no script change. `wiki-triage` listed a `clipped-by-hand` disposition the queue never writes (it writes `clipped-manually`) and left out `downloaded`; it now says which dispositions each kind of row offers. Descriptions changed for `wiki-author` (validate only one task's pages) and `wiki-health` (points per-task validation to `wiki-author`). The authoring reference gained the ledger recipe, the exit codes, the `--json` shape and the placement rules of `validate-authored.mjs`.

## 0.53.2 — 2026-10-22

- Make agents responsible for pushing their own authorized wiki updates through `wiki-sync.mjs` and verifying remote publication. A local commit or closed operation token alone is not a published update; no separate routine push confirmation is needed.
- Put this completion rule in the shared core, authoring and other writing routes, and include sync in both shell examples. Preserve explicit publication holds, local-only vaults, delegated operation ownership and other writers' work. Failed syncs resume from the actual saved commit state and are reported as unpublished.
- This changes skill guidance only; Git helpers, token storage and cleanup rules are unchanged.

## 0.53.1 — 2026-10-21

- Make automatic resolution of an agent's own operation tokens the shared skill default, unless the user explicitly asks to leave an operation open. Complete validated scoped commits and already-authorized sync without another confirmation; recoverable failures and resumed tasks continue the saved operation rather than opening replacement tokens or duplicating edits and logs.
- Explain uncertain completion, verified empty-delta closure, commit identity after sync rebases, delegated ownership and actionable blocker handoffs. Abandoned-token cleanup requires verified ownership, no unfinished work or user hold, an exact token ID and the helper's age eligibility. Age alone never authorizes cleanup of another agent's operation.
- Add matched behavioral probes for recovery, explicit holds, read-only lookup, abandoned own tokens and unresolved conflicts. This is skill guidance; token storage, cleanup eligibility and Git helper behavior are unchanged.

## 0.53.0 — 2026-10-20

- Name clippings so Obsidian can index them and a wikilink can carry them. Obsidian does not index a dot-prefixed file, and `graph.mjs` skips the same names, so a clipping filed as `.github-workflows-build.yml.md` was invisible: every citation of it was an `unresolved-citation` in `health` and a dead link in Obsidian, and an uncited one never reached the ingest backlog. A backtick in a filename was the same trap in another form: `health` reads a backtick pair inside a wikilink as an inline code span and blanks it, so a body link to such a file could not resolve. `slugify` (articles, PDFs, Word, Excel, PowerPoint, Confluence) and `slugifyRepoPath` (`clip-gh`) now spell each leading dot `dot-` and drop backticks (`scripts/lib/clip-names.mjs`): `.github/workflows/build.yml` is `dot-github-workflows-build.yml.md`, `` `stringify`-`uneval` shared memory `` is `stringify-uneval shared memory.md`. For `clip-gh` the step runs after the length cut and hash, so a long path keeps the digest of its full original path and a file keeps its name apart from the prefix.
- `clip-gh` adopts a clipping written under its old name instead of copying it or deleting it. Per-file mode renames the legacy file to the current name before the unchanged check, so a re-clip converges whether or not the content changed. Digest mode needs it for safety, not tidiness: it deletes every `.md` it did not just name, and an unchanged legacy anchor (`.github/CONTRIBUTING.md` is one) would have been skipped by the hash check and then pruned, taking the clipping with it. The run reports `renamed` (`anchorsRenamed` in digest mode). `writeFileClips` is the per-file write loop extracted from `main`, and `writeDigest` is now exported, so both can be tested against a local directory without cloning; behaviour is unchanged.
- New `scripts/rename-unsafe-clippings.mjs` migrates a vault. Dry run by default; `--apply --paths-out <file>` renames every unsafe `.md` under `raw/`, repoints full-path wikilinks (with or without `.md`, keeping the alias, a `#heading` and the table-cell `\|`) in every page except `raw/`, `log/` and `_templates/`, and writes the old names, new names and rewritten pages as an `op-commit --paths-file` ledger. Clipping content is untouched, so `source-hash` and re-clip deduplication are unaffected. It leaves links in code blocks, code spans and comments alone, reports other mentions of an old path without rewriting them, refuses (never overwrites) a rename whose target exists, skips non-Markdown files (a state file such as `raw/book-nom/.booknom-state.json` is hidden on purpose), and rewrites pages before renaming files so an interrupted run is finished by running it again.
- `health`'s coverage note listed the walk's exclusion as "dot directories"; the walk also skips dot-prefixed files, which is what hid these clippings. It now says "dot-prefixed files and directories". `integrity.mjs` exports `prose`, the offset-preserving code mask, for the link rewriter.
- Live vault, 2026-10-20: 37 renames (33 dot-leading `clip-gh` clippings across nine repos, 4 with backticks), 33 links repointed in 10 pages, 0 refused, 0 other mentions of an old path. All 37 renamed files are byte-identical to the originals. `health`: 165 → 145 open defects; the 20 resolved are all `unresolved-citation` (19 dot-leading, 1 backtick), none new, unresolved navigation unchanged at 713. Side effect: the 14 renamed clippings that no page cites are now visible, so the ingest backlog grows by 14 (they are repo config such as `.gitignore`, `FUNDING.yml`, workflow files and a PR template). Full suite: 1278 tests, 1271 pass, the same 7 Windows-only failures as `main` (5 `clip-pdf-figures`, 2 `rest-reference`).
- Not changed: `graph.mjs` still skips dot-prefixed names. A dot-directory such as a repo named `.github` now gets a `dot-github` folder from `slugify`, and none exist in the live vault. `health` does not yet report a hidden uncited clipping; the migration's dry run is the way to find one.

## 0.52.0 — 2026-10-20

- Sort the content lint's quote findings into tiers instead of one undifferentiated "unverifiable" list. After the strict verbatim check, each remaining quote is **convention** (the evidence has the same words in the same order; markdown links and escapes, punctuation, ligatures, HTML tags or extraction-split words such as "ensur ing" differ; counted, listed with `--tier=convention`), **gapped** (every quoted word occurs in order in one evidence document with extra evidence words between them, which are printed so a reader can tell a running header, timestamp or citation from a silent omission) or **unverified** (everything else). Output leads with the counts. Add `--json` (`{tiers, findings, style}`, untruncated quotes), `--tier=<convention|gapped|unverified|all>`, `--page=<substr>` and `--full`. `checkQuotes` keeps its contract (every quote the verbatim check cannot place, as `{page, quote, checked}`) so `repair-quote-provenance` is unchanged; `classifyQuotes` is the tiered form. Matching is in `scripts/lib/quote-match.mjs`.
- What can never pass as convention or gapped: a substituted, added or reordered word; and, in a gap, a negator (not, no, never, a dropped n't such as "don t"), or a comparison, operator, `%` or currency symbol, or a minus sign. `tokenize` keeps `< > = + × ÷ ± ≤ ≥ ≠ % $ € £` and a dash directly before a digit as tokens, so "a < b" against "a > b", "3 × 4" against "3 + 4" and "40%" against "40" stay unverified; a true minus (U+2212) matches the capture's hyphen. A capture that garbles a symbol (÷ read as ˜) therefore lands in a higher tier. Gap bounds: a run of at most 12 extra words; at most 2 in a quote under 12 words, otherwise a quarter of its length up to 20. They were chosen by re-scoring the 1,954 quotes the verbatim check could not place with unlimited bounds and sampling each band: above these limits short quotes were being scattered over long holes ("technically halt the [8 words] progression of game time").
- A sentence saying the quoted text is not in the source ("not in the clipped source", "not in the captured source", "nowhere in the vault") now exempts its quote, like "unsourced" always did. On the live vault that removed 3 quotes.
- Live vault, read-only, 30,755 quotes examined, 27,854 verbatim. The 0.51.0 lint reported 2,904 unverifiable quotes on the same vault state; 0.52.0 reports 915 convention, 287 gapped and 1,699 unverified (2,901 in all). Runtime is unchanged (57s against 59s, dominated by the graph build) and the lint still completes under a 1.5 GB heap, as 0.51.0 does. Checked: all 915 convention findings were re-tested with an independent space-free letters-and-digits comparison (911 pass; the other 4 show an exact contiguous word match in the matcher's view of the evidence and fail only because that check over-strips code-like text), 16 were read against the raw clipping, and no changed word was found; all 287 gapped findings pass an independent in-order check, 24 were read against the raw clipping and each inserted run was what the finding said; 20 unverified were read: 12 were not found in the page's evidence (its own wording, mention quotes or paraphrase), 4 differed in a word ("with" for "that have", `stopped state` for `DeviceSessionState.stopped`, "we" for "but") or were joined across a dropped bullet of figures, 2 were verbatim except for text a two-column capture interleaved, 1 was verbatim but its citation resolves to the wrong clipping, and 1 (a true minus sign against the capture's hyphen) was a false unverified that this release fixes.
- Known limits. The unverified tier is still large and mixed; it is a worklist, not a list of errors. Two-column PDF captures that interleave text inside a sentence exceed the gap bound and stay unverified. Matching is by token, so a gapped quote whose omitted words reverse the claim without containing a negator or symbol is reported, not caught: read the inserted words. A quote only verifies against the page's own evidence trail, so a misresolved citation (before 0.51.1, an ambiguous `[[raw/clippings/Build.md]]` landing on `build.md.md`) shows up here as unverified.

## 0.51.1 — 2026-10-20

- Fix a link that names an existing file exactly, path and extension, being treated as ambiguous with — or silently resolved to — a different file. The `Name.md.md` convention makes the extension-stripped path of `raw/clippings/build.md.md` spell `raw/clippings/build.md`, which is also the full path of `raw/clippings/Build.md`. `health` reported `[[raw/clippings/Build.md]]` as an `ambiguous-link` between the two, and `resolveLinkTarget` returned the `.md.md` file, so the citation and its backlink were credited to the wrong clipping. A file matched exactly by path and extension (letter case ignored) now wins in both `integrity.mjs` and `graph.mjs`, regardless of the order the vault walk visits them.
- The convention is unchanged: `[[path/X.md]]` still resolves to `path/X.md.md` when no file `X.md` exists, and genuinely ambiguous bare names stay ambiguous. Live vault, read-only: 241 → 225 open defects. The 16 resolved issue IDs are all `ambiguous-link raw/clippings/Build.md`; no new issue appeared and all 715 unresolved-navigation entries are unchanged.
- Not changed: `relationships.mjs` and `identity-audit.mjs` register the same two keys per content page, so such a pair would be skipped from relationship suggestions or listed as an identity collision. That is conservative, never a wrong resolution, and the live vault holds no such content pair.

## 0.51.0 — 2026-10-20

- Fix triage re-clips bypassing current PDF extraction policy: explicit requests are no longer skipped because characters look clean; table-aware/flattened captures can be selected explicitly. Repairs honor shared mode planning and fidelity floors, retain unrelated metadata and propagate summary hashes without advancing factual review dates. Reconstructed tables still require row verification. Cooperating repair sessions are serialized; interrupted metadata/hash updates retain a journal and recheck citation membership before completing.
- Add dry-run selectors, exact targets/ownership ledgers, per-batch mode overrides and an explicit terminal `--on-failure quarantine` policy. Failed repairs can preserve the old raw body, record a tracked do-not-cite restriction and close triage instead of repeatedly reopening an unfixable source. The default failure policy remains reopen.
- Quarantined captures stay out of fidelity/failure/backlog triage across machines, including stale local issue history. Directly matched citing pages are restricted; operators must inspect indirect citations and derived claims. Quarantine is not a fidelity pass or successful ingest. See `docs/reclipping.md` for the reviewed-table workflow and operational limits.

## 0.50.1 — 2026-10-20

- Preserve GitHub REST reference endpoint sections: Defuddle's exact `.gutter` cleanup rule was deleting the layout columns containing parameters and examples. Recognized reference layouts now follow the existing documentation-preservation path. Browser rendering is unnecessary for the reproduced pages because their endpoint bodies are present in served HTML.
- Retain parameter-table captions and method/path summaries, and convert supplied request/response examples into fenced code blocks without losing their original line breaks. Extend fidelity diagnostics to whole normalized parameter rows and endpoint summaries, plus literal code examples, so retained headings cannot mask their loss.
- Add offline artifacts/workflow-runs fixtures. Full-page checks retain 24 endpoint sections, all 59 supplied visible examples exactly, and all 450 examined structural items. Alternate language/schema tabs absent from supplied visible HTML remain outside the guarantee. Existing raw clippings are unchanged; see `docs/clipping-fidelity.md`.

## 0.50.0 — 2026-10-19

- Preserve technical-documentation content before readability cleanup: linked API identifiers, introductions and extension lists outside article containers, GitHub availability/warning boxes, and technical admonitions. Static and browser-rendered pages share the same owned extractor; rendered relative links retain the source URL.
- Compare recognized source structures with extracted Markdown. Missing text probes save `fidelity: partial` and queue actionable fidelity triage, while `fidelity-checks` records how many items were examined. This bounded check cannot prove completeness or detect sections absent from supplied HTML. Existing raw captures are unchanged.
- Pin the extraction runtime (Defuddle 0.19.5, linkedom 0.18.12, Turndown 7.2.0), retaining upstream fetch limits, charset/proxy handling and bot retry. CI installs the locked runtime. Offline fixtures reproduce four affected official documentation pages; full-page checks retained all 138 examined structural items. Details and limits: `docs/clipping-fidelity.md`.

## 0.49.0 — 2026-10-19

- Add `refresh-catalogs.mjs --project <slug> [--apply]`: one shared graph scan for selected project backlog and MOC catalogs plus the global index. Standalone project generators also accept `--project`; their all-project default is preserved. All three generators skip byte-identical writes, preserving timestamps and avoiding false freshness churn. The batch reports exact changed paths and elapsed/graph times.
- With `--paths-file <JSON ownership ledger>`, exclude other sessions' untracked additions from the shared snapshot while retaining all tracked pages. Cross-project ambiguity remains vault-wide within that snapshot; newly generated pages are included before rendering the global index.
- Live read-only measurement: separate calls 37,205ms versus one batched refresh 10,473ms (one graph build, 10,438ms; 22,043 graph nodes including attachments and raw evidence). This is one warm-machine comparison, not a fixed latency guarantee. The previously reported 90-second index pass remains a separate observation under different conditions.

## 0.48.0 — 2026-10-19

- Fix `op-commit` reporting success when git failed. A held `.git/index.lock` (or a rejecting hook) made `git add` or `git commit` fail; `commitPaths` returned the reason but `op-commit` read it as an empty delta, printed "made no changes", deleted the operation token and exited 0 while the operation's files sat uncommitted. It was observed twice (2026-10-13 and 2026-10-14). A git failure now returns `failed: true`, `op-commit` exits 1, keeps the token, and the same command can be retried once the cause clears.
- Add `scripts/wiki-sync.mjs`: the plugin now owns the vault's git, including moving commits between the machines that share it. It fetches, rebases onto the upstream (never a merge commit), pushes, retries once when another machine pushed first, and verifies against a fresh fetch. A conflict aborts the rebase, exits 1 and names the files, with the local commits intact; an uncommitted edit that overlaps incoming changes stops before anything is touched. It never forces or resolves a conflict. `--commit-local` first commits hand edits made outside any operation in one scoped `sync:` commit (never `git add -A`), and refuses while an operation is open because dirty files cannot then be attributed.
- Obsidian Git's auto-commit is no longer a supported part of the design. Its `autoSaveInterval`, `autoBackupAfterFileChange` and `autoPushInterval` commit half-finished operation edits under "vault backup", which leaves `op-commit` an empty delta, and with up to three machines sharing one remote they multiply the writers. `wiki-sync` warns when they are on and says which to turn off; auto-pull may stay. This reverses the 0.9.0 decision to leave the plugin's timer on as a safety net for hand edits; `--commit-local` replaces that role.
- Add `scripts/op-cleanup.mjs`: removes abandoned operation tokens. Nothing but a token's own `op-commit` ever deleted one, so a crashed session (or, now, a failed close that keeps its token) left it forever; the live vault had twelve, the oldest from 2026-09-06. Tokens older than 24 hours count as abandoned. It is a dry run unless `--apply --token <id>` names confirmed-abandoned operations, `--hours <n>` moves the cut-off but never below one hour, and `wiki-sync` reports old tokens but keeps them blocking `--commit-local` until explicitly cleaned up. Named cleanup, not purge, because `wiki-purge` already means deleting topics.
- The shared operations contract (step 7) now says to sync with `wiki-sync` instead of a bare `git push`, and `op-commit`'s unpushed hint names it.
- Verified with real git: a bare remote and clones standing in for machines, 29 tests for sync, 10 for token cleanup and 3 for the failed-commit cases. Every guard was mutated and each mutant is caught. Not covered: conflicts in the generated catalogs (`index.md`, backlog and MOC fences) are reported, not auto-regenerated.

## 0.47.0 — 2026-10-19

- Fix hybrid search ranking worse than keyword-only on exact-string queries. The semantic list returns topical neighbours of an identifier or phrase, and the final fusion let them displace the pages that hold the string. A temporary weight on the semantic list showed no constant fixes it: weight 0 gave 0.937 page recall@10 on the keyword-engine set but 0.813 on the 40-question set (paraphrase 0.375), and only weight 1 held that set's guard. `exactMatchGate` decides per query instead: when 1 to 3 of the validated candidate pages hold the whole query as written, or a query of at most 5 terms has 1 to 3 pages holding every term in one paragraph, the semantic list gets no vote in the final order. It still admits candidates and the tier is unchanged. `--json` results report the decision as `semanticGate: { reason, pages }` (`null` when it did not apply).
- Measured on the live vault (7,883 pages), page recall@10 before -> after: keyword-engine set in hybrid 0.722 -> 0.937 (identifier 0.762 -> 0.881, conjunction 0.762 -> 0.929, phrase 0.643 -> 1.000), equal to keyword-only. The 40-question set held: recall 0.938 -> 0.938, precision@3 0.342 -> 0.342, reciprocal rank 0.835 -> 0.823 (guard 0.809). Two runs matched on every question; results are flat for a page limit of 3 to 5 and a term limit of 3 to 6. The limits were chosen on these two sets, so treat them as measured, not proven. See `eval/keyword-engine.baseline.json` and `docs/wiki-efficacy.md`.

## 0.46.0 — 2026-10-19

- Fix the final search ranking discarding the keyword engine's order. `main()` used the engine only to admit candidates and then ranked them by `lexicalScore` (whole words, alphabetical tie-break), so an identifier such as `import_scene` or an exact three-word phrase lost to pages that merely contained the same words. The engine's rank is now a third list in the final reciprocal-rank fusion (`moc/` and `wiki/` lists vote as equals), and pages with equal lexical scores share one rank so the alphabet no longer votes. `mergeRRF` accepts `{ path, rank }` entries and `tiedRanks` is exported.
- Measured on the live vault (7,883 pages) with the 0.45.0 keyword-engine set, page recall@10 before -> after: keyword-only 0.437 -> 0.937 and hybrid 0.399 -> 0.722 (identifier 0.452 -> 0.881 and phrase 0.071 -> 1.000 keyword-only). Adding the engine list alone gave 0.847 and 0.611; the shared tie ranks gave the rest. The general 40-question set held: recall@10 0.9375 -> 0.938, precision@3 0.325 -> 0.342, reciprocal rank 0.809 -> 0.835. Two runs matched on every question. Hybrid still trails keyword-only on exact-string queries; the semantic list is untouched and is a separate question. Numbers are in `eval/keyword-engine.baseline.json`.

## 0.45.0 — 2026-10-19

- Add a keyword-engine evaluation set, `eval/keyword-engine.questions.json`: 42 questions (14 each of rare identifier, three-term conjunction and three-word phrase) whose ground truth is every vault page containing the string, by exact substring match, so only a keyword channel can answer them. `scripts/build-keyword-eval.mjs` generates it from a seed (rare identifiers must be absent from every title, alias and filename; each bound is tested, and the tests were mutation-checked). `scripts/evaluate-retrieval.mjs --keyword-only` builds the search context with the semantic service switched off to measure the keyword channel on its own, and reports the setting under `configuration`.
- First baseline (plugin 0.44.1, live vault): page recall@10 is 0.437 keyword-only and 0.399 hybrid, against 0.056 and 0.224 with no keyword channel, so the questions do need it. The filesystem engine ranks an expected page first for all 42 questions, but `main()`'s final `lexicalScore` ranking drops many from the top ten (7 of 14 identifier, 11 of 14 conjunction and 1 of 14 phrase questions survive), which makes the set a measure of the pipeline's ranking rather than of the engine alone. The filesystem and Obsidian engines differ on one question each way. See `docs/wiki-efficacy.md` and `eval/keyword-engine.baseline.json`. No search behavior changed in this release.

## 0.44.1 — 2026-10-18

- Fix the triage UI server dying on startup when its randomly chosen port is refused by the OS. The server picks a port in 49152-65534 and moved to another only on `EADDRINUSE`; on Windows about 4% of that range fails to bind with `EACCES` (reserved ranges and ports held exclusively; 716 of 16,383 ports on the measured machine), so roughly one launch in 25 exited with `listen-failed`. 300 real boots with default port selection failed 9 times, every one `listen EACCES`; after the fix, 300 of 300 started. The bind-and-fallback logic now lives in `scripts/triage-ui/listen.cjs` and treats `EADDRINUSE` and `EACCES` as "pick another port" (up to 10 moves); any other listen error still fails at once.
- This was also the cause of the intermittent `triage-auth` and `triage-server-handoff` test failures on Windows, which failed about 60% of local runs with `server never wrote server-info` and none of 25 runs after the fix. The failures were unexplained because the test discarded the server's stderr; `boot()` now includes the server's exit state and stderr in its error. Linux CI was never affected.

## 0.44.0 — 2026-10-18

- Report per-channel search health. `search.mjs` results now carry `channels`: `keyword.{wiki,moc,raw}` (`ok` or `failed`, `raw` only when requested), `semantic` (`ok`, `failed`, `ollama-unavailable` or `index-unavailable`) and `identity` (`ok` or `incomplete`). The tier follows the primary `wiki/` keyword scope: a working `moc/` or `raw/` scan no longer lets a search whose `wiki/` scan failed be labelled `hybrid`. The status line names the failed scopes, for example `keyword request failed (wiki, moc)`.
- A failed `--include-raw` scan is now reported as `raw/ clippings NOT searched` instead of `0 hits`, and `rawCount` is omitted from the result, so a failure can no longer read as evidence of absence.
- `purge` decides whether an empty search result can be trusted from the search's own `channels` (a failed `wiki/` keyword scan refuses it) instead of probing whether the Obsidian app is running, since search no longer uses Obsidian. `collectSeeds` is unchanged; `searchSeeds` additionally returns the failure. The `assertRunning` injection point on `purge.main` is removed.
- Remove the legacy `search()` tier ladder and the synchronous Obsidian `keywordSearch` from `search.mjs`, with their tests. Neither had a production caller after 0.43.0; `main()` is the only search entry point.

## 0.43.0 — 2026-10-18

- Replace Obsidian full-text search with a direct file scan as `search.mjs`'s keyword channel (`scripts/lib/fs-keyword.mjs`). Obsidian took 29s on a cold `wiki/` call, never finished `raw/` (242 MB) in 90s, and returned a capped list in no relevance order. The scan reads the Markdown files with 16 concurrent reads, needs no running app, goes through no CLI gate and is never stale: about 0.7s for `wiki/` (7,785 files, 53 MB), 10ms for `moc/`, 1.6s for `raw/`. Candidates rank by exact phrase, then all query terms, then partial matches, then terms in the path, then a capped occurrence count. `--include-raw` now works (about 8s end to end on the live vault).
- `search.mjs` makes one keyword call per scope (`wiki`, `moc`, plus `raw` with `--include-raw`) instead of the 0.42.0 AND-then-OR pair. A scope that fails is reported as `keyword-failed` with its scope; a scan past its 30s deadline fails loudly instead of returning a partial list. `moc/` is always searched, so the 0.42.0 `--include-moc` flag is retired; it is still accepted and ignored. Removed `boundedKeywordSearch` and `KEYWORD_TIMEOUT_MS` (the 0.42.1 bound only existed for Obsidian); `purge` seed collection benefits automatically.
- Measured on the live 40-question set against 0.42.1: page recall@10 (0.9375), precision@3 (0.325) and reciprocal rank (0.809) are identical with no per-question difference, all 40 questions run `hybrid`, mean latency per question fell from 8.7s to 2.0s and keyword failures from 1 to 0. Identical metrics show no regression, not a ranking gain: exact identity and the semantic index dominate this set.
- Not changed: the legacy synchronous `keywordSearch` and `search()` ladder still use the Obsidian CLI, and `purge` still probes Obsidian after an empty result.

## 0.42.1 — 2026-10-18

- Fix cold-start timeouts in `search.mjs` keyword search. The first full-text `wiki/` call after a quiet period took 29s on the live vault (later calls 0.1-0.3s), but the 10s kill never let it finish, so Obsidian stayed cold and the keyword channel failed again on the next query. Keyword calls now use a 45s execution timeout (`KEYWORD_TIMEOUT_MS`, overridable per call) and the same gate wait, so a second process queued behind a cold call waits instead of failing as busy. The global 10s default for other CLI callers is unchanged. The search is read-only and still never retried. `--include-raw` is still too slow through Obsidian (`raw/` was 242 MB and did not finish in 90s); it will now wait up to 45s and then report `keyword-failed` for the `raw` scope.

## 0.42.0 — 2026-10-18

- Fix `search.mjs` Obsidian keyword timeouts. Search fired up to five full-text CLI calls at once; the transport guard serialized them, so one slow call (a cold `wiki/` search measured 29s against the 10s limit; `raw/` did not finish in 90s) became one timeout plus several "CLI busy" failures and an empty keyword channel. Keyword calls now run one at a time. The query as typed runs first, and the `OR` rewrite of its terms runs only when that returned fewer than `--limit` hits and did not fail. A failed call is reported as `keyword-failed` and skips the rewrite for that scope.
- Add `--include-moc`. `moc/` is no longer a default Obsidian keyword scope; MOC pages are still found by name and by the semantic index. Pass `--include-moc` to also run the keyword search over `moc/`. `evaluate-retrieval` accepts `includeMoc` in question options.
- Measured on the live vault with the 40-question set (`eval/wiki-efficacy.questions.json`): page recall@10 0.9375, precision@3 0.333 and reciprocal rank 0.811 are identical before and after; `keyword-failed` diagnostics fell from 61 to 16 across the 40 questions. One question still lost its keyword channel to the unchanged 10s timeout on a cold `wiki/` call.
- Not changed: the 10s default CLI timeout, so a cold first search can still time out, and `--include-raw`, which stays slow through Obsidian.

## 0.41.1 — 2026-10-12

- Add optional `op-commit --paths-file <JSON>` for an exact vault-relative file ledger. It narrows the operation’s newly dirty delta, preserving files dirty at opening and excluding other writers’ new changes even when staged. Invalid or unreadable scopes leave the token retryable. Unscoped behavior is unchanged; this does not isolate concurrent edits to the same file.

## 0.41.0 — 2026-10-08

- Allow Reddit discussions and Medium articles through the source-domain filter. Keep their claims, quotes and dependent inferences in separate `Reddit discussion (anecdotal)` and `Medium articles` sections in discovery reports, derived wiki pages and query answers, including when reusing existing summaries. Independently supported facts remain in the main sections with their higher-quality citations. Source credibility is still assessed individually; raw captures remain unchanged.
- A live Reddit capture recovered a post and four comments with individual permalinks through the existing clipper. Complete-thread coverage is not guaranteed; this release adds no dedicated Reddit or Medium extractor.

## 0.40.0 — 2026-10-08

- Add `clip-pdf --figures[=auto|all|<pages>]` to keep the figures that text extraction loses. It renders whole pages at 200 dpi with poppler `pdftoppm` into `raw/figures/<clipping>-p<N>.png` with a `.md` sidecar (`source`, `page`, `crop: full`, `dpi`, `sha256`, `captured`, `clipping`). `auto` selects pages with embedded rasters (`pdfimages -list`, ignoring masks, icons and repeated logos) or vector drawing (`pdftocairo -svg` element counts against text density), because most PDF graphs are vector and invisible to `pdfimages`. Capped at 40 pages (`--figures-max`). Pages are not cropped; the heuristic is approximate (ruled tables can be false positives, sparse diagrams can be missed).
- Add `clip-pdf --figures-only --clipping <path>` to render figures for an existing clipping from a PDF you supply, verifying it by re-extracting the text and comparing `source-hash` (refusing a mismatch unless `--allow-pdf-mismatch`). Only the clipping's frontmatter `figures:` list is written; bodies stay immutable. Rendering is idempotent, de-duplicates against existing figure hashes and never overwrites a hand-cropped figure.
- Treat `raw/figures/` as assets in health, repair-missing-hash, dedupe, backfill and quote-provenance scans, so figure sidecars no longer read as clippings missing a `source-hash` or as ingest backlog. `wiki-ingest` now tells the ingester to look at listed figures and embed them on source pages.
- Poppler tools are found on PATH or in the winget package folder; missing tools produce a non-fatal message, and `--doctor` reports them.

## 0.39.0 — 2026-09-13

- Make the default wiki health metric an uncapped count of actionable integrity defects. Intentional links to unwritten pages remain separate and unscored, regardless of age or fuzzy name matches. Preserve the historical report behind `--legacy` and ingest reporting behind `--backlog`.
- Add a JSON worklist with stable issue IDs, locations, evidence and verification conditions for malformed wikilinks, ambiguous targets, unresolved citations and missing evidence routes. Structural integrity does not establish factual truth or check external URLs, Markdown-style links, anchors or historical moves/deletions.
- Add `wiki-repair` for scoped, evidence-supported repairs and before/after issue comparison. Keep read-only health, relationship development and factual review in their respective skills. Purge now explicitly saves and compares the legacy broken-link count.
- Add scanner regression coverage and preserve a Yoda audit of all 21 skills with four paired execution cases. Both conditions completed all four correctly; the observed skill benefit was lifecycle discipline and reporting, not greater repair accuracy.

## 0.38.0 — 2026-09-11

- Add the `clip-xlsx` skill so the bundled spreadsheet clipper can be triggered. `scripts/clip-xlsx.mjs` shipped and was tested but had no skill, leaving the capability reachable only from inside `wiki-discover`. A contract test now requires every document-format clipper to have a skill.
- Load shared references conditionally in twelve spoke skills instead of unconditionally, cutting cold-start instruction load by roughly a third on the heaviest workflows. `wiki-stale` is deliberately unchanged to preserve the evidence inspection corrected in 0.36.0.
- Add a five-scenario coverage evaluation for the spreadsheet clip path, purge, triage, query and relink — twelve skills previously had no paired-run evidence, including the one irreversible skill. Record four independently graded runs with their failures preserved.
- List the user-invocable clip family, `/wiki-discover` and `/wiki-triage` in the README skill table, which previously documented ten of twenty skills.

## 0.37.0 — 2026-09-08

Reconstructed from the release's own artifacts: `docs/cli-transport-guards.md`, its design and plan under `docs/superpowers/`, `eval/cli-safeguards/`, and the commit contents. The release shipped without a changelog entry.

- Guard the Obsidian CLI transport across agent sessions. Reject physical CR/LF, NUL and estimated JSON request envelopes over 2,048 UTF-8 bytes before launch, with diagnostics that name the command and size without echoing the body. This is a conservative policy, not a measured Obsidian wire limit, and it does not repair the app parser that motivated it.
- Serialize cooperating callers for the same OS user across processes, vaults, plugin versions and worktrees — a named pipe on Windows, an abstract socket on Linux, a deterministic reserved loopback port elsewhere. An unrelated listener fails closed; no lock file, service or stale-lock stealing is involved.
- Bound the gate wait at 10 seconds by default, separately from the CLI's own execution timeout, and hold it until the child closes. No command is retried automatically: `CLI_REQUEST`, `CLI_BUSY` and `CLI_LOCK` mean the request was not sent, and a timeout leaves a mutation's outcome unknown until the exact target is inspected.
- Route app commands through the bundled `scripts/obsidian.mjs` proxy and `guardedExecFile()` in the new `scripts/lib/cli-transport.mjs`; prefer exact-path filesystem edits for ordinary Markdown even when the app responds. Raw `obsidian` calls and older plugin copies bypass the guard.
- Add transport tests using fake child processes, and paired skill probes in `eval/cli-safeguards/` measuring simulated intended actions rather than executed production reliability.

## 0.36.0 — 2026-09-08

- Bound Obsidian calls and fall back to known-vault Markdown metadata for freshness reports when the app is unavailable; preserve missing factual reviews and disclose the backend.
- Share mutation completion and authorized sync rules across skills, recover uncertain writes by inspecting their target, and preserve read-only workflows.
- Reduce the maintainer core from 444 to 76 lines with focused policy references; clarify triggers and workflow boundaries across all 19 skills.
- Add independently graded behavioral scenarios, portable lifecycle fixtures and regression tests. Correct the evidence-inspection omission found in the freshness probe; preserve failed runs and evaluation limits.

## 0.35.0 — 2026-09-08

- Improve agent retrieval with canonical title/alias ranking, indexed task maps, filters, bounded passages and explicit backend/index diagnostics.
- Add read-only identity and relationship audits and a 40-question retrieval evaluation with development and held-out reports.
- Separate citation routes from Related navigation, share frontmatter parsing, and preserve factual review dates across mechanical edits.
- Make drift coverage explicit and sample long documents within embedding limits; add concept/task-map templates and gap-driven maintenance workflows.

## 0.34.2 — 2026-09-06

### Fix: a session parameter let one article into the vault twice

`isDuplicateUrl` is a **pre-fetch** gate, so it never sees content hashes — it
compares URLs. Replaying the failed-clip queue put unrealengine.com's MetaHuman
article in `raw/` as two clippings with an *identical* `source-hash`, under URLs
differing only by `?sessionInvalidated=true`.

`normalizeUrl` now strips a named list of session and ad/analytics parameters
before comparing. It still never drops the query itself: that regression is
already on the record in this file's own comment — an earlier version collapsed
every `news.ycombinator.com/item?id=X` to one string and discarded genuinely
different articles as false duplicates.

The list is evidence-led rather than guessed. Across the reference vault's 2,341
clippings only 47 URLs carry a query at all, and their parameters are
`id`(26) `v`(6) `lang`(4) `hl`(2) `key`(2) `fmt`(2) `moc`(1)
`sessionInvalidated`(1) `inline`(1) `p`(1) `pid`(1) `c`(1) `download`(1) —
exactly one session artifact, everything else load-bearing.

**`lang` and `hl` are deliberately not stripped.** They look like presentation,
but a translated page is different content: this vault pins Defuddle to
`--lang en` precisely because a silently translated clipping is worse than a
failed one. Folding them together would let a Japanese page satisfy the dedup
gate for an English one nobody clipped.

### Fix: web-archive banners were being clipped as if the source had written them

Wayback and Archive-It inject their own banner above the page they serve, and
Defuddle has no reason to know it is not the article. Three clippings in the
reference vault open with one, so anything quoting their first paragraph would
attribute archival boilerplate to the source. This vault leans on archives
heavily — 9 `web.archive.org` and 2 `wayback.archive-it.org` URLs in a single
triage queue — so it recurs rather than being a one-off.

The banner is now stripped **before** the content is measured or hashed, which
matters twice over: the thin-content floor must judge the article rather than
the banner, and the `source-hash` must describe what the vault will actually
quote. One clipping had reached 385 words on banner plus terms-of-use text and
sailed straight past a 100-word gate that exists to reject pages with no article
in them.

Stripping is anchored to the **start** of the document. A banner is only ever
injected at the top, while an article *about* link rot may quote the same
sentence in its body — matching content anywhere would silently edit the source.
An ordinary clipping is returned byte-identical.

### Fix: a PDF URL failed cryptically instead of naming the clipper that handles it

`arxiv.org/pdf/2404.03337` (confirmed `application/pdf`) went through the entire
ladder — four Defuddle attempts, then a full browser launch — to arrive at
`rendered, but extraction failed: Command failed: npx --yes defuddle parse …`,
which names neither the cause nor the cure. The vault already holds eight arxiv
PDFs that `clip-pdf` extracted correctly; nothing was pointing anyone at it.

The failure path now recognises a PDF URL and stops there, queuing an
`attention` row that names `clip-pdf` and the exact command. Recognition is by
URL shape — a `.pdf` extension, or a `/pdf/` path *segment*, which is how every
arxiv PDF in `raw/` is addressed (no extension at all). Judging from the URL
keeps `main()` synchronous and spends no request on the ordinary pages that are
the other 99% of clips; it is consulted only after the HTML ladder has already
failed, so a false positive costs nothing real.

## 0.34.1 — 2026-09-05

### Fix: the triage queue could only ever grow — a successful clip never closed the row it answered

`clip.mjs` records an issue on every failure and nothing at all on success, so a
source that finally arrives leaves its old row standing forever. Worse, a retry's
new, specific diagnosis is appended *beside* the stale blanket one rather than
replacing it, so working the queue makes it louder.

Measured while replaying this vault's 54 open `failed` rows through the
browser-render rung added in 0.33.0: **20 clipped and 9 turned out to be already
in the vault, yet `failed` stayed at 54** and total open issues went 65 → 74. 29
of the 54 rows described sources sitting on disk. A queue that cannot drain is
one people stop reading, which costs far more than the rows themselves.

A successful clip — and a `duplicate`, which is the same fact discovered a
different way — now closes any open row for that URL whose kind means *we could
not get this content*: `failed`, `thin`, `wrong-node`, `blocked`, `gone`.

`attention` and `fidelity` are deliberately excluded. `attention` means a human
wants to decide something about the link, and arriving at the content does not
make that decision; closing it would delete somebody's todo. `fidelity` is a
claim about how far an already-clipped extraction can be trusted, which a fresh
clip of the same URL does not settle either.

The disposition records *how* the row was resolved, so "closed because a clip
landed" stays distinguishable from "closed because a human said ignore" — the
log is events, not state. Closing nothing writes nothing, so an ordinary clip of
a never-queued URL does not grow the log.

## 0.34.0 — 2026-09-05

### Feat: `clip-docx --allow-short`, so a genuinely short document is not lost to the thin-content floor

`clip-docx` declines any extraction under 100 words as thin and records a
decline for it. That floor exists to catch an extraction that **failed** — a
corrupt, image-only, or password-protected document pandoc turned into almost
nothing — and it does that job well.

What it cannot do is tell a failed extraction apart from a document that is
genuinely short, because word count is the only signal it has. A one-page
classroom handout is complete at 40 words: a bare list of case names, a blank
analysis worksheet, a vocabulary sheet. All of them declined.

**Reported from real use**: clipping a teacher's Canvas course export, five of
fifteen artifacts were declined — including the single most load-bearing one,
a required-reading list whose contents were the entire reason for the clip. The
decline is persisted, so a batch re-run skips them silently and the material
never reaches the vault at all. The failure is quiet in exactly the way that
matters: the run reports success on the other ten.

**Why a flag and not a lower floor.** Lowering `THIN_WORD_FLOOR` globally would
trade one silent failure for another — empty extractions would start landing in
`raw/` looking like real sources. `--allow-short` is opt-in per clip: the human
asserting they opened the file and it is short on purpose. Every clip that does
not pass it keeps the full safety net.

The thin decision moves into an exported pure function,
`shouldDeclineAsThin(wordCount, { allowShort })`, with `parseAllowShort(argv)`
beside it — testable without touching the filesystem, matching how the rest of
this module is structured.

```bash
node scripts/clip-docx.mjs "handout.docx" --allow-short --quality=high
```

The decline message now names the flag, so the next person hitting this does not
have to read the source to find out why a complete document was refused.

## 0.33.0 — 2026-09-05

### Feature: browser-render rung recovers JavaScript-rendered pages the static clipper cannot see

Defuddle fetches HTML and parses it; it never runs JavaScript. Pages that build
their article client-side therefore have nothing to extract — `dev.epicgames.com`
returns 200 with ~30KB of Angular shell and **three words** of text — and pages
behind an anti-bot gate get an interstitial instead. Sampling 17 entries from
the reference vault's own `failed`/`thin` triage queue, that one blind spot
accounted for most of the queue.

`clip.mjs` now falls back to rendering the page in a real browser
(`scripts/lib/render.mjs` + `scripts/render-page.mjs`), then hands the rendered
DOM back to Defuddle so extraction, metadata and boilerplate removal stay
identical to every other clipping. The rung runs **only after the existing
static ladder has failed**, so healthy pages pay nothing; it costs ~2-4s when it
does run. Measured recovery on that sample: 8 of 17, including 3,190 words from
`tripo3d.ai`, 2,744 from `securitylabs.datadoghq.com` and 1,738 from
`unrealengine.com` — all previously filed as "fetch failed".

The non-obvious part, and the reason this is not simply "add a headless
browser": a **headless** browser fixes only half the class. Headless Chrome
still sat on Cloudflare's interstitial at 37 words and drew an outright 403 from
Epic; the same navigations headful returned the full articles. The browser is
therefore launched headful and parked offscreen, which keeps it out of the way
during a batch run. Playwright's bundled Chromium passed exactly where system
Chrome did, so it is the headful-ness that matters, not the build.

Requires `npm i -g playwright-core` and Chrome or Edge. Both are optional and
degrade gracefully: without them the rung is skipped, the unavailability is
reported once rather than per-URL, and pages queue for triage as before.

### Fix: rendering could file the wrong page under a source's URL

Rendering does not merely recover pages — it makes pages *succeed* that the
static ladder correctly refused, and some of those successes are a different
page. A stale Epic doc URL renders 443 words of fluent prose that is the
documentation index, not the requested article; `.../unreal-mcp-in-unreal-engine`
lands on `/documentation/403`, served as HTTP 200. Clipped unguarded, the vault
would cite the index as the article forever: wrong content wearing right
frontmatter, strictly worse than the failed fetch it replaced.

`classifyRenderOutcome` now judges the render **before** extraction is
attempted, comparing the final URL's last path segment against the requested
one. Whole-URL comparison was far too strict — `counterpointresearch.com` moves
`/insight/<slug>` to `/en/insights/<slug>` and that is still the article asked
for — so only a *replaced* slug is refused, alongside 404/410, error-page
destinations, and unsolved bot challenges.

### Fix: `failed` triage rows conflated five unrelated causes

Every Defuddle throw was recorded as `"fetch failed (likely
403/paywall/transient)"`. That bucket actually held dead links (404), soft
404/403 redirects served as HTTP 200, TLS chain failures, undici header-size
overflows, and genuine paywalls — indistinguishable to whoever had to triage
them. The render rung doubles as the diagnostic, supplying the HTTP status and
final URL, and issues are now filed with the specific cause. A new `gone` issue
kind separates dead sources from recoverable ones: `failed` means *try again*,
`gone` means *stop trying*.

### Fix: complete short reference pages were declined as SPA shells

`classifyShortExtraction` treated a page as a real article only when Defuddle's
HTML literally *began* with `<article>` or `<main>`. `registry.khronos.org`'s
`XR_EXT_hand_tracking` man page — 58 words under four headings, complete and
correct — begins with a heading, so it was declined for 180 days and queued for
a human. Section structure is now accepted as evidence too: an SPA shell is
short *because* it has no content, so it has no headings either
(`docs.mealie.io` extracts to the three words "Back to top" under none).

### Fix: a thin page was declined for 180 days even when the render rung never ran

The decline is justified by thin-ness being deterministic — re-fetching cannot
change the answer. That collapses when the browser rung was unavailable, where
the answer *would* have been different. Such pages now reach triage without
being cached as declined, so installing the optional dependency does not leave
recoverable sources buried behind a TTL.

## 0.32.1 — 2026-09-05

### Fix: Codex could not parse the shared hooks configuration

Replace the unsupported top-level `comment` field with `description` and
remove the unsupported `disabled` field from `hooks/hooks.json`. Keep hooks
disabled by default and preserve the optional Claude Code SessionStart health
check example in `hooks/README.md`.

## 0.32.0 — 2026-09-02

### Fix: generated catalogs (MOC, index, roadmap) wrote ambiguous bare wikilinks for names deliberately reused across projects

`docs/superpowers/specs/2026-08-11-authored-project-structure-v2-design.md`
§2 deliberately reuses bare canonical filenames — `overview.md`,
`architecture.md`, `roadmap.md` — one per `wiki/authored/` project, relying on
each project's own folder for uniqueness on disk. The design doc, and
`skills/wiki-maintainer`/`skills/wiki-author`'s own SKILL.md, are explicit
that any wikilink to one of these files must use the piped full-path form
(`[[wiki/authored/<project>/roadmap.md|<project> roadmap]]`) once a second
project acquires the same name, since a bare `[[roadmap]]` resolves to
exactly one global winner (`resolveLinkTarget`'s collision-prone bare-name
fallback) — every other same-named page across every other project is then
silently unreachable by that link, however many times it's written.

All three catalog generators — `moc-authored-gen.mjs` (per-project MOC),
`index-gen.mjs` (vault-wide index.md), and `backlog-gen.mjs` (per-project
roadmap.md, itemizing `backlog/*.md`) — wrote plain bare `- [[title]]` links
regardless, in direct violation of that documented contract. Live impact:
with 12+ acme-suite/gadget/adc sub-projects each carrying their own
`architecture.md`/`data-flow.md`/`roadmap.md`, only 1-of-12 same-named pages
ever received its intended inbound link from a generated MOC — the rest read
as orphans no matter how many project MOCs "linked" them.

`scripts/lib/graph.mjs` gains two shared helpers so the three generators can
never again drift out of sync on how they decide this: `findAmbiguousNames(pages)`
computes, vault-wide, which basenames collide among content pages (a
raw/clippings/ or log/ twin does not count — nav resolution already prefers
content for those); `wikilinkTarget(p, ambiguousNames)` returns the vault's own
piped full-path form for a colliding name and the plain bare title otherwise.
Each generator now computes `ambiguousNames` once from the FULL vault graph —
before filtering down to one project's or one kind's own pages — since a bare
name is exactly as ambiguous no matter which subset of pages happens to be
rendering it.

Adds 11 new tests across `test/graph.test.mjs`, `test/moc-authored-gen.test.mjs`,
`test/index-gen.test.mjs`, and `test/backlog-gen.test.mjs`, including
end-to-end regressions that build two real projects sharing a filename and
assert each project's regenerated catalog names its own file, not its
sibling's.

## 0.31.0 — 2026-09-01

### Feat: resolve-evidence.mjs — jump from a search hit straight to its raw/ evidence

A `wiki/` search hit is a synthesized page, not the evidence itself —
reaching the raw clipping it rests on meant manually opening the page,
reading its `sources:` frontmatter, and opening the linked file. The
mechanism to do this already existed in code (`evidencePaths()` in
`lib/graph.mjs`, used internally by `lint.mjs` and
`repair-quote-provenance.mjs`) but was never exposed as an on-demand,
single-page lookup.

New `scripts/resolve-evidence.mjs` closes that gap: pipe a `search.mjs` hit
straight in (`node scripts/search.mjs "topic" | node
scripts/resolve-evidence.mjs`), or pass explicit paths, and it prints the
real `raw/` evidence each one resolves to. Deliberately reuses
`evidencePaths()` rather than reimplementing the walk — a second,
subtly-different definition of "evidence" would be a real risk. Every
outcome mirrors an already-scored vocabulary from `computeGraphMetrics`
(`declaredNoProvenance`, `unreachableProvenance`) rather than inventing new
terms, and never guesses: a citation that doesn't actually reach `raw/` is
reported as `unreachable`, not silently omitted or invented; a page that
legitimately has no provenance (`wiki/authored/`'s `sources: []`) is
reported as `declared-no-provenance`, distinctly, since a deliberate
disclosure must not read like a defect. An already-`raw/` input (e.g. from
`--include-raw`) is reported as already being the evidence, not re-resolved.

Found and fixed one real bug during its own live smoke test: `readFileSync(0)`
for reading piped stdin hits a genuine Node.js `EAGAIN` race on macOS when
the other end of the pipe is a live Node process (exactly this tool's
primary documented use case, `search.mjs | resolve-evidence.mjs`) —
switched to async stdin iteration, which doesn't hit it.

Documented in both `skills/wiki-search/SKILL.md` (as a follow-up step after
a search) and `skills/wiki-query/SKILL.md` (to verify a citation actually
traces to real evidence before presenting it as fact).

Adds 15 new tests in `test/resolve-evidence.test.mjs`, mirroring
`test/evidence-trail.test.mjs`'s own fixture convention. Full suite
(excluding two pre-existing, unrelated flaky server-timing test files,
both confirmed passing 24/24 in isolation): 832 passing, 1 skipped, 0
failing. Live-tested against the real vault: a well-cited source page, an
authored page with no provenance, an already-raw input, a not-found path,
and the full `search.mjs --include-raw | resolve-evidence.mjs` pipeline
all resolved correctly.

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
  1,261-line, ~9,500-word `acme-migrator-roadmap.md` became 32 individual backlog-item files
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
  (comparing to acme-migrator's roadmap structure) converted to the explicit piped form.
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
