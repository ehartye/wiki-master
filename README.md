# wiki-master

A **Claude Code, GitHub Copilot CLI, and Codex** plugin that realizes Andrej Karpathy's
[LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
natively on Obsidian: the agent incrementally compiles and maintains a persistent,
densely interlinked markdown wiki over your curated sources.

- The **agent** (Claude Code, GitHub Copilot CLI, or Codex) is the synthesis engine.
- The **native `obsidian` CLI** provides app search, typed properties and versioning.
  Filesystem helpers share explicit identity and citation rules for audits and retrieval.
- A small Node helper layer does zero-LLM structural checks.
- One Ollama-backed script does semantic-drift detection.

No MCP server, no daemon, no vector database. Semantic search uses a chunk-level
index built from your own Ollama instance and ranks chunks by cosine similarity.

## Requirements

- A host agent: **Claude Code**, **GitHub Copilot CLI**, or **Codex** with plugin support.
  Each host loads the same skills and runs the bundled helpers independently.
- **Obsidian Git.** Obsidian Git handles all git operations. The vault is a git repository with
  an upstream, which you set up, and the plugin is enabled with `autoSaveInterval: 10`,
  `syncMethod: rebase`, `mergeStrategy: theirs`, `autoPullOnBoot: true`, `autoPushInterval: 0` and
  `autoPullInterval: 0`. `/wiki-setup` offers to install and configure it with
  `setup-obsidian-git.mjs`, and reports existing settings rather than overwriting them.
- **Obsidian** 1.12+, running with the vault open and restricted mode off, and its official command-line interface enabled
  (Settings → General → Command line interface). Required to finish authoring and for native app actions.
- **Ollama** ([ollama.com](https://ollama.com)), running with an embedding model (`ollama pull nomic-embed-text`).
  Required to finish authoring; it also powers semantic search and semantic-drift detection.
- Node.js ≥20.8 (for the helper scripts and Linux abstract-socket CLI gate).
- npm/npx for the pinned HTML clipping runtime; dependencies are acquired automatically on first use. See [capture fidelity and limits](docs/clipping-fidelity.md).
- Optional: Chrome or Edge, for the browser-render clip rung — clipping
  JavaScript-rendered pages that serve no article text to a plain fetch. Its
  pinned `playwright-core` is acquired through npx on first use. Degrades
  gracefully if absent; without it those pages are queued for triage exactly as
  before. Set `WIKI_MASTER_BROWSER` to point at a specific browser executable.

Every authoring task ends with `refresh-index.mjs`, which checks Obsidian Git, Obsidian, Ollama and the
repository first: if any falls short it names each failure with its fix, writes nothing and exits 1.
Reading and searching work without any of them; without Ollama, search falls back to keyword and identity matching.

To print a project's orientation from inside its repository, run `node scripts/session-brief.mjs` there. It finds the wiki project from a `repo:` line on the project's overview page (the repository's `origin` remote, in any spelling, or its folder name must match; `--project <slug>` names it directly). It reads the optional `reference/studio-state.md` page's current focus, relevant records, dependencies and recent decisions. Missing or unfilled orientation never prevents work; custom sections remain available in the source page. Historical phase/tier state pages, including `Last checkpoint review`, remain readable. Their gate annotations describe legacy records and impose no approval requirement. Artifacts with missing, invalid or future verification dates are unverified; only valid old dates count as stale after `--stale-days` days (default 30). Free-form orientation notes do not establish verification. Blocked backlog items are also listed when a state page exists. `--json` includes the detected schema, original record links and parsing warnings. No match, or more than one, exits 1 with how to bind; the command never writes.

For the agent procedure, use [capture prerequisites](skills/wiki-setup/references/capture-prerequisites.md). To see what the environment has and lacks, run `node scripts/doctor.mjs` (all commands) or `node scripts/doctor.mjs clip-docx clip-xlsx` (named commands; exit status 1 when a required program of one is missing). It lists, for each command, the programs and packages it needs, the path and version found, and how to fix what is missing; `--json` prints the same as one object. It starts each program once with its version flag, never the Obsidian CLI, and writes nothing. It also says when the copy it runs from is not the installed version.

## Install

The plugin ships its workflows as **skills** and shares the same `scripts/`
(Node) across all three hosts. Claude Code and Copilot CLI expose `/wiki-*`;
in Codex, select a skill or ask for it by name (for example, “use wiki-setup to report vault health”).

**Claude Code:**
```
/plugin marketplace add ehartye/wiki-master
/plugin install wiki-master
```

**GitHub Copilot CLI:**
```
copilot plugin marketplace add ehartye/wiki-master
copilot plugin install wiki-master@wiki-master-marketplace
```

Or run straight from a local clone on either host — e.g.
`copilot --plugin-dir /path/to/wiki-master`. (The marketplace forms require the
repo's default branch to carry `.github/plugin/marketplace.json` and
`.claude-plugin/marketplace.json`.)

**Codex:**

The Codex manifest is `.codex-plugin/plugin.json`. See [Codex setup](docs/codex.md)
for personal marketplace installation and host-specific usage. Keep the entire
plugin folder together: the skills use the sibling `scripts/` and `templates/`.

## Quick start

1. `/wiki-setup` — states the prerequisites, preflights existing content, scaffolds a new vault and prints one-time setup.
2. Make the vault a git repository with an upstream. Setup does not create either.
3. In Obsidian: **Open folder as vault** → the scaffolded path, then trust the vault and turn off
   restricted mode (Settings → Community plugins).
4. Verify: `node "<absolute-plugin-root>/scripts/obsidian.mjs" vaults` lists the vault.
5. Let `/wiki-setup` install and configure Obsidian Git, then run `refresh-index.mjs`, which builds the search index.
6. Import `templates/webclipper-template.json` into the Obsidian Web Clipper.
7. Ask `/wiki-researcher` to capture web pages (they land in `raw/clippings/`),
   then explicitly request ingestion to compile them into the wiki. Use
   `/wiki-search` to find pages or answer questions with citations.

Use the [guarded CLI caller](docs/cli-transport-guards.md) for app commands. It
serializes cooperating sessions and rejects oversized requests before launch.
Edit ordinary Markdown through the filesystem, and finish by the
[completion contract](skills/wiki-maintainer/references/operations.md): validate, log once, run `refresh-index.mjs`.

## Skills

Six skills separate retrieval, original documentation, setup and content operations. Select the matching skill or
ask naturally for its capability. In hosts that namespace plugin commands, use
the `wiki-master:` prefix, for example `/wiki-master:wiki-search`.

| Skill | Purpose |
|---|---|
| [`wiki-search`](skills/wiki-search/SKILL.md) | Find pages and passages, inspect raw evidence and provenance, or answer with citations. Strictly read-only. |
| [`wiki-project`](skills/wiki-project/SKILL.md) | Write original project documentation, architecture, decisions, guides, notes and backlog; list project work by lifecycle. |
| [`wiki-researcher`](skills/wiki-researcher/SKILL.md) | Discover external sources, capture named URLs or files, and ingest captured evidence. Includes PDF, Word, PowerPoint, spreadsheets, GitHub and authenticated Confluence capture. |
| [`wiki-maintainer`](skills/wiki-maintainer/SKILL.md) | Repair content and citations, connect concepts, apply triage decisions, file authorized derived syntheses and perform requested native app actions. |
| [`wiki-setup`](skills/wiki-setup/SKILL.md) | Initialize safely; install and configure Obsidian Git; check prerequisites, health, freshness and lint; validate paths; diagnose failures and recover from an unfinished setup or refresh. |
| [`wiki-purge`](skills/wiki-purge/SKILL.md) | Plan, approve and apply recoverable removal, reconcile an interrupted purge, or restore it. |

Search and unfiled answers are read-only. Capture-only does not authorize source
summaries or concepts. Ask explicitly to ingest named clippings or process new
clippings; an empty eligible backlog performs no writes. A backlog count belongs
to setup reporting. An ambiguous researcher invocation does not ingest all.
See the [old-to-new workflow mapping](docs/skill-migration.md) for retired entry points;
there are no forwarding aliases.

## Long-term wiki efficacy

See [retrieval, identity, relationships and verification](docs/wiki-efficacy.md) for rich agent search, read-only audits, task-map workflows and the 40-question retrieval evaluation.

See [skill reliability](docs/skill-reliability.md) for bounded CLI fallback, shared completion rules and the behavioral regression suite.

## Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `WIKI_MASTER_VAULT` | `~/.wiki-master-vault` | Vault path (also the CLI target and embedding-cache home). |
| `WIKI_MASTER_VAULT_NAME` | vault folder basename | The registered Obsidian vault name the CLI targets. |
| `WIKI_MASTER_REQUIRE_VAULT` | unset | Set to `1` and a script with no `WIKI_MASTER_VAULT` stops with exit 2 and one line instead of acting on the default vault. Set it in any session that must not touch the real vault. |
| `WIKI_MASTER_PRIVATE_TERMS_FILE` | unset | A file of private terms for `scan-private-terms.mjs` (`PRIVATE_TERMS_FILE` is read too). Keep it outside every repository. |
| `WIKI_MASTER_EMBED_MODEL` | `nomic-embed-text` | Ollama embedding model for drift. |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama endpoint. |

## Vault layout

```
raw/            immutable sources (never edited)   raw/clippings/  Web Clipper output
wiki/           sources · entities · concepts · syntheses · authored (LLM-owned)
moc/            Maps of Content        index.md    catalog        log.md  history
stale.base      native Bases freshness dashboard   .wiki-master/  search index + caches (git-ignored)
.recycle/       purged topics, one folder + manifest.json per purge (git-tracked, never auto-emptied)
```

`.recycle/` is dot-prefixed on purpose: `graph.mjs` skips dot entries during its
walk, every other reader filters on an anchored `wiki/` prefix, and Obsidian's own
indexer ignores dot-folders — so purged content is invisible to every search, metric
and graph without a single reader needing to know it exists. It is git-tracked, so a
purge reaches your other machines with the rest of the vault.

Every wiki page carries `sources: [[...]]` provenance back to `raw/` and
`ai-generated: true` — the guardrails against hallucination contamination.
`wiki/authored/` is the disclosed exception: original content with no `raw/`
counterpart (advisory documentation, policy, house style) declares it via
`sources: []` instead. Pages belonging to a multi-doc project can carry
`project`/`kind` so they group under a generated `moc/<project>.md` hub instead
of one flat, ungrouped catalog.

### Capture routes

`node scripts/clip.mjs <url> --recapture` writes a dated second clipping of a page already in the vault (`<name> (recaptured YYYY-MM-DD).md`, with `recapture-of` naming the capture it follows) and never edits the first; the same text again writes nothing. `node scripts/clip.mjs <url> --from-file <path>` records a page a person saved from a signed-in browser (`.md`, `.markdown`, `.txt`, `.html`, `.htm`) with its real URL, `extraction: manual` and the hash of the supplied bytes; nothing is fetched, and the thin and login-page checks still apply. When the clipper refuses a thin, wrong-node or login, consent or age-gate page, its message says to save the page from a signed-in browser and record it this way. `apply-reclips` refuses a clipping with `extraction: manual` rather than replace the supplied text with a fetched page; refresh it with `--from-file <path> --recapture`. `node scripts/known-urls.mjs` lists the known URLs (sources and plain-text twins), `--check <url>...` says whether each is new, clipped or declined, and `--summary --topic "<topic>"` counts what a topic holds. See [clipping fidelity](docs/clipping-fidelity.md).

### Declines

A source a clipper declines (`--decline="reason"`, or its own thin-content and wrong-node verdicts) is recorded in `.wiki-master/declined.json` for 180 days, and every clipper skips it. Two flags on any clipper lift an active decline, but only after the clipping has been written, so a clip that fails leaves the decline where it was. `--override-decline` lifts a decline the clippers recorded themselves (a reason that starts `thin content`, `thin text` or `likely wrong-node extraction`), for a source obtained another way: a saved file, a print to PDF. A decline someone recorded on purpose is not lifted by it. `--supersede-decline="reason"` lifts any decline and records why. Neither deletes: the entry keeps its original reason and date, gains the new reason and date, and declining the same source again appends to the entry's history instead of replacing it. An older copy of the plugin ignores the new fields and still treats the entry as declined. `node scripts/decline.mjs list [--json]`, `show <url>` and `supersede <url> --reason "<text>"` read and clear the log without clipping: `--supersede-decline` acts only once a clipping is written, so on a URL already in the vault `decline.mjs supersede` is the way to end a decline. It writes only the decline file.

## Development

`npm test` runs the unit suite for the deterministic scripts
against a fixture vault — no running Obsidian required. Arguments after `--` go to
`node --test`, so `npm test -- test/health.test.mjs` runs one file. See
`docs/superpowers/specs/` and `docs/superpowers/plans/` for the design and plan.
[docs/scripts.md](docs/scripts.md) lists every script under `scripts/` with its purpose.

### Temp folders

`npm test` runs `test/run-suite.mjs`, which gives each run its own temp root, `wm-run-XXXXXX` under the system temp folder, and points `TMPDIR`, `TEMP` and `TMP` at it, so the temp folders the tests make land there instead of piling up in the system temp folder. At the end it prints how many entries the tests left in the root and how many new `wm-*` entries appeared outside it. A passing run removes the root; a failing run keeps it and prints its path, because a failed test's leftovers are its evidence. Plain `node --test` still works, without the root. The runner deletes nothing it did not create, so folders from earlier runs stay until removed by hand. To remove `wm-*` folders older than seven days (this includes the roots kept by failed runs):

```sh
find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'wm-*' -mtime +7 -exec rm -rf {} +
```

```powershell
Get-ChildItem $env:TEMP -Filter 'wm-*' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-7) | Remove-Item -Recurse -Force
```

### Tests and the vault

With `WIKI_MASTER_VAULT` unset, a script acts on the default vault, which is the real one. Two guards keep that from happening by accident. `WIKI_MASTER_REQUIRE_VAULT=1` makes a script stop before it reads or writes anything when no vault is named (exit 2, one line). Under `node --test` (the runner sets `NODE_TEST_CONTEXT`, and a child process inherits it) a vault outside the temp directory and the plugin's own folder throws, so a test that forgets to name a vault fails instead of acting on the real one. A test that needs a vault uses `tempVault()` from `test/helpers/temp-vault.mjs`, or puts its own temp path in the `env` it gives a child process, and a test that only checks how a path is resolved passes an environment object: `resolveVault({ WIKI_MASTER_VAULT: '/some/path' })`.

`--help` on a script prints its usage and does nothing else. `triage`, `init`, `lint` and `stale` answer from `scripts/lib/help.mjs` before any vault is resolved, and `test/help-side-effects.test.mjs` compares a vault and a home directory before and after `--help` on every script. The scripts that do not know `--help` reject it as an unknown option, and the dry-run scripts only read. An option a script does not know is refused, not ignored. The seven clippers keep their options in `scripts/lib/clip-args.mjs`; the other scripts (the repair, backfill and rename scripts, `health`, `lint`, `refresh-index`, `stale`, `init`, `triage` and the rest) keep theirs in `scripts/lib/cli-specs.mjs`, checked by `scripts/lib/cli-guard.mjs` at the command-line entry: an unknown option prints one line and exits 2, and `--help` or `-h` prints the usage and exits 0 (a script with its own help, such as `lint`, keeps it). Four scripts have their own help and parser (`apply-reclips`, `bump-version`, `doctor`, `session-brief`). `obsidian.mjs` is the exception: it passes its arguments to the Obsidian CLI. `test/cli-guard.test.mjs` runs every script with a made-up option in a throwaway home, vault and working directory and checks that it refuses and writes nothing (`triage` is checked without being run, because a failed guard would start its server); a new script that is neither guarded nor listed there fails the test.

### Public-repository hygiene

The public repository must not name the owner's other projects or machines: that language belongs in the wiki. `node scripts/scan-private-terms.mjs` scans the tracked and untracked (not ignored) text files for it and exits 1 on a hit. Built in, with nothing to configure: a home-directory path (a Windows `Users` path or a `/Users/` or `/home/` path, placeholders such as `you`, `<name>` or `%USERNAME%` excepted), a GPU model, and the invisible characters that can hide text from a reviewer. With `--terms-file <path>` (or `WIKI_MASTER_PRIVATE_TERMS_FILE`) it also checks the owner's private list: one term per line, matched as a case-insensitive substring, or a `/pattern/flags` line for a regular expression when a word needs whole-word, case-sensitive matching. The report gives the path, the line and the rule number, and never the matched text, so it can be pasted anywhere. `--known <path>` lists files that still hold hits to be sanitised (`test/private-terms-known.txt`): their hits are counted but do not fail the scan, a hit anywhere else does, and an entry with no hit left does too, so the list only shrinks. `test/scan-private-terms.test.mjs` runs the built-in patterns over this repository on every `npm test`, and the owner's list too when the variable is set.

### Line endings

`.gitattributes` sets `* text=auto eol=lf`: text files are LF in the repository and in every working tree, whatever `core.autocrlf` says, so a Windows checkout no longer holds CRLF copies of LF files (scripted multi-line edits, byte comparisons and `git add` warnings all depended on that). Binary files are left alone. `test/line-endings.test.mjs` pins the policy on throwaway repositories with `core.autocrlf=true`.

A checkout made before the policy still has CRLF in its working tree. With nothing uncommitted, rewrite it once: `git rm --cached -r -q . && git reset --hard`. The index already holds LF, so this changes only the files on disk. Do not run it with uncommitted work.

### Releasing

A release changes the version in ten places: the nine JSON fields listed in `VERSION_FIELDS` (`scripts/lib/version-fields.mjs`; seven files, and `package-lock.json` and `.github/plugin/marketplace.json` each carry it twice) plus the `CHANGELOG.md` heading. Do not edit them by hand: `node scripts/bump-version.mjs <x.y.z>` shows what it would change, and `--apply` changes all of them together and adds `## x.y.z — date` at the top of `CHANGELOG.md` (`--changelog-entry <file>` puts your entry under it, `--date` overrides today). It edits the files as text, so their line endings and formatting stay, and it parses the result to prove that only the listed fields changed. It refuses, and writes nothing, when the fields already disagree, when the new version is not greater, or when another entry in a file shares the old version number. `test/drift-guard.test.mjs` fails if any JSON field differs from `package.json`, if a manifest gains a version field that `VERSION_FIELDS` does not list, or if the newest `CHANGELOG.md` heading is not the package version or has no bullet under it.

### Catalog refresh

`node scripts/refresh-index.mjs [--rebuild] [--status]` is the last step of every authoring task, once per task. A delegated worker doesn't run it; the enclosing task does. It always covers the whole vault: it regenerates `index.md`, every roadmap and every project map from one vault graph, then refreshes the semantic search index. It also writes the machine-local [graph cache](skills/wiki-setup/references/validation.md) from the records it read cold, which `validate-authored.mjs` and `health.mjs` read so that they re-read only changed files. A run with nothing to do rewrites no file. Catalogs read the working tree, so another writer's pending page can appear in one. Catalog fences preserve the manual prose and metadata around them.

Before it writes anything it checks that Ollama is reachable with the embedding model pulled, Obsidian is up and not in restricted mode, Obsidian Git is installed and enabled with `autoSaveInterval` above 0, and the vault is a git repository with an upstream. A failure names every problem with the fix to offer, writes nothing and exits 1: the agent offers the fix, doesn't apply it unasked, and reports the task as written but not refreshed. Failed chunks exit 1 with the count; the catalogs written stay, and a rerun retries them. `--rebuild` re-chunks every page and repairs a damaged index. `--status` reports how fresh the index is, checks nothing, writes nothing and always exits 0.

### Authoring checks and Obsidian Git

Use `node scripts/validate-authored.mjs --paths-file <JSON array>` (add `--terms-file <path>` and, to limit it to the plugin projects, `--terms-projects a,b` to run the private list over those pages as `private-term` defects, by line and rule number only) to check only the pages one authoring task wrote. You write the array by hand. It writes nothing (it may read the graph cache; `--no-cache` reads every file), prints `path:line rule message` for each defect and `validate-authored: skipped path <path> (<reason>)` on stderr for each vault entry it could not follow, exits 0 when clean, 1 when there are defects and 2 for unusable input, and leaves the whole-vault check to `health.mjs`. The rules and `--json` shape are in [scoped validation](skills/wiki-setup/references/validation.md).

`node scripts/setup-obsidian-git.mjs` (`--check`, the default) reads the plugin's state and required settings from files and needs no app. `--apply` needs the vault open in Obsidian: it installs the plugin without enabling it, writes its settings only if it has none, then enables it, and an existing settings file stays byte-identical with its differences reported.

The plugin's scripts run no git command that changes the vault, which `test/no-git-writes.test.mjs` pins. A finished task reports that the work is on disk and that Obsidian Git publishes it on its next run; the steps are in the [completion contract](skills/wiki-maintainer/references/operations.md).

### Content lint

`node scripts/lint.mjs` is warn-only and never scored. Quotes the strict verbatim check cannot place are sorted into tiers, with counts first: **convention** (same words in the same order; markup, punctuation or extraction spacing differ; counted, listed with `--tier=convention`), **gapped** (every word is in the evidence in order with extra evidence words between them, which are printed: extraction noise or a silent omission) and **unverified** (a word is changed, added, reordered or negated, or the evidence trail does not hold the text). `--json` emits `{tiers, findings, style}`; `--tier=<name>`, `--page=<substr>` and `--full` narrow or widen the listing. `--near` adds a triage view of the unverified tier: for each unverified quote of six or more words it aligns the quote with the best stretch of a raw clipping on the page's evidence path and, at 0.85 or better (the share of the quote's words that have a partner), prints the word diff: `[-word-]` is in the page's quote and not in the clipping, `{+word+}` is in the clipping only, and `a~b` pairs a word with its longer form (`know~knowing`; a negation, a symbol or a number never pairs with another word, so `not` against `nothing` shows as a change). A coined question or the page's own label scores low and is not listed. A quote whose only close match is a wiki page is counted, not listed, because a summary can match a quote closely without being the source. `--near` changes no tier, and without it nothing is added to the output or the JSON (with `--json` it adds a `near` block). A tier is a pointer for review, not a verdict on the quote. A quote that would be unverified but is wholly the title of a clipping the page cites (a source page naming its document, "World Partition in Unreal Engine") is counted on its own (`tiers.title`, reported on its own line) and not listed; the title is part of the captured record, though not of the body the check searches. Only that tier is reconsidered, and a title with one word changed stays unverified. A clipping's `source:` URL is not matched, because a URL is a single word and every returned quote has at least five, so no quote can be part of one. Quotations are paired in document order, so a phrase quoted inside a quotation stays part of the outer quote and is checked inside it with its inner marks removed; a nested phrase of five or more words is also checked on its own. Only curly marks nest. A straight mark closes the open straight quotation if there is one and otherwise opens a new one, so straight marks alternate open, close, open, close: `"one two three four five "six seven" more"` is read as two quotes with `six seven` between them and outside both. To nest, make the outer quotation curly, or put curly marks inside a straight pair. A straight quote mark never pairs across a blank line, a curly quotation may span one, and a closing curly mark with no curly opener is ignored, even inside an open straight quotation. Style flags (`clearly`, `widely regarded`) skip a quoted span only when it is a single pair of marks with no other quotation mark between them: the words of an outer quotation around a nested one are still checked. The matching lives in `scripts/lib/quote-match.mjs`.

**Scope and recorded verdicts (0.75.0).** `--updated-since=<YYYY-MM-DD>` and `--paths-file=<ledger>` limit a run to the pages edited since a date or the pages a task wrote (both may be given, and both must hold; a value may be written `--name=value` or `--name value`); the summary then starts with a `Scope:` line. The graph is still built whole, so a scoped run saves the quote checks, not the graph build. `--ids` shows each finding's id. `scripts/lint-disposition.mjs record --ids=<id>[,<id>] --disposition=<own-wording|mention|title|markup|accepted|fixed> --reviewer=<name> (--page=<path> | --paths-file=<ledger> | --whole-vault)` appends a verdict to `lint-dispositions.jsonl` at the vault root, and `lint.mjs` then leaves that finding out of its listing and reports `Reviewed: ... ; not yet reviewed: ...` per tier (`--include-reviewed` lists them with the verdict). A finding's id follows its page, its quote and the raw clippings behind it, so editing the quote or replacing a clipping lists it again for a new reading, and a `fixed` verdict does not hide a finding that is still there. The file is append-only and tracked; mark it `merge=union` in the vault's `.gitattributes` so two machines' additions merge without a conflict. `lint-disposition.mjs prune` removes the records of a page that no longer exists. Without the file, and without the new options, the output is unchanged.

**Style flags and their verdicts (0.96.0).** A style flag is a review pointer. A contrast connective (`however`, `but`, `despite`, `yet`) in a synthesis is flagged only when no `[[citation]]` covers its sentence, and a citation covers the sentences before it in the same paragraph, because pages cite at the end of a paragraph; a citation only before the sentence does not cover it, and a list item, heading or table row starts a new paragraph. `not yet`, `yet to`, `as yet` and `nothing but` are not read as contrasts. Every style flag has an id (shown by `--ids`, which covers the page, the category, the flagged words and a hash of the sentence it was raised on), `lint-disposition.mjs record` takes it like a quote id, `lint.mjs` leaves a reviewed flag out of its listing and counts it in `tiers.styleReviewed`, and `--include-reviewed` lists it with the verdict. Rewording the flagged sentence gives the flag a new id and it is read again. A record for a style flag has the same shape as a quote record, so an older version of the plugin that does not know style ids reads the file and ignores those lines.
