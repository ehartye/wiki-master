# Without-skill run (simulation)

Mode: simulation. Nothing below was executed against a real vault; this is the ordered
sequence of actions I would take, knowing only the installed skill **names and one-line
descriptions**, not their instructions.

## Scenario: spreadsheet-clip

Prompt: "Clip this quarterly metrics workbook into the wiki so we can cite it."

Facts I am working from: Windows PowerShell; cwd is an unrelated repo `C:/work/widget`;
plugin at `C:/plugins/wiki-master`; vault at `C:/vault`; the file is
`C:/drops/kestrel-metrics-q3.xlsx` with no canonical URL; it belongs to an in-progress
research run whose topic string is `Kestrel offline rollout`; `soffice` and `pandoc` are
both installed; capturing the file is authorized, adding it to wiki pages is not.

From the catalog, the matching skill is **clip-xlsx** ("clip a spreadsheet or workbook
(.xlsx, .xls, .xlsm) into the wiki as Markdown evidence"). I would reach for it first. In
this run I do not have its instructions, so everything below is what I would do as an
ordinary careful agent with shell, filesystem, and the plugin's scripts.

### Ordered intended actions

1. **Pin the working directory away from the unrelated repo.** The cwd is `C:/work/widget`,
   which has nothing to do with this task. I would use absolute paths for every command and
   never write into, stage, or commit anything under `C:/work/widget`. No `git` command runs
   in this task at all.

2. **Verify the three paths exist before doing anything else.**

   ```powershell
   Test-Path C:/drops/kestrel-metrics-q3.xlsx
   Test-Path C:/vault
   Test-Path C:/plugins/wiki-master
   Get-Item C:/drops/kestrel-metrics-q3.xlsx | Select-Object FullName, Length, LastWriteTime
   ```

   If the workbook is missing or zero-length I stop here and say so.

3. **Fingerprint the source file so the clipping is citable and re-verifiable.**

   ```powershell
   Get-FileHash -Algorithm SHA256 C:/drops/kestrel-metrics-q3.xlsx
   ```

   I record the SHA-256, byte size, and `LastWriteTime`. With no canonical URL, the file
   path + hash + mtime *is* the provenance; without it a future reader cannot tell which
   version of the workbook a quoted number came from.

4. **Look for plugin tooling before hand-rolling a conversion.**

   ```powershell
   Get-ChildItem -Recurse -File C:/plugins/wiki-master/scripts | Select-Object FullName
   Get-ChildItem C:/plugins/wiki-master -Depth 1
   ```

   If there is an obvious capture/clip helper (a script that takes a source path and a vault
   path and emits a clipping), I run it with `-?`/`--help` first and use it rather than
   inventing my own output shape. Reusing the plugin's own writer is the difference between
   a clipping the rest of the toolchain can ingest and a stray Markdown file.
   *(I do not open anything under `skills/` in this run.)*

5. **Learn the vault's clipping conventions by example rather than guessing.**

   ```powershell
   Get-ChildItem C:/vault -Depth 2 -Directory
   Get-ChildItem -Recurse -File C:/vault -Include *.md | Select-Object -First 40 FullName
   ```

   I am looking for: the directory clippings live in (something like `C:/vault/clippings/`
   or `.../sources/`), a config/manifest file at the vault root, and one or two existing
   clippings whose YAML frontmatter I can read and mirror field-for-field (key names, date
   format, status values, topic field). Copying an existing clipping's shape is far safer
   than inventing frontmatter, because ingest and triage downstream almost certainly key off
   those exact fields.

6. **Inspect the workbook's structure before converting it,** so I know what fidelity I am
   about to lose. Working in the scratchpad, not the vault:

   ```powershell
   $tmp = "$env:TEMP/clip-xlsx-kestrel"
   New-Item -ItemType Directory -Force $tmp
   Copy-Item C:/drops/kestrel-metrics-q3.xlsx "$tmp/src.xlsx"
   Expand-Archive "$tmp/src.xlsx" -DestinationPath "$tmp/unzipped"
   Get-Content "$tmp/unzipped/xl/workbook.xml"
   ```

   `workbook.xml` gives me the sheet names and, critically, `state="hidden"` /
   `state="veryHidden"` flags. I also list `xl/charts/`, `xl/media/`, and `xl/pivotCache/` to
   see whether there are charts, images, or pivot tables that a Markdown table simply cannot
   carry.

7. **Convert to Markdown via LibreOffice then pandoc.** Direct xlsx-to-md is not something
   either tool does well; the HTML hop preserves the sheet/table structure.

   ```powershell
   & soffice --headless --norestore --convert-to html:"HTML (StarCalc)" --outdir $tmp "$tmp/src.xlsx"
   & pandoc "$tmp/src.html" -f html -t gfm --wrap=none -o "$tmp/src.md"
   ```

   I run `soffice` with an explicit `-env:UserInstallation=file:///.../lo-profile` if a stray
   running LibreOffice makes the headless call no-op, which it does on Windows. Note that
   this export yields **computed values, not formulas** — worth saying out loud in the
   clipping.

8. **Read the converted Markdown and repair it rather than shipping it raw.** LibreOffice's
   HTML export is noisy. Concretely I would: confirm each sheet became its own section and
   add an `## <sheet name>` heading where the export dropped one; strip trailing all-empty
   columns/rows that the used-range overshoot produces; check that numbers kept their
   precision and that dates did not come out as serial numbers; and check the row count
   against the source so I can tell whether anything was truncated.

9. **Decide honestly what did not survive, and record it.** Anything from step 6 that
   Markdown cannot represent — charts, images, pivot tables, hidden sheets, formulas,
   conditional formatting, merged-cell layout — gets an explicit "not captured" note in the
   clipping. A clipping that silently omits a hidden sheet is worse than no clipping, because
   someone will later cite the workbook as if the Markdown were complete. If the losses are
   substantial (e.g. the headline numbers live in a chart, or a `veryHidden` sheet carries
   the assumptions), I flag it to the user rather than burying it.

10. **Write the clipping into the vault's clippings directory,** named to match the
    conventions found in step 5 (e.g. `C:/vault/clippings/kestrel-metrics-q3-xlsx.md`), with
    frontmatter mirroring an existing clipping and carrying at minimum:
    - source: `C:/drops/kestrel-metrics-q3.xlsx` (local path; **no canonical URL** — stated
      explicitly rather than left blank or faked)
    - sha256, bytes, source modified date, captured date (2026-09-11)
    - tool chain used: `soffice (HTML StarCalc) -> pandoc gfm`
    - topic: `Kestrel offline rollout` — the exact topic string of the in-progress research
      run, verbatim, so the run picks it up
    - status: not yet ingested
    - the fidelity notes from step 9

    Body: the cleaned per-sheet Markdown tables from step 8.

11. **Attach it to the in-progress research run without touching wiki pages.** I would grep
    the vault for the run:

    ```powershell
    Select-String -Path C:/vault -Pattern "Kestrel offline rollout" -List -Recurse
    ```

    If the run keeps a queue/backlog file that is plainly a capture-side artifact, adding the
    clipping there is part of capturing and I do it. If the only place to register it is a
    wiki page (a topic page, an index, a map of content), **I stop** — that is "adding it to
    wiki pages", which is not authorized. I would not create the page either. Instead I
    report the exact edit I would make and ask for authorization.

12. **Verify before claiming done:** re-read the written file from disk, confirm the
    frontmatter parses as YAML, confirm the tables render (no ragged pipe counts), confirm
    the sheet count matches `workbook.xml`, and confirm nothing was written outside
    `C:/vault/clippings/` and the scratchpad. Then clean up `$tmp`.

### Sample user response after a successful path

"Captured the workbook as wiki evidence — nothing has been added to any wiki page.

**Clipping:** `C:/vault/clippings/kestrel-metrics-q3-xlsx.md`
**Source:** `C:/drops/kestrel-metrics-q3.xlsx` (no canonical URL — cited by path + hash)
`sha256 a3f1…` · 412 KB · modified 2026-09-08
**Converted with:** LibreOffice headless → HTML → pandoc (gfm)
**Tagged to:** the in-progress run `Kestrel offline rollout`

**Sheets captured (4):** Summary, Q3 Detail, Regions, Assumptions.

**What did not survive the conversion** — recorded in the clipping so nobody cites it as
complete:
- Two charts on *Summary* are not represented; their underlying ranges on *Q3 Detail* are.
- Cells hold computed values, not formulas.
- One hidden sheet, *scratch*, was captured and marked as hidden in the source.

**Not done, needs your go-ahead:** ingesting this into the wiki. The clipping is raw evidence
and is not linked from any page yet — the `Kestrel offline rollout` topic page would need an
edit to reference it, and you said page edits aren't authorized. Say the word and I'll run
that ingest; otherwise it sits in the backlog for whoever picks the run up."

### Stop condition

Done when: the clipping file exists in the vault's clippings directory with parseable
frontmatter carrying source path, SHA-256, capture date, the exact topic string
`Kestrel offline rollout`, an explicit "no canonical URL" marker, and the fidelity-loss
notes; the body holds one Markdown section per sheet matching the sheet list in
`xl/workbook.xml`; nothing was written outside the vault's clippings directory; and no wiki
page was created or edited.

Specific blockers at which I stop instead and ask:

- **Authorization boundary.** The moment the only remaining step is editing or creating a
  wiki page — a topic page, index, or map of content for `Kestrel offline rollout` — I stop.
  Capture is authorized; that is not. I report the exact edit and wait.
- **Vault convention is unreadable.** If step 5 finds no existing clipping and no config to
  mirror, I stop rather than invent a frontmatter schema that ingest may not accept, and ask
  where clippings go and what fields they carry.
- **Conversion loses the substance.** If the workbook's real content is charts, pivots, or a
  `veryHidden` sheet — i.e. the Markdown would be a misleading shell — I stop and tell the
  user before writing a clipping that reads as complete.
- **`soffice` produces nothing.** If the headless convert silently no-ops (a running
  LibreOffice instance on Windows does exactly this) and a separate user profile doesn't fix
  it, I stop rather than commit a partial or empty table.

## Files loaded and inherited exposure

Files I read in this run, in full and exclusively:

1. `C:/Users/ehart/repos/wiki-master/eval/skill-coverage/recheck-spreadsheet/skill-catalog.snapshot.md`
2. `C:/Users/ehart/repos/wiki-master/eval/skill-coverage/recheck-spreadsheet/prompts.json`

No other file in the repo or elsewhere was opened.

Explicitly: I read **no** file under `skills/` — no `SKILL.md`, no reference or supporting
file, for `clip-xlsx` or any other skill. I read **no** `scenarios.json`, no rubric, no test
file, no `docs/` file, no prior transcript, and no prior evaluation artifact. I invoked no
skill via the Skill tool, and I executed nothing against the vault, the plugin, or any
spreadsheet.

Inherited exposure I could not opt out of, disclosed for completeness:

- The **system prompt's skill listing**, which names and one-line-describes every installed
  skill in this session, including the `wiki-master:*` family. This overlaps the catalog
  snapshot's content but is a *live* listing, and in this session it does **not** include
  `clip-xlsx` — the snapshot does. That difference tells me `clip-xlsx` is not installed
  here, which is consistent with this being the without-skill arm.
- The **environment block** (repo root, Windows/PowerShell, scratchpad path, today's date
  2026-09-11) and the **git status snapshot** in context: branch `main`, clean tree, and five
  recent commit subject lines, several of which mention clip and triage work. I used none of
  it to shape the plan above beyond platform and date.
- `C:/Users/ehart/.claude/CLAUDE.md` (global user instructions) and the auto-memory file
  `…/wiki-master/memory/MEMORY.md`, both injected into context by the harness rather than
  read by me. The memory entries are about dependency honesty and verifying against real
  documents; the CLAUDE.md line "the wiki is the source of truth" is general standing
  guidance, not scenario knowledge.

I hold no knowledge of `clip-xlsx`'s actual procedure, output format, frontmatter schema,
naming rules, or fidelity policy. Everything in the plan above was derived from the one-line
description, the scenario facts, and general knowledge of xlsx internals, LibreOffice, and
pandoc.
