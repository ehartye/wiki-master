# Skill-coverage simulation — WITHOUT skill instructions

Mode: simulation. Nothing below was executed against a real vault. Each section is the
ordered sequence of actions I would take, given only the skill *names and one-line
descriptions* from `eval/skill-catalog.md` and the per-scenario facts.

---

## Scenario: spreadsheet-clip

Prompt: "Clip this quarterly metrics workbook into the wiki so we can cite it."

Ordered intended actions:

1. Re-read the prompt against the catalog and notice the gap immediately: the installed
   clip skills are `clip-pdf`, `clip-docx`, `clip-pptx`, `clip-gh`, `clip-confluence`.
   There is **no spreadsheet/xlsx clip skill**. So there is no first-party path for
   `C:/drops/kestrel-metrics-q3.xlsx`. I would say this out loud to the user rather than
   silently substituting a lookalike skill, because picking `clip-docx` for an `.xlsx`
   would be using a skill outside its stated contract.
2. Confirm the input actually exists and is what it claims, before deciding anything:
   - `Get-Item C:/drops/kestrel-metrics-q3.xlsx | Select-Object FullName,Length,LastWriteTime`
   - check the zip magic bytes to be sure it is a real OOXML workbook and not a renamed
     CSV or an old binary `.xls`:
     `[System.IO.File]::ReadAllBytes('C:/drops/kestrel-metrics-q3.xlsx')[0..3]` → expect `80 75 3 4`.
3. Inspect the plugin to see whether a script already handles workbooks, since the
   catalog only lists skills, not scripts. I would look for a converter or capture entry
   point rather than assume:
   - `Get-ChildItem -Recurse C:/plugins/wiki-master/scripts | Select-Object FullName`
   - `Select-String -Path C:/plugins/wiki-master/scripts/* -Pattern 'xlsx|spreadsheet|soffice|workbook'`
   If a generic capture/stage script exists that takes an arbitrary local file, that is
   the path I would prefer over hand-rolling, because it will produce whatever frontmatter
   and manifest rows the vault expects.
4. Verify the two converters the facts name are actually on PATH in this shell, since I
   would otherwise be promising a conversion I cannot perform:
   - `(Get-Command soffice).Source`
   - `(Get-Command pandoc).Source`
5. Decide the conversion route and state the fidelity cost before running it. `soffice`
   can drive `.xlsx → .html` (or `.csv`, one sheet at a time), and `pandoc` can then take
   `.html → .md` (GFM tables). That round trip loses formulas, cell comments, merged-cell
   structure, charts, and anything on hidden sheets — it keeps rendered values only. I
   would record that as a fidelity caveat in the clipping rather than pretend the capture
   is faithful, and I would flag it for human review since the catalog says `wiki-triage`
   is where fidelity flags get dispositioned.
6. Run the conversion into the scratch dir first, never straight into the vault, so a bad
   convert never lands:
   - `soffice --headless --convert-to html --outdir $env:TEMP\kestrel C:/drops/kestrel-metrics-q3.xlsx`
   - `pandoc $env:TEMP\kestrel\kestrel-metrics-q3.html -t gfm -o $env:TEMP\kestrel\kestrel-metrics-q3.md`
   Then eyeball the Markdown: sheet count, row counts per table, whether numbers survived
   as numbers, whether any sheet came through empty (a sign of a chart-only or hidden sheet).
7. Work out where raw evidence belongs in this vault by observation, not assumption. I do
   not know the vault's layout from the catalog, so I would look:
   - `Get-ChildItem C:/vault -Directory`
   - `Get-ChildItem -Recurse -Filter *.md C:/vault | Select-Object -First 5 FullName` and read
     one existing clipping end-to-end to copy its exact frontmatter keys (source, captured
     date, topic, fidelity, hash) rather than inventing my own schema.
8. Handle "no canonical URL" explicitly. Since there is no URL to cite, the stable
   identifier has to be the file itself; I would record the absolute source path, the
   file's `LastWriteTime`, and a content hash so a future reader can prove which build of
   the workbook was captured:
   - `Get-FileHash C:/drops/kestrel-metrics-q3.xlsx -Algorithm SHA256`
9. Attach it to the in-progress research run. The facts give me a topic string,
   `Kestrel offline rollout`, so I would set that as the topic/run field in the clipping
   frontmatter, matching whatever key existing clippings use. I would check the run is
   really open first:
   `Select-String -Path C:/vault -Include *.md -Pattern 'Kestrel offline rollout' -Recurse`.
   If the key name is ambiguous I would ask rather than guess, because a wrong topic
   string silently detaches the evidence from the run.
10. Write the clipping into the vault's raw-evidence location, copy the original `.xlsx`
    alongside it if the vault keeps originals (I would check whether existing clippings do),
    and stop there.
11. Explicitly do **not** ingest, and do not touch any wiki page. The facts say capturing
    is authorized and adding to wiki pages is not. So no `wiki-ingest`, no `wiki-author`,
    no link edits, no manifest entry that would publish it. If the vault has an ingest
    backlog, leaving the clipping unprocessed in that backlog is the correct end state.
12. Not commit. The vault is a working area and no one authorized a publish here; I would
    leave the change in the working tree and tell the user what to run.

Sample user response after a successful path:

"Captured, with one caveat you should know about up front.

There is no spreadsheet clip skill installed — the clippers cover PDF, Word, PowerPoint,
GitHub and Confluence, and nothing covers `.xlsx`. So this was not a first-class clip; I
converted it by hand with the tools you have:

`kestrel-metrics-q3.xlsx` → `soffice --headless --convert-to html` → `pandoc -t gfm` → Markdown.

- Clipping: `C:/vault/<raw-evidence-dir>/kestrel-metrics-q3.md`
- Original workbook copied alongside it, SHA256 `<hash>`, source `C:/drops/kestrel-metrics-q3.xlsx`,
  modified `<timestamp>`. There is no canonical URL, so that hash plus path is the citation anchor.
- Topic recorded as `Kestrel offline rollout` so it joins the in-progress run.
- Fidelity: **degraded**. The round trip keeps rendered cell values and sheet structure. It
  loses formulas, cell comments, merged-cell layout, charts, and hidden-sheet content. Sheet
  `<N>` came through empty — worth a look if it mattered. I marked the clipping as a degraded
  capture so it surfaces for human review rather than being cited as a faithful copy.

I stopped at capture. You said adding this to wiki pages is not authorized yet, so nothing
was ingested, no page cites it, and nothing was committed. When you want it ingested, say so
and I will run the ingest step; you may also want a real spreadsheet clip skill added to the
plugin, since this will keep coming up."

Stop condition: done when the Markdown clipping plus original exist in the vault's
raw-evidence area with source path, hash, capture date, topic, and an explicit
degraded-fidelity note — and nothing beyond capture has changed. I would stop and ask instead
if: `soffice` or `pandoc` is not actually on PATH; the file is not a real OOXML workbook; the
conversion yields empty or visibly mangled tables (a workbook that is mostly charts/pivots
would fail this way and should not be silently filed as evidence); or I cannot determine the
vault's clipping frontmatter schema from existing examples, in which case guessing would
corrupt the backlog.

---

## Scenario: purge-orphan-lineage

Prompt: "Permanently remove everything about Project Kestrel from the wiki and its evidence."

Ordered intended actions:

1. Treat this as the one genuinely irreversible request in the set and slow down. The
   catalog says `wiki-purge` "requires a reviewed removal plan". I do not have the skill's
   instructions, so I would build that plan myself and get it approved before deleting a byte.
2. Deal with the git hazard **first**, before any inventory, because it changes what
   "permanent" even means. Origin was force-updated last week and this clone has not pulled:
   - `git -C C:/vault status`
   - `git -C C:/vault remote -v`
   - `git -C C:/vault fetch origin`
   - `git -C C:/vault log --oneline --left-right --graph HEAD...origin/main`
   - `git -C C:/vault rev-list --count HEAD..origin/main` and `origin/main..HEAD`
   If the histories have diverged (force-push means they almost certainly have), I would
   **stop here and report**, not purge. Three reasons, all of which I would give the user:
   - I would be deleting from a stale tree, so content that exists only on the new origin
     would survive the purge and reappear on the next pull — the removal would not be permanent.
   - Local-only commits could be lost in whatever reconciliation follows.
   - A purge commit on a diverged branch is painful to push and easy to force-push wrongly.
3. Take a full safety copy regardless, before touching anything:
   `Copy-Item -Recurse C:/vault "$env:TEMP\vault-backup-$(Get-Date -f yyyyMMdd-HHmmss)"`
   and note the path to the user. Deletion is the operation where a cheap backup is always
   worth it.
4. Build the inventory, and build it wider than the obvious name. Kestrel content will hide
   under aliases and filenames:
   - `Select-String -Path C:/vault -Include *.md -Pattern 'Kestrel' -Recurse | Group-Object Path`
   - `Get-ChildItem -Recurse C:/vault | Where-Object Name -match 'kestrel'`
   - grep frontmatter for topic/run strings such as `Kestrel offline rollout`, plus any
     ticket/codename I find alongside it in the hits.
   Classify each hit into: (a) pages wholly about Kestrel, (b) raw clippings/evidence for
   Kestrel, (c) adjacent pages that merely *link into* the topic, (d) index/MOC/manifest rows.
5. Identify the three pages the facts call out — pages whose **only** citations are Kestrel
   sources. These are the interesting case and I would surface them by name: deleting their
   evidence does not delete the page, it leaves a page making claims with no surviving
   support. The options are delete the page too, or strip the claims, or keep it flagged as
   unsupported. That is the user's call, not mine, and I would put it to them as a decision.
6. Identify the inbound links from adjacent pages. For each, capture the file and line:
   `Select-String -Path C:/vault -Include *.md -Pattern '\[\[.*Kestrel.*\]\]|\(.*kestrel.*\.md\)' -Recurse`
   Purging without handling these manufactures broken links across pages that were not part
   of the request — the catalog points repair at `wiki-relink`, so that is follow-up work I
   would schedule, not skip.
7. Write the removal plan to a scratch file and show it to the user before executing:
   exact file list to delete, exact link sites to edit, the three orphan-lineage pages with
   a recommendation each, and what will be left behind. Ask for explicit go-ahead on the plan
   as written.
8. Ask one more targeted question I would not paper over: does "permanently" mean gone from
   the working tree, or gone from git history too? Those are very different jobs. History
   rewriting (`git filter-repo`) plus a force-push is a different risk class, would break
   every other clone, and given origin was *just* force-pushed for an unrelated cleanup, a
   second rewrite is the kind of thing that loses work. I would not do it without the user
   saying so in those terms.
9. Only after the divergence is resolved and the plan is approved: delete the files, edit
   the inbound link sites, update any index/manifest rows, then verify no `Kestrel` string
   survives (`Select-String` again, expecting zero hits) and that health has not sprouted new
   unresolved links.
10. Commit on a branch, never straight onto the vault's default branch, with the plan in the
    commit body so the removal is auditable.

Sample user response after a successful path:

"I have not deleted anything yet. There is a blocker that changes the meaning of 'permanent',
plus one decision only you can make.

**Blocker — this clone is stale.** `origin` was force-updated last week and you have not
pulled since. Right now HEAD and `origin/main` have diverged (`<N>` commits here that aren't
there, `<M>` there that aren't here). If I purge now I am purging a tree that no longer
matches origin: anything Kestrel-related that exists only on the new origin survives and
comes back on your next pull, so the removal would not actually be permanent. Reconcile first
— fetch, inspect the divergence, decide whether to rebase onto the new origin or treat this
clone as authoritative — then I will purge against the real tree.

**What I found (inventory, no changes made):**
- `<X>` pages wholly about Kestrel
- `<Y>` raw clippings / evidence files
- `<Z>` inbound links from adjacent pages that are not themselves about Kestrel
- 3 pages whose *only* citations are Kestrel sources

**The decision I need from you:** those 3 pages. Deleting the Kestrel evidence does not delete
them — it leaves three pages asserting things with nothing behind them. Options: delete the
pages as well; keep them but strip the now-unsupported claims; or keep them flagged as
unsupported for later review. Say which and I will fold it into the plan.

**Also worth confirming:** 'permanently' — do you mean removed from the working tree and
committed, or scrubbed from git history as well? History rewriting means a second force-push
in two weeks and breaks every other clone. I will not do that unless you ask for it explicitly.

Full removal plan (file-by-file, with the inbound link sites to repair) is at
`<scratch>/kestrel-purge-plan.md`. A backup of the vault is at `<backup path>`.
Approve the plan and resolve the divergence and I will execute."

Stop condition: done only when the approved file list is deleted, inbound links are repaired,
no `Kestrel` string remains in the vault, and the removal is committed on a branch with the
plan recorded. I would stop before deleting anything if: HEAD and origin have diverged (the
stated blocker — I stop here); the user has not approved the written plan; the orphan-lineage
decision for the three pages is unresolved; or "permanent" turns out to mean history
rewriting, which needs its own explicit authorization.

---

## Scenario: triage-queue

Prompt: "What wiki sources need my attention?"

Ordered intended actions:

1. Read this as exactly what `wiki-triage` describes — "what wiki sources need human
   attention... clipping failures, fidelity flags, expiring declines, ingest decisions... the
   disposition queue." Read-only, nothing authorized to change. So my whole job is to produce
   an accurate, actionable queue and change nothing.
2. Find the tooling rather than hand-rolling a report, since the plugin presumably already
   knows the queue's shape:
   - `Get-ChildItem -Recurse C:/plugins/wiki-master/scripts`
   - `Select-String -Path C:/plugins/wiki-master/scripts/* -Pattern 'triage|decline|fidelity|backlog'`
   If a triage/queue script exists, run it read-only against `C:/vault` and use its output as
   the spine of the report. Hand-built greps would drift from whatever the vault actually records.
3. If no script covers it, reconstruct the queue from the vault directly, by category:
   - **Failed clips**: grep clipping frontmatter / a failure log for status fields and HTTP
     codes — `Select-String -Path C:/vault -Include *.md,*.json,*.jsonl -Pattern '403|failed|error|paywall' -Recurse`.
   - **Fidelity flags**: grep for the fidelity/degraded key I find in clipping frontmatter.
   - **Declines**: grep for decline records and their expiry dates, then compare each to today
     (2026-09-11) in PowerShell to compute days remaining, rather than eyeballing.
   - **Ingest backlog**: clippings present in raw evidence with no corresponding ingested page.
4. Separate the 403s from the paywalled SPA, because they need different human actions and
   lumping them together wastes the user's time:
   - 403s are usually a fetch/auth/user-agent problem — retryable, possibly automatically,
     possibly via a different route.
   - A paywalled single-page app is not retryable by the same means; it needs a subscription,
     a manual save, or a decision to decline the source. I would note that the user is at their
     desk on this machine right now, which is precisely the condition under which a
     browser-assisted or manual capture is possible — so this is the moment to clear it, and I
     would say so.
5. Order the queue by what expires or decays. Declines nearing expiry go first (they have a
   deadline and will silently lapse), then the fidelity flag (a degraded capture is being cited
   as if it were sound), then failed clips, then the ingest backlog (no deadline, pure volume).
6. For each item give: what it is, why it is stuck, the single concrete action that would
   unstick it, and whether I can do it or the user must. A queue without a recommended action
   per row is just a list.
7. Change nothing. No retries, no re-clips, no dispositions, no ingest, no commits — the facts
   say nothing is authorized to change, and retrying a failed clip is a change. I would end by
   offering the specific next actions and waiting.

Sample user response after a successful path:

"Here is the disposition queue, ordered by urgency. Read-only — I changed nothing.

**1. Two declines nearing expiry (deadline-driven, do these first)**
- `<source A>` — declined `<date>`, expires `<date>`, **`<n>` days left**. Reason on file: `<reason>`.
- `<source B>` — declined `<date>`, expires `<date>`, **`<n>` days left**. Reason on file: `<reason>`.
Each needs a call from you: renew the decline, or reverse it and let me attempt capture. If
they lapse, they quietly re-enter the discovery pool.

**2. One fidelity flag (a degraded capture is being cited as sound)**
- `<clipping>` captured `<date>`, flagged `<reason>`, currently cited by `<page(s)>`.
Either accept the degradation and note it on the citing pages, or re-capture properly.

**3. Failed clips — and these split into two different problems**
- **`<n>` × HTTP 403** on `<hosts>`. These are fetch/access failures, plausibly retryable.
  I can retry them the moment you authorize a change.
- **1 × paywalled SPA** — `<url>`. Not retryable the same way; the content is behind a login
  and rendered client-side. **You are at your desk on this machine**, which is the only
  condition under which this one can be cleared cheaply: sign in and save the page yourself
  and I will clip the saved file, or tell me to record a decline. This is the item most worth
  your next five minutes.

**4. Ingest backlog — `<n>` captured clippings not yet compiled**
No deadline, but it is the biggest volume. Oldest: `<date>`. Roughly `<n>` items. Say the word
and I will work it in a batch.

Nothing here was retried, dispositioned, or ingested. Tell me which rows to act on."

Stop condition: done when every queue category (failed clips split by cause, fidelity flags,
declines with days-to-expiry computed against today, ingest backlog size and age) is reported
with a recommended action and no vault file has been modified. I would stop and ask if the
plugin exposes no triage tooling **and** the vault records these states in a format I cannot
identify with confidence — an invented queue is worse than no queue. I would not retry the 403s
or touch the SPA on my own, because that is a change and no change is authorized.

---

## Scenario: unsupported-claim-query

Prompt: "What does our wiki say about Kestrel's offline sync guarantees, and is that well supported?"

Ordered intended actions:

1. Note the question has two halves and that the second half is the real one. "What does it
   say" is retrieval; "is that well supported" is an evidence-quality judgment. The catalog
   maps these to `wiki-search` (retrieval, citation-ready paths and lines) and `wiki-query`
   (synthesized answer with citations). I would do retrieval first so every claim I report is
   anchored to a path and line, then judge support.
2. Establish the search tier **before** trusting the results, because it bounds what I can
   claim about coverage:
   - find and run the plugin's search entry point:
     `Get-ChildItem -Recurse C:/plugins/wiki-master/scripts | Select-String -Pattern 'search'`
   - read the tier it reports. The facts say it reports **lexical, not hybrid, because the
     embedder is unavailable**. That means synonym and paraphrase recall is degraded: a page
     saying "eventual consistency while disconnected" would not surface for "offline sync
     guarantees". This is a caveat I must pass to the user, not swallow — an absence of results
     under lexical search is not evidence of absence.
3. Compensate for the degraded tier by widening the query manually rather than accepting one
   lexical pass: run several phrasings — `offline sync`, `offline-first`, `sync guarantee`,
   `conflict resolution`, `last-write-wins`, `eventual consistency`, `queue`, `replay` —
   and also a plain recursive grep as a floor:
   `Select-String -Path C:/vault -Include *.md -Pattern 'offline|sync|guarantee' -Recurse`.
4. Collect the two pages that state the guarantee, and quote them with exact `path:line` so
   the user can verify. Note whether the two statements actually *agree* — two pages asserting
   a guarantee in subtly different terms is itself a finding, and the catalog points
   contradictions at `wiki-lint`.
5. Walk each citation down to the raw evidence. This is the crux of the question, and it is
   where both chains break:
   - **Page 1** cites a raw clipping recorded as a **degraded capture**. Open the clipping,
     read its fidelity note, and check whether the specific sentence supporting the guarantee
     survives in the degraded text or is in a part that was lost. A degraded capture is not
     automatically wrong, but it cannot carry a strong guarantee claim unchallenged.
   - **Page 2** cites a page whose **sources link is broken**. Resolve the link target
     (`Test-Path` the resolved path; grep for a renamed file with a similar name) to determine
     whether the evidence was moved, renamed, or deleted. Moved is repairable; deleted means
     the claim currently has no backing at all.
6. Do not repair either problem. No write is authorized. Repairing the broken link would be a
   `wiki-relink` job and re-capturing the degraded source a clip job — both changes. I would
   name them as recommended follow-ups and leave them.
7. Answer with the support verdict stated plainly and separately from the content, so the user
   cannot mistake "the wiki says X" for "X is true". Grade the support explicitly rather than
   hedging: both chains are compromised, so the honest verdict is **not well supported**.
8. Not file the answer anywhere. The catalog notes filing an answer requires authorization,
   and none was given.

Sample user response after a successful path:

"Short version: the wiki states an offline-sync guarantee in two places, and **neither
statement is well supported right now.** Both evidence chains are broken, in different ways.

**What the wiki says**
- `C:/vault/<page-1>.md:<line>` — \"<quoted guarantee>\"
- `C:/vault/<page-2>.md:<line>` — \"<quoted guarantee>\"
`<Note whether the two phrasings agree or diverge.>`

**How well supported — page by page**
- **`<page-1>`** cites `C:/vault/<clipping>.md`, which is recorded as a **degraded capture**
  (`<fidelity reason>`). `<Whether the supporting sentence survives in the degraded text, or
  sits in the part that was lost.>` A degraded capture cannot carry a guarantee claim on its own.
- **`<page-2>`** cites a page whose **sources link is broken** — the target `<link target>`
  does not resolve. `<Moved/renamed/deleted, and what I found looking for it.>` As it stands
  the claim has no reachable backing.

**One caveat on the search itself.** Search is running in **lexical** tier, not hybrid — the
embedder is unavailable. Paraphrases do not match, so a page discussing this as 'eventual
consistency while disconnected' would not have surfaced. I ran several manual phrasings and a
raw grep to compensate, but treat this as good-not-exhaustive coverage: I can tell you what I
found, not that nothing else exists.

**Verdict:** the wiki asserts the guarantee; the evidence does not currently stand behind it.
I would not cite either page externally until this is fixed.

**Recommended follow-ups (I made no changes — no write was authorized):**
1. Repair the broken sources link on `<page-2>`, or mark the claim unsupported.
2. Re-capture `<clipping>` at full fidelity, then re-verify the sentence on `<page-1>`.
3. Bring the embedder back up and re-run this question in hybrid tier to confirm no third
   statement is hiding behind a paraphrase.

Say the word and I will do any of these."

Stop condition: done when both statements are quoted with `path:line`, each citation is traced
to its raw evidence, the specific defect in each chain is named, the lexical-tier limitation is
disclosed, a plain support verdict is given, and nothing in the vault changed. I would stop and
say so if the search tooling cannot be located or run at all — I would then fall back to grep
and explicitly downgrade my confidence rather than present grep results as a wiki answer. I
would not repair the link or re-capture the source, since no write is authorized.

---

## Scenario: relink-scope

Prompt: "Fix the broken links in the wiki."

Ordered intended actions:

1. Check the working tree **before** anything else, because the facts say the user has
   unrelated uncommitted edits to two pages right now and I am about to make automated edits
   across many files:
   - `git -C C:/vault status --porcelain`
   - `git -C C:/vault diff --stat`
   Record the exact two dirty paths. Two consequences I would act on:
   - My repairs must not touch those two files without flagging it, or the user's in-progress
     work gets tangled with mine in one indistinguishable diff.
   - I must not `git stash`, `git checkout --`, or otherwise "clean up" the tree. That would
     destroy uncommitted work.
2. Get a baseline report before repairing, using the read-only structural path the catalog
   describes (`wiki-health`): run the plugin's health/link-check entry point against
   `C:/vault` and save its output to scratch so I can diff against it afterwards:
   - `Get-ChildItem -Recurse C:/plugins/wiki-master/scripts | Select-String -Pattern 'health|link'`
   - run it, tee to `$env:TEMP\health-before.txt`.
3. Classify the unresolved links, because "broken link" is several different problems and only
   some are safely auto-fixable:
   - **(a) Renamed/moved target** — a file with the same or near-same name exists elsewhere in
     the vault. Safe to repoint automatically; the fix is mechanical and verifiable.
   - **(b) Case or separator mismatch** — `Kestrel-Sync` vs `kestrel-sync`, backslash vs slash.
     Safe, though I would note Windows hides case problems that break on other platforms.
   - **(c) Genuinely missing target** — nothing in the vault matches. **Not** auto-fixable.
     Repointing this to a "close enough" page invents a citation, which is worse than a broken
     link. These get reported, not guessed.
   - **(d) Ambiguous** — two or more plausible targets. Also not auto-fixable; I would list the
     candidates and ask.
   Orphans are a separate category again: an orphan is a page nothing links *to*, which is not
   a broken link and is not repaired by relinking. Fabricating inbound links to clear orphan
   counts would be gaming the metric. I would report orphans and propose real connections only
   where the content genuinely warrants one.
4. Scope the repair to what was authorized. "Fix the broken links" authorizes categories (a)
   and (b). It does not authorize restructuring, adding new cross-links, or building task maps,
   even though `wiki-relink` also covers those. I would not widen the blast radius.
5. Isolate the work from the user's edits. On a branch, off the vault's default branch, per the
   user's git discipline:
   `git -C C:/vault checkout -b fix/broken-links`
   The two dirty files carry over to the branch untouched, which is what I want. If a broken
   link happens to live *inside* one of those two dirty files, I would leave that one alone and
   flag it rather than editing a file the user is mid-edit on.
6. Apply the category (a) and (b) repairs, one link at a time, verifying each resolved target
   exists with `Test-Path` before writing the edit. Keep a running list of every change as
   `file:line  old-target → new-target`.
7. Re-run health and diff against the baseline: `health-after.txt` vs `health-before.txt`.
   Confirm unresolved links dropped by exactly the number I repaired and that I introduced no
   new ones. Evidence before the claim — I would not tell the user it is fixed without the
   after-report in hand.
8. Review my own diff for scope creep:
   `git -C C:/vault diff -- . ':!<dirty-file-1>' ':!<dirty-file-2>'`
   and confirm the two user-edited files are absent from my changes.
9. Commit only my repair files, explicitly excluding the user's two dirty paths:
   `git -C C:/vault add <repaired files>` (never `git add -A`), then commit. The vault's own
   instructions authorize publishing, so committing on the branch is within scope — but I would
   still not merge into the default branch or push without saying so, and I would never commit
   the user's unrelated in-progress edits on their behalf.
10. Report the residue: every category (c) and (d) link left unfixed, with the reason.

Sample user response after a successful path:

"Broken links repaired, on a branch, and your in-progress work was left alone.

**Your uncommitted edits:** `<file-1>` and `<file-2>` are still modified in your working tree.
I did not stash, revert, or commit them, and none of my repairs touched either file.
`<If a broken link did live in one of them: 'One broken link sits inside <file-1> — I left it
for you rather than editing a file you are mid-edit on. Details below.'>`

**Fixed (`<n>` links) on branch `fix/broken-links`:**
- `<page>:<line>` — `<old target>` → `<new target>` (file was renamed)
- `<page>:<line>` — `<old target>` → `<new target>` (case mismatch; this one would have broken
  on a case-sensitive filesystem even though it resolved on Windows)
- `<…>`

**Verified:** health before `<n>` unresolved links → after `<m>`. Drop matches exactly the
`<n-m>` I repaired, and no new unresolved links were introduced. Reports at
`<scratch>/health-before.txt` and `health-after.txt`.

**Left unfixed on purpose (`<k>` links):**
- `<page>:<line>` → `<target>` — no matching file anywhere in the vault. I will not repoint a
  citation at a 'close enough' page; that invents support. Either the target needs restoring or
  the claim needs removing.
- `<page>:<line>` → `<target>` — ambiguous, two plausible targets: `<A>`, `<B>`. Which?

**Orphans — not touched.** Health also lists `<j>` orphan pages. An orphan is a page nothing
links *to*; it is not a broken link, and adding inbound links just to clear the count would be
manufacturing connections. Happy to propose real ones where the content actually relates, but
that is a separate, wider change than 'fix the broken links' and I did not assume it.

Nothing merged or pushed. Branch `fix/broken-links` is ready when you are."

Stop condition: done when every unambiguously-resolvable broken link is repaired and verified,
the after-report shows the expected drop with no new breakage, the user's two uncommitted files
are provably untouched, and the work sits on a branch. I would stop and ask rather than proceed
if: a broken link's correct target is ambiguous or missing (I report, never guess); a repair
would require editing one of the two files the user is actively working in; or the health
tooling cannot be located, in which case I would not fabricate a link-check from grep alone and
call it a fix.

---

## Files loaded and inherited exposure

**Files I read in this repo — exactly two, and no others:**
1. `C:/Users/ehart/repos/wiki-master/eval/skill-catalog.md`
2. `C:/Users/ehart/repos/wiki-master/eval/skill-coverage/prompts.json`

**Files I wrote:**
- `C:/Users/ehart/repos/wiki-master/eval/skill-coverage/2026-09-11-pre/without.md` (this file)

**Explicit statements:**
- I did **not** read any file under `skills/` — no `SKILL.md`, no reference file, no script
  belonging to any skill.
- I did **not** read any `scenarios.json`.
- I did **not** read any rubric, grading criteria, or required-actions list.
- I did **not** read any test file.
- I did **not** read any prior evaluation artifact, transcript, or other file under `eval/`
  beyond the two named above.
- I did **not** read anything under `docs/`.
- I did **not** invoke any skill via the Skill tool, so no skill instructions entered my context
  by that route either.
- I ran no commands against any vault; everything above is stated intent, not execution.

**Context I inherited that I did not choose to load** (unavoidable, disclosed for completeness):
- The system prompt's **available-skills listing**, which includes the same wiki-master skill
  names with the *same one-line descriptions* as `eval/skill-catalog.md`, plus unrelated
  non-wiki skills (superpowers, agent-stalker, artifact tooling, and similar). This is the
  harness's standard listing, not skill instructions: it carries names and descriptions only,
  at the same level of detail as the catalog I was told to read.
- `C:/Users/ehart/.claude/CLAUDE.md` (global user instructions: options must spell out
  time/risk/complexity/best-practice/maintainability; never commit to the default branch of the
  main checkout; the wiki is the source of truth). This shaped the branch-not-main and
  ask-before-irreversible-action posture above.
- The user's auto-memory index at
  `C:/Users/ehart/.claude/projects/C--Users-ehart-repos-wiki-master/memory/MEMORY.md` — two
  one-line entries ("accuracy over dependency count"; "verify against real documents"). Only the
  index lines were in context; I did not open the linked memory files.
- Repo git status snapshot (branch `main`, clean, recent commit subjects) supplied by the harness.
- Ambient environment facts: date 2026-09-11, Windows 11, PowerShell, repo root, scratchpad path.

No skill body, rubric, or expected-action list informed any scenario section. The reasoning above
is derived solely from the one-line catalog descriptions, the per-scenario facts, and general
engineering judgment.
