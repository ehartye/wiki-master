# With-skills run — recheck-spreadsheet

## Scenario: spreadsheet-clip

Prompt: "Clip this quarterly metrics workbook into the wiki so we can cite it."
Target: `C:/drops/kestrel-metrics-q3.xlsx` (local `.xlsx`, no canonical URL), part of an
in-progress research run with topic string `Kestrel offline rollout`. Vault `C:/vault`,
installed plugin root `C:/plugins/wiki-master`, current working directory `C:/work/widget`
(unrelated — nothing is resolved relative to it).

### Ordered intended actions

1. **Route selection.** The request is "clip a workbook into the wiki so we can cite it" —
   a vault operation, so wiki-master owns it. The extension is `.xlsx`, so from the installed
   catalog the route is **clip-xlsx** ("clip a spreadsheet or workbook (.xlsx, .xls, .xlsm)
   into the wiki as Markdown evidence"). I rule out the neighbours the descriptions
   explicitly disclaim: `clip-pdf` (PDFs), `clip-docx` (Word), `wiki-discover` (HTML pages /
   finding new sources — the file is already in hand), `wiki-ingest` (already-captured
   clippings — nothing is captured yet). I explicitly do **not** convert the workbook to PDF
   and run `clip-pdf`: that rebuilds row/label pairings from horizontal position, and for a
   metrics workbook the label-to-value pairing *is* the content, so a wrong number would read
   as clean output.

2. **Load the skill bodies once.** Read `skills/wiki-maintainer/SKILL.md` (shared core) plus
   the three references clip-xlsx links directly for this operation: `references/access.md`,
   `references/evidence.md`, `references/operations.md`. I skip the other references
   (authoring, efficacy, maintenance, workflows) — not this operation.

3. **Resolve paths and the vault, not from cwd.** Plugin root is the installed skill
   directory's `../../` = `C:/plugins/wiki-master`; every helper is called as a quoted
   absolute path `C:/plugins/wiki-master/scripts/<helper>.mjs`. Vault is `C:/vault`, set for
   this operation's scope only, in PowerShell with the prior value restored (Windows: use
   PowerShell, not Git Bash, for anything touching the Obsidian/Node wrappers):

   ```powershell
   $wikiPriorVault = $env:WIKI_MASTER_VAULT
   try {
     $env:WIKI_MASTER_VAULT = 'C:/vault'
     # ... steps 5-10 ...
   } finally {
     $env:WIKI_MASTER_VAULT = $wikiPriorVault
   }
   ```

   I do not search the disk for a vault, and I do not require Obsidian to be running — this
   is filesystem + bundled-helper work, so no `assertRunning` gate.

4. **Read the vault's own instructions before writing.** `sed -n '1,200p' C:/vault/AGENTS.md`
   (and the schema it points at) — required before changing the vault, and it is also where a
   standing sync authorization would live, which decides step 10. Confirm the expected layout
   exists (`C:/vault/raw/clippings/`, `C:/vault/wiki/`, `C:/vault/log/`).

5. **Preflight both converters** (once, before opening anything):

   ```powershell
   soffice --version
   pandoc -v
   ```

   Both are reported installed, so this passes. Why check first: a missing LibreOffice is a
   **fatal stop** with an install pointer (https://www.libreoffice.org/download/) — I would
   stop there and never retype cells or fabricate values by hand. `soffice` is called by bare
   name deliberately so PATHEXT picks the console shim `soffice.com`; `soffice.exe` is the GUI
   build and writes nothing to stdout. Note that the actual conversions inside the clipper run
   through Node's `execFileSync` — I do not shell out to `soffice`/`pandoc` myself to do the
   conversion.

6. **Confirm authorization scope before the first write.** The user asked for the clip and
   capture is authorized, so I reuse that session authorization and do not re-ask to clip.
   Capturing evidence does **not** by itself authorize ingestion, and here ingestion is
   explicitly not authorized — so `/wiki-ingest`, `wiki/sources/` pages, MOC/index edits and
   any citation-ready wiki page are out of scope for this run. I plan to stop at verified
   evidence plus its operation record.

7. **Open the operation before the clipper writes** (the helper writes to `raw/`, so this is a
   vault mutation). There is no enclosing operation I own here — the research run is
   in-progress but I was handed a standalone clip request, so I open one myself rather than
   assuming someone else's token; if the user tells me a discover operation is already open,
   I use that token and record who closes it instead of opening a second:

   ```powershell
   $wikiOpToken = node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op discover
   if ($LASTEXITCODE -ne 0) { throw 'Could not open wiki operation' }
   ```

   `--op discover` because clipping/capture uses the discover vocabulary. The token snapshots
   already-dirty paths so the later commit excludes pre-existing work.

8. **Clip — the helper is the sole writer to `raw/`:**

   ```powershell
   node 'C:/plugins/wiki-master/scripts/clip-xlsx.mjs' 'C:/drops/kestrel-metrics-q3.xlsx' --quality=high --topic='Kestrel offline rollout'
   ```

   Flag decisions:
   - **`--source` omitted deliberately.** There is no canonical URL; the file path is recorded
     as the source. I never invent a URL to fill the field.
   - **`--topic='Kestrel offline rollout'`** — the clip belongs to an in-progress research run,
     and the topic string must be byte-identical to the one the run was given so `/wiki-triage`
     groups this run's leftovers together. This is the one irreversible flag: topic is recorded
     going forward only and no tool can retro-fit it, so a clip made without it is a permanent
     *Unattributed* triage row. If I were not certain of the exact string I would ask before
     running rather than guess.
   - **`--quality=high`** — my credibility judgment of the workbook as a source: a first-party
     internal quarterly metrics workbook is primary data, not commentary. This is separate from
     how cleanly it extracts; I do not downgrade it because conversion may be lossy, and I do
     not upgrade it because the tables look tidy.
   - I never hand-write the clipping file: that would bypass dedup, decline recording and the
     content hash the ingest backlog joins on.

9. **Verify the clipping and its diagnostics** — read the returned path, e.g.
   `C:/vault/raw/clippings/kestrel-metrics-q3.md`, and check:
   - Each sheet arrived as a real Markdown table with labels still attached to their values
     (the failure mode that matters for a workbook is a plausible-looking table with shifted
     pairings).
   - Frontmatter is present and tooling-written: `source`, `created`, `tags:[clippings]`,
     `quality`, `source-hash`; title derived from the filename. I do not edit the body — raw
     bodies are immutable — and I do not touch frontmatter by hand.
   - The helper's status. Three outcomes I handle differently:
     - `failed` (corrupt or password-protected workbook): report it for manual handling, never
       invent cells.
     - duplicate by content hash: the vault already holds these contents under an existing slug
       — report that instead of clipping a second copy, and there is nothing new to commit.
     - `thin` (under 100 words): a decline is recorded so it is not retried blindly. **This
       clipper has no `--allow-short`** — I say plainly that the clip did not succeed and that
       the decline must be cleared or the content captured another way, rather than presenting
       it as captured.
   - Known lossiness I will state rather than hide: formulas, merged cells, charts and
     multi-row headers convert as rendered values, not as the model behind them.

10. **Close the operation** (only after a successful, verified clip):

    ```powershell
    'Clipped C:/drops/kestrel-metrics-q3.xlsx into raw/clippings/kestrel-metrics-q3.md via LibreOffice+pandoc; topic "Kestrel offline rollout", quality high, no canonical URL so the local path is the recorded source. Sheets verified as tables with labels intact. Not ingested - ingestion is not authorized.' | node 'C:/plugins/wiki-master/scripts/log-entry.mjs' --op discover --title 'Clip Kestrel Q3 metrics workbook'
    if ($LASTEXITCODE -ne 0) { throw 'Could not log wiki operation' }
    node 'C:/plugins/wiki-master/scripts/op-commit.mjs' --op discover --title 'Clip Kestrel Q3 metrics workbook' --since $wikiOpToken
    if ($LASTEXITCODE -ne 0) { throw 'Could not commit wiki operation' }
    ```

    One log entry, never appended to an aggregate log. I inspect the commit's actual changed
    paths (expected: the new `raw/clippings/` file plus operation/log state, nothing else) and
    never `git add -A`. No catalog regeneration is due: `index-gen.mjs` and the MOC/backlog
    generators serve wiki-page changes, and no wiki page changed. If the vault is not a git
    repo I report it as local-only rather than claiming a commit.

11. **Sync only if already authorized.** `op-commit` never pushes. If `C:/vault/AGENTS.md` or
    the session already authorizes sync, run `git -C C:/vault push` and verify the result and
    upstream state; a rejected push is a real stop — no force, no claiming success. Otherwise I
    report the unpushed commit and ask only if publishing matters.

12. **Stop at the authorization edge, and hand off explicitly.** The natural next step is
    `/wiki-ingest` — summarize into `wiki/sources/`, cross-reference, index — which is exactly
    what "so we can cite it" ultimately needs. That is **not authorized**, so I do not do it; I
    name it and ask. I also flag the fidelity rule ahead of that step: a faithful extraction of
    the wrong workbook is still wrong, and any figure must be checked against the workbook
    before it lands on a wiki page.

### Sample user response after a successful path

"Clipped the workbook as Markdown evidence — the vault stores the extracted Markdown, not the
binary.

- `C:/vault/raw/clippings/kestrel-metrics-q3.md` (LibreOffice → pandoc, `--wrap=none`)
- Source field: the local path `C:/drops/kestrel-metrics-q3.xlsx` — you gave no canonical URL
  and I won't invent one.
- Topic: `Kestrel offline rollout`, matching the research run, so `/wiki-triage` groups this
  clip with the rest of that run. Worth knowing: topic can only be set at clip time and can
  never be back-filled, so tell me now if that string is wrong.
- Quality: `high` — my credibility call on a first-party metrics workbook, independent of how
  cleanly it converted.
- Verified: each sheet came through as a real table with labels still attached to their values.
  Conversion is lossy on formulas, merged cells, charts and multi-row headers — it captured
  rendered values, not the model behind them, so verify any specific figure against the
  workbook before it lands on a page.
- Logged and committed under one `discover` operation. [Pushed / committed but not pushed —
  say the word if you want it published.]

Not done, because it isn't authorized yet: ingesting this into a citable
`wiki/sources/` page with cross-references and index refresh. Capturing evidence doesn't
authorize ingestion. Say the word and I'll run `/wiki-ingest` on this clipping — that's what
turns it into something you can cite by `[[note]]`. Right now the evidence exists and is
greppable, but there's no wiki page pointing at it."

### Stop condition

**Done when:** `raw/clippings/kestrel-metrics-q3.md` exists with tooling-written frontmatter
including the `Kestrel offline rollout` topic and a `source-hash`; I have read it and confirmed
the sheets are tables with labels bound to their values; one `discover` log entry is written;
`op-commit` succeeded and the changed paths are exactly the clip plus operation state; sync is
either verified or reported as unpushed; and the unauthorized ingest step is named to the user
as a pending ask rather than silently performed or silently skipped.

**Specific blockers at which I stop instead:**
- **LibreOffice not installed** — fatal. Stop with the install pointer; no hand transcription
  of cells, no PDF detour.
- **Workbook itself fails to convert** (corrupt/password-protected) — report `failed` for
  manual handling; never reconstruct cells from the filename or from what a Q3 metrics sheet
  "usually" contains.
- **Thin result (<100 words)** — a decline is recorded and there is no `--allow-short` on this
  clipper. Report it as not captured and ask whether to clear the decline or capture the
  content another way.
- **Duplicate content hash** — the vault already holds this workbook's contents; report the
  existing slug rather than creating a second one.
- **Topic string uncertain** — ask before clipping, because `--topic` cannot be retro-fitted.
- **Anything past capture** (wiki page, MOC entry, citation-ready summary) — stop and ask;
  ingestion is explicitly not authorized in this scope.
- **Push rejected** — a real stop for sync; report it, do not force.

## Files loaded and inherited exposure

Files I opened in this run, and nothing else in the repo:

1. `C:/Users/ehart/repos/wiki-master/eval/skill-coverage/recheck-spreadsheet/skill-catalog.snapshot.md`
2. `C:/Users/ehart/repos/wiki-master/eval/skill-coverage/recheck-spreadsheet/prompts.json`
3. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/SKILL.md`
4. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/access.md`
5. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/evidence.md`
6. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/operations.md`
7. `C:/Users/ehart/repos/wiki-master/skills/clip-xlsx/SKILL.md`

I did **not** open any `scenarios.json`, any test file, any other file under `eval/`, anything
under `docs/`, or any prior evaluation transcript or artifact. I saw none of those.

Inherited context beyond those files: the system environment block (OS Windows 11, PowerShell
primary, repo root, scratchpad path, git status showing a clean `main` at `d42d924`), the
user's global `CLAUDE.md` and auto-memory summary lines, the harness's ambient list of
available Skill-tool names with their one-line descriptions (which includes the same
wiki-master skills as the snapshot), and the task instructions from the invoking agent. I did
not invoke any skill through the Skill tool and did not execute anything against a vault —
this is a simulation write-up.

**Did the installed catalog cover this scenario?** Yes. `clip-xlsx` is present in
`skill-catalog.snapshot.md` (line 8) and covers exactly this case: "clip a spreadsheet or
workbook (.xlsx, .xls, .xlsm) into the wiki as Markdown evidence."

**How I located the route:** from the catalog snapshot alone — I matched the request's file
extension and intent against the descriptions, and the disclaimer clauses in the neighbouring
clip-* entries ("For Word documents use clip-docx and for PDFs use clip-pdf; existing clippings
belong to wiki-ingest") confirmed the boundaries. `wiki-maintainer` was loaded as the shared
core it declares itself to be, and `clip-xlsx/SKILL.md` then named the three references to load
for this operation.
