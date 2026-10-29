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

No MCP server, no daemon, no vector database. Semantic search is a chunk-level index
built from your own Ollama instance: ~5,500 chunks over ~1,800 pages, brute-force cosine
in single-digit milliseconds. A vector database solves a problem this scale does not have.

## Requirements

- A host agent: **Claude Code**, **GitHub Copilot CLI**, or **Codex** with plugin support.
  Each host loads the same skills and runs the bundled helpers independently.
- Obsidian 1.12+ with the official command-line interface enabled
  (Settings → General → Command line interface).
- The vault open in Obsidian (the CLI drives the running app).
- Node.js ≥20.8 (for the helper scripts and Linux abstract-socket CLI lock).
- npm/npx for the pinned HTML clipping runtime; dependencies are acquired automatically on first use. See [capture fidelity and limits](docs/clipping-fidelity.md).
- Optional: [Ollama](https://ollama.com) with an embedding model
  (`ollama pull nomic-embed-text`), for semantic-drift detection — degrades
  gracefully if absent.
- Optional: `npm i -g playwright-core`, plus Chrome or Edge, for the
  browser-render clip rung — clipping JavaScript-rendered pages that serve no
  article text to a plain fetch. Degrades gracefully if absent; without it those
  pages are queued for triage exactly as before. Set `WIKI_MASTER_BROWSER` to
  point at a specific browser executable.

To print a project's state from inside its repository, run `node scripts/session-brief.mjs` there. It finds the wiki project from a `repo:` line on the project's overview page (the repository's `origin` remote, in any spelling, or its folder name must match; `--project <slug>` names it directly), then prints the studio state page in three lines (phase and tier, next step, blocked by), the artifacts not verified for more than `--stale-days` days (default 30), the blocked backlog items and the open questions past their gate. No match, or more than one, exits 1 with how to bind; it never writes and opens no operation.

To see what this machine has and lacks, run `node scripts/doctor.mjs` (all commands) or `node scripts/doctor.mjs clip-docx clip-xlsx` (named commands; exit status 1 when a required program of one is missing). It lists, for each command, the programs and packages it needs, the path and version found, and how to fix what is missing; `--json` prints the same as one object. It starts each program once with its version flag, never the Obsidian CLI, and writes nothing. It also says when the copy it runs from is not the installed version.

## Install

The plugin ships its operations as **skills** and shares the same `scripts/`
(Node) across all three hosts. Claude Code and Copilot CLI expose `/wiki-*`;
in Codex, select a skill or ask for it by name (for example, “use wiki-health”).

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

1. `/wiki-init` — scaffolds the vault and prints one-time setup.
2. In Obsidian: **Open folder as vault** → the scaffolded path.
3. Verify: `node "<absolute-plugin-root>/scripts/obsidian.mjs" vaults` lists the vault.
4. Import `templates/webclipper-template.json` into the Obsidian Web Clipper.
5. Clip web pages (they land in `raw/clippings/`), then `/wiki-ingest` to compile
   them into the wiki. Ask questions with `/wiki-query`, or just search with `/wiki-search`.

Use the [guarded CLI caller](docs/cli-transport-guards.md) for app commands. It
serializes cooperating sessions and rejects oversized requests before launch.
Edit ordinary Markdown through the filesystem, preserving the wiki operation lifecycle.

## Skills

Invoked as `/wiki-*` and `/clip-*` on Claude Code and GitHub Copilot CLI. In Codex, select
the matching skill or ask for it by name; the slash notation below identifies
the same workflows.

| Skill | Purpose |
|---|---|
| `/wiki-init` | Scaffold the vault (folders, index/log, schema, Bases dashboard, templates). |
| `/wiki-ingest [source]` | Read a source → summary page + cross-references + index/log. Blank = process new clippings. |
| `/wiki-search <terms> [--include-raw]` | Pure retrieval — matching `wiki/` pages (optionally `raw/` clippings too) as citation-ready `path:line` results. Chunk-level semantic + keyword, RRF-fused. No synthesis, no writes. |
| `/wiki-query <question>` | Ask a question, get a synthesized answer with citations; optionally file it back as a new page. Calls `/wiki-search` as its first step. |
| `/wiki-health` | Deterministic integrity defect count and worklist; intentional forward links are unscored. |
| `/wiki-repair` | Resolve integrity defects against evidence and verify progress by issue ID. |
| `/wiki-lint` | Periodic deep pass: contradictions, stale claims, missing links, drift. |
| `/wiki-stale` | Factual freshness from `reviewed`, missing-review reporting + bounded semantic drift. |
| `/wiki-relink` | Add inferred links, materialize frequently-referenced entities, build MOCs. |
| `/wiki-author [what]` | Author original `wiki/authored/` content (docs, guides, ADRs, backlog items) — canonical per-kind placement, no re-deriving convention per project. |
| `/wiki-purge <topic> [--seeds a.md,b.md]` | Remove a topic for good — pages, evidence and source URLs move to a git-tracked `.recycle/` bin and the removal is committed so it reaches every machine. `--reconcile` re-bins anything that comes back; `--restore <id>` undoes it. |
| `/wiki-discover <topic>` | Find web sources for a topic, credibility-rank them, clip the survivors and hand off to `/wiki-ingest`. Read-only research until clipping. |
| `/wiki-triage [kind]` | Review what needs your eyes — failed clips, fidelity flags, expiring declines, ingest backlog — in a browser queue grouped by research topic. |
| `/clip-pdf <file.pdf>` | Capture a local or downloaded PDF as Markdown evidence; `--figures` also renders figure pages to `raw/figures/`. |
| `/clip-docx <file.docx>` | Capture a Word document as Markdown evidence. |
| `/clip-xlsx <file.xlsx>` | Capture a spreadsheet or workbook as Markdown evidence. |
| `/clip-pptx <file.pptx>` | Capture a PowerPoint deck — bullets, tables and speaker notes per slide — as Markdown evidence. |
| `/clip-gh <owner/repo>` | Capture a GitHub repository as bounded Markdown clippings. |
| `/clip-confluence <url-or-id>` | Capture an authenticated Confluence Cloud page (needs the optional `confluencer` integration). |

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
purge reaches your other machines instead of evaporating on the next sync.

Every wiki page carries `sources: [[...]]` provenance back to `raw/` and
`ai-generated: true` — the guardrails against hallucination contamination.
`wiki/authored/` is the disclosed exception: original content with no `raw/`
counterpart (advisory documentation, policy, house style) declares it via
`sources: []` instead. Pages belonging to a multi-doc project can carry
`project`/`kind` so they group under a generated `moc/<project>.md` hub instead
of one flat, ungrouped catalog.

### Declines

A source a clipper declines (`--decline="reason"`, or its own thin-content and wrong-node verdicts) is recorded in `.wiki-master/declined.json` for 180 days, and every clipper skips it. Two flags on any clipper lift an active decline, but only after the clipping has been written, so a clip that fails leaves the decline where it was. `--override-decline` lifts a decline the clippers recorded themselves (a reason that starts `thin content`, `thin text` or `likely wrong-node extraction`), for a source obtained another way: a saved file, a print to PDF. A decline someone recorded on purpose is not lifted by it. `--supersede-decline="reason"` lifts any decline and records why. Neither deletes: the entry keeps its original reason and date, gains the new reason and date, and declining the same source again appends to the entry's history instead of replacing it. An older copy of the plugin ignores the new fields and still treats the entry as declined.

## Development

`npm test` (or `node --test`) runs the unit suite for the deterministic scripts
against a fixture vault — no running Obsidian required. See
`docs/superpowers/specs/` and `docs/superpowers/plans/` for the design and plan.

### Tests and the vault

With `WIKI_MASTER_VAULT` unset, a script acts on the default vault, which is the real one. Two guards keep that from happening by accident. `WIKI_MASTER_REQUIRE_VAULT=1` makes a script stop before it reads or writes anything when no vault is named (exit 2, one line). Under `node --test` (the runner sets `NODE_TEST_CONTEXT`, and a child process inherits it) a vault outside the temp directory and the plugin's own folder throws, so a test that forgets to name a vault fails instead of acting on the real one. A test that needs a vault uses `tempVault()` from `test/helpers/temp-vault.mjs`, or puts its own temp path in the `env` it gives a child process, and a test that only checks how a path is resolved passes an environment object: `resolveVault({ WIKI_MASTER_VAULT: '/some/path' })`.

`--help` on a script prints its usage and does nothing else. Measured on the 51 scripts: four of them (`index-gen`, `index-embed`, `triage`, `init`) used to act on `--help` and two (`lint`, `stale`) ran in full; those six now answer from `scripts/lib/help.mjs` before any vault is resolved, and `test/help-side-effects.test.mjs` compares a vault and a home directory before and after `--help` on every script. The scripts that do not know `--help` reject it as an unknown option, and the dry-run scripts only read. An option a script does not know is refused, not ignored. The seven clippers keep their options in `scripts/lib/clip-args.mjs`; 42 other scripts (the repair, backfill, rename and operation scripts, `health`, `lint`, `stale`, `init`, `triage` and the rest) keep theirs in `scripts/lib/cli-specs.mjs`, checked by `scripts/lib/cli-guard.mjs` at the command-line entry: an unknown option prints one line and exits 2, and `--help` or `-h` prints the usage and exits 0 (a script with its own help, such as `lint`, keeps it). Five scripts have their own help and parser (`apply-reclips`, `bump-version`, `doctor`, `index-gen`, `session-brief`). `obsidian.mjs` is the exception: it passes its arguments to the Obsidian CLI. `test/cli-guard.test.mjs` runs every script with a made-up option in a throwaway home, vault and working directory and checks that it refuses and writes nothing (`triage` is checked without being run, because a failed guard would start its server); a new script that is neither guarded nor listed there fails the test.

### Public-repository hygiene

The public repository must not name the owner's other projects or machines: that language belongs in the wiki. `node scripts/scan-private-terms.mjs` scans the tracked and untracked (not ignored) text files for it and exits 1 on a hit. Built in, with nothing to configure: a home-directory path (a Windows `Users` path or a `/Users/` or `/home/` path, placeholders such as `you`, `<name>` or `%USERNAME%` excepted), a GPU model, and the invisible characters that can hide text from a reviewer. With `--terms-file <path>` (or `WIKI_MASTER_PRIVATE_TERMS_FILE`) it also checks the owner's private list: one term per line, matched as a case-insensitive substring, or a `/pattern/flags` line for a regular expression when a word needs whole-word, case-sensitive matching. The report gives the path, the line and the rule number, and never the matched text, so it can be pasted anywhere. `--known <path>` lists files that still hold hits to be sanitised (`test/private-terms-known.txt`): their hits are counted but do not fail the scan, a hit anywhere else does, and an entry with no hit left does too, so the list only shrinks. `test/scan-private-terms.test.mjs` runs the built-in patterns over this repository on every `npm test`, and the owner's list too when the variable is set.

### Line endings

`.gitattributes` sets `* text=auto eol=lf`: text files are LF in the repository and in every working tree, whatever `core.autocrlf` says, so a Windows checkout no longer holds CRLF copies of LF files (scripted multi-line edits, byte comparisons and `git add` warnings all depended on that). Binary files are left alone. `test/line-endings.test.mjs` pins the policy on throwaway repositories with `core.autocrlf=true`.

A checkout made before the policy still has CRLF in its working tree. With nothing uncommitted, rewrite it once: `git rm --cached -r -q . && git reset --hard`. The index already holds LF, so this changes only the files on disk. Do not run it with uncommitted work; commit or stash first.

### Releasing

A release changes the version in ten places: the nine JSON fields listed in `VERSION_FIELDS` (`scripts/lib/version-fields.mjs`; seven files, and `package-lock.json` and `.github/plugin/marketplace.json` each carry it twice) plus the `CHANGELOG.md` heading. Do not edit them by hand: `node scripts/bump-version.mjs <x.y.z>` shows what it would change, and `--apply` changes all of them together and adds `## x.y.z — date` at the top of `CHANGELOG.md` (`--changelog-entry <file>` puts your entry under it, `--date` overrides today). It edits the files as text, so their line endings and formatting stay, and it parses the result to prove that only the listed fields changed. It refuses, and writes nothing, when the fields already disagree, when the new version is not greater, or when another entry in a file shares the old version number. `test/drift-guard.test.mjs` fails if any JSON field differs from `package.json`, if a manifest gains a version field that `VERSION_FIELDS` does not list, or if the newest `CHANGELOG.md` heading is not the package version or has no bullet under it.

### Catalog refresh

Use `node scripts/refresh-catalogs.mjs --project wiki-master --apply` for a project documentation update. The default is a dry run: it writes nothing, and its `changed` list names the files an apply would change (an apply on the same, unchanged vault changes exactly those). `--diff` adds, on stderr after the one-line JSON, one block per changed file with the lines it would lose (`-`) and gain (`+`). It shares one vault graph across the backlog, MOC and global index generators and preserves unchanged files' modification times. `--paths-file <JSON array>` keeps another writer's uncommitted pages out of the catalogs: a page counts when it is in the last commit or the ledger names it, so a page another writer has only staged is left out. A line a catalog already lists for a left-out page that still exists is kept, not deleted; a line for a page that is gone is removed. `backlog-gen.mjs` and `moc-authored-gen.mjs` also accept `--project` when run separately, and their dry run lists the files that would change too; they refuse `--diff` and `--paths-file` with one line and exit 2. `index-gen.mjs` (the ingest path) lists every page on disk unless given the same `--paths-file`, which scopes it as above. Cross-project ambiguity detection still requires one vault scan.

Use `node scripts/validate-authored.mjs --paths-file <JSON array>` (add `--terms-file <path>` and, to limit it to the plugin projects, `--terms-projects a,b` to run the private list over those pages as `private-term` defects, by line and rule number only) to check only the pages one authoring task wrote, with the same ledger `op-commit.mjs` takes: it is read-only, prints `path:line rule message` for each defect, exits 0 when clean, 1 when there are defects and 2 for unusable input, and leaves the whole-vault check to `health.mjs`. `node scripts/op-ledger.mjs show --since <token> --out <file>` builds that ledger from the paths the writers recorded (the clippers, `log-entry`, `index-gen` and `refresh-catalogs --apply` take `--since <token>`; `op-ledger.mjs add` records a page you wrote yourself) and lists on stderr what the close would get wrong: a recorded path that was already dirty before `op-begin`, one that is not dirty now, and every changed path nobody recorded. The ledger, rules and `--json` shape are in the authoring reference (`skills/wiki-maintainer/references/authoring.md`). `op-commit` without `--paths-file` is refused (exit 1, nothing committed, token kept) while any other operation is open, with the two commands that scope it; every refused close, and every `wiki-sync` refused because uncommitted edits overlap incoming changes (exit 3, nothing changed, a hint of which open operation recorded each file; never reset, check out, stash or delete a file you did not write, wait and sync again), appends a counts-only line to `.wiki-master/op-refusals.jsonl`, and `health` prints `Recorded refusals: N (pre-dirty a, evidence b, unscoped c, sync-overlap d).` when N is above zero (`opRefusals` in `--json`, with `syncOverlap`). The plugin's scripts make the vault's scoped commits and sync; Obsidian Git is for viewing and pulling, with auto-commit off. `node scripts/wiki-sync.mjs --op <token> [--paths-file <ledger>] [--title "<title>"]` closes that one operation (scoped by `--paths-file`, else by the paths its writers recorded) and publishes it in one verified command; the rules are in the operations reference (`skills/wiki-maintainer/references/operations.md`).

### Content lint

`node scripts/lint.mjs` is warn-only and never scored. Quotes the strict verbatim check cannot place are sorted into tiers, with counts first: **convention** (same words in the same order; markup, punctuation or extraction spacing differ; counted, listed with `--tier=convention`), **gapped** (every word is in the evidence in order with extra evidence words between them, which are printed: extraction noise or a silent omission) and **unverified** (a word is changed, added, reordered or negated, or the evidence trail does not hold the text). `--json` emits `{tiers, findings, style}`; `--tier=<name>`, `--page=<substr>` and `--full` narrow or widen the listing. `--near` adds a triage view of the unverified tier: for each unverified quote of six or more words it aligns the quote with the best stretch of a raw clipping on the page's evidence path and, at 0.85 or better (the share of the quote's words that have a partner), prints the word diff: `[-word-]` is in the page's quote and not in the clipping, `{+word+}` is in the clipping only, and `a~b` pairs a word with its longer form (`know~knowing`; a negation, a symbol or a number never pairs with another word, so `not` against `nothing` shows as a change). A coined question or the page's own label scores low and is not listed. A quote whose only close match is a wiki page is counted, not listed, because a summary can match a quote closely without being the source. `--near` changes no tier, and without it nothing is added to the output or the JSON (with `--json` it adds a `near` block). A tier is a pointer for review, not a verdict on the quote. A quote that would be unverified but is wholly the title of a clipping the page cites (a source page naming its document, "World Partition in Unreal Engine") is counted on its own (`tiers.title`, reported on its own line) and not listed; the title is part of the captured record, though not of the body the check searches. Only that tier is reconsidered, and a title with one word changed stays unverified. A clipping's `source:` URL is not matched, because a URL is a single word and every returned quote has at least five, so no quote can be part of one. Quotations are paired in document order, so a phrase quoted inside a quotation stays part of the outer quote and is checked inside it with its inner marks removed; a nested phrase of five or more words is also checked on its own. Only curly marks nest. A straight mark closes the open straight quotation if there is one and otherwise opens a new one, so straight marks alternate open, close, open, close: `"one two three four five "six seven" more"` is read as two quotes with `six seven` between them and outside both. To nest, make the outer quotation curly, or put curly marks inside a straight pair. A straight quote mark never pairs across a blank line, a curly quotation may span one, and a closing curly mark with no curly opener is ignored, even inside an open straight quotation. Style flags (`clearly`, `widely regarded`) skip a quoted span only when it is a single pair of marks with no other quotation mark between them: the words of an outer quotation around a nested one are still checked. The matching lives in `scripts/lib/quote-match.mjs`.

**Scope and recorded verdicts (0.75.0).** `--updated-since=<YYYY-MM-DD>` and `--paths-file=<ledger>` limit a run to the pages edited since a date or the pages a task wrote (both may be given, and both must hold; a value may be written `--name=value` or `--name value`); the summary then starts with a `Scope:` line. The graph is still built whole, so a scoped run saves the quote checks, not the graph build. `--ids` shows each finding's id. `scripts/lint-disposition.mjs record --ids=<id>[,<id>] --disposition=<own-wording|mention|title|markup|accepted|fixed> --reviewer=<name> (--page=<path> | --paths-file=<ledger> | --whole-vault)` appends a verdict to `lint-dispositions.jsonl` at the vault root, and `lint.mjs` then leaves that finding out of its listing and reports `Reviewed: ... ; not yet reviewed: ...` per tier (`--include-reviewed` lists them with the verdict). A finding's id follows its page, its quote and the raw clippings behind it, so editing the quote or replacing a clipping lists it again for a new reading, and a `fixed` verdict does not hide a finding that is still there. The file is append-only and tracked; mark it `merge=union` in the vault's `.gitattributes` so two machines' additions merge without a conflict. `lint-disposition.mjs prune` removes the records of a page that no longer exists. Without the file, and without the new options, the output is unchanged.
