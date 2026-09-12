# Skill-coverage run — 2026-09-11-post (with references)

Simulation. Nothing below was executed against a real vault; each scenario states the
ordered actions I would take, the response I would send, and where I would stop.

Common to every scenario (done once per session, before scenario 1):

- Read `skills/wiki-maintainer/SKILL.md` — the shared core.
- Resolve the plugin root from the *installed skill* location, not the cwd. Every
  scenario names `C:/plugins/wiki-master`, so helper paths are quoted absolutes such as
  `C:/plugins/wiki-master/scripts/health.mjs`. Scenario 1 in particular has an unrelated
  cwd (`C:/work/widget`) — a relative `scripts/...` there would be the wrong repo.
- Set the vault per-operation in PowerShell with the prior value restored in `finally`,
  per the access reference's shell-portability block.
- Read the vault's own `AGENTS.md` and schema before any edit.

---

## Scenario: spreadsheet-clip

Ordered intended actions:

1. **Route the file type before doing anything.** `C:/drops/kestrel-metrics-q3.xlsx` is a
   workbook, so this is `clip-xlsx`, not `clip-pdf` and not `wiki-discover`'s HTML clipper.
   I explicitly do **not** convert the workbook to PDF and run `clip-pdf`: a PDF pipeline
   rebuilds row/label pairing from horizontal position, and in a metrics workbook the
   pairing *is* the content — a flattened table reads clean while pairing the wrong number
   with the wrong label.
2. **Resolve paths from the installed skill, not the cwd.** Plugin root
   `C:/plugins/wiki-master`; vault `C:/vault`. The cwd `C:/work/widget` is unrelated and is
   never used to resolve `scripts/`.
3. **Check the authorization envelope before writing.** The user authorized *capturing*
   this file, not adding it to wiki pages. So: clip is in scope; `/wiki-ingest` is not.
   I note this now because it determines where I stop, not at the end.
4. **Check for an enclosing operation.** The file belongs to an in-progress research run.
   If that run already owns an open operation, I use it and report results to its owner
   rather than opening a second one. If this invocation is standalone (no live operation),
   I open one before the clipper writes:
   `node "C:/plugins/wiki-master/scripts/op-begin.mjs" --op discover` and keep the token.
5. **Preflight both converters** (step 1 of the skill), in PowerShell, by bare name so
   PATHEXT selects the console shim `soffice.com` rather than the GUI `soffice.exe`:
   ```powershell
   soffice --version
   pandoc -v
   ```
   Facts say both are installed, so this passes. Had LibreOffice been missing, that is
   fatal: I would point at https://www.libreoffice.org/download/ and stop — never retype
   cells by hand or infer values.
6. **Clip.** `clip-xlsx.mjs` is the sole writer to `raw/` for workbooks; I do not hand-write
   the clipping (that would bypass dedup, decline recording and hashing, and the ingest
   backlog joins on exactly that hash). I also do not shell out to `soffice`/`pandoc`
   myself — the script drives them through `execFileSync`.
   ```powershell
   $wikiPriorVault = $env:WIKI_MASTER_VAULT
   try {
     $env:WIKI_MASTER_VAULT = 'C:/vault'
     node "C:/plugins/wiki-master/scripts/clip-xlsx.mjs" "C:/drops/kestrel-metrics-q3.xlsx" --quality=high --topic="Kestrel offline rollout"
     if ($LASTEXITCODE -ne 0) { throw 'clip-xlsx failed' }
   } finally { $env:WIKI_MASTER_VAULT = $wikiPriorVault }
   ```
   - **`--source` is omitted deliberately.** There is no canonical URL, so the file path is
     recorded as the source. I never invent a URL to fill the field.
   - **`--topic="Kestrel offline rollout"` is the load-bearing flag.** Topic is recorded
     going forward only and no tool can retro-fit it; a clip made without it is an
     *Unattributed* triage row permanently, and the whole point of the topic string is that
     `/wiki-triage` can later group this run's leftovers together. I pass the run's exact
     string, identical to every other clip in the run.
   - `--quality=high` is my credibility judgment of the workbook as a *source* (first-party
     quarterly metrics), which is a separate judgment from how cleanly it extracted.
7. **Verify the capture rather than trusting the exit code.** Read the returned
   `raw/clippings/<slug>.md` and confirm each sheet came through as a real table with its
   labels still attached to its values. Conversion is lossy on formulas, merged cells,
   charts and multi-row headers — it captures rendered values, not the model behind them.
   Two specific outcomes I check for:
   - a **`thin` result** (under 100 words) records a decline. `clip-xlsx` has no
     `--allow-short` escape hatch, so I would say plainly that the clip did not succeed and
     that the decline needs clearing or the content capturing another way — not report it
     as a success.
   - a **duplicate** — dedup is by content hash, not path, so a renamed copy of a workbook
     the vault already holds comes back recognized rather than clipped twice. I report that
     outcome as-is.
8. **Close the operation** through the shared completion contract: validate the returned
   paths and extraction diagnostics, `log-entry.mjs --op discover` once with a short
   narrative, then `op-commit.mjs --op discover --title ... --since $token`. Inspect the
   actual changed paths; never `git add -A`. Sync is not authorized in these facts, so I
   report the unpushed commit rather than pushing.
9. **Stop at the ingest boundary.** Capturing evidence does not by itself authorize
   ingestion, and no discover-and-ingest authorization exists in this session.

Sample user response after a successful path:

"Clipped as a spreadsheet, not via PDF — a metrics workbook run through a PDF pipeline
re-derives which number belongs to which label from column position, which is exactly the
failure that matters here.

`C:/drops/kestrel-metrics-q3.xlsx` → `raw/clippings/kestrel-metrics-q3.md` (LibreOffice →
pandoc, `--wrap=none`). I tagged it `topic: Kestrel offline rollout` so it groups with the
rest of that research run in triage — that field can only be set at clip time, never added
later. No `source:` URL was set, because there isn't one; the local file path is recorded
as the origin. Quality: high, as a first-party metrics workbook.

I read the clipping back: all N sheets are present as tables with their row labels intact.
Worth knowing, the conversion keeps rendered values only — formulas, merged cells and
charts do not survive, so verify any specific figure against the workbook before it lands
on a page.

Operation logged and committed; not pushed, since sync isn't authorized here.

I stopped before ingest. You authorized capturing this file, not adding it to wiki pages —
say the word and I'll run `/wiki-ingest` on it to produce a `wiki/sources/` summary."

Stop condition: the clipping exists at a verified path under `raw/clippings/`, carries the
topic string and a real `source-hash`, reads back with labels attached to values, and the
operation is logged and committed. I stop instead — and say so — at any of: LibreOffice
missing (install pointer, no hand transcription); the workbook itself failing to convert
(corrupt or password-protected → report for manual handling, never invent cells); a `thin`
decline (no override exists on this path); or the ingest boundary, which is the blocker
these facts actually reach.

---

## Scenario: purge-orphan-lineage

Ordered intended actions:

1. **Confirm the ask is the purge ask.** The user said removal is intended and permanent,
   and named a topic — that is `wiki-purge`, not `wiki-relink`. Intent stated up front is
   still not plan approval; approval is of a specific file list, later.
2. **Check the git lineage *before* touching the vault.** This is the one of the four
   resurrection paths that purge cannot close by construction, and the facts describe it
   exactly: origin was force-updated last week, this clone has not pulled since.
   ```
   git -C C:/vault fetch
   git -C C:/vault merge-base HEAD origin/main
   ```
   No output plus a non-zero exit means the two lineages share no merge base — the clone is
   orphaned. Nothing I do inside a purge reaches the other machines in that state: the
   purge would succeed locally, commit, and be invisible everywhere else, and the topic
   would appear to the user to keep coming back.
3. **Stop there.** I do not run `--reconcile` (it commits), do not run `--plan`, and do not
   run `--apply`. Which history is canonical is a decision about the repository, not one to
   make inside a purge, and I am not going to make it silently by committing onto the dead
   lineage.
4. Report the finding with the concrete evidence (fetch succeeded, `merge-base` empty and
   non-zero) and name the decision the user has to make: reconcile onto origin's rewritten
   history, or declare this clone canonical and re-publish. Offer to re-run the purge
   immediately once the lineages are reconciled.

If the merge-base check had passed, the run would continue as follows (stated so the stop
above is understood as a detour, not an abandonment):

5. Baseline `node "C:/plugins/wiki-master/scripts/health.mjs"` and record the **broken links**
   line, so step 11's verification has something to compare against.
6. `node "C:/plugins/wiki-master/scripts/purge.mjs" --reconcile` — sweeps anything an
   earlier purge lost on this machine; cheap and silent on a clean vault; owns its commit.
7. `node "C:/plugins/wiki-master/scripts/purge.mjs" --plan "Project Kestrel"` — moves
   nothing.
8. **Read the seed list first, before reading the plan.** Ranking has no notion of "relevant
   enough" — fusion scores carry no absolute meaning, so the tail of a long seed list drifts
   into adjacent topics, and every off-topic seed drags its exclusive evidence into the bin.
   I strike anything that isn't Kestrel and re-run pinned:
   `--plan "Project Kestrel" --seeds "wiki/concepts/A.md,wiki/entities/B.md,..."` (paths are
   vault-relative and validated; a typo is refused, not silently narrowed).
   If `--plan` returns no wiki pages, I trust its own message about backend reachability
   rather than concluding the topic doesn't exist.
9. **Settle the two human-decision lists explicitly.**
   - **BLOCKING** — the three pages whose every cited source is inside the purge set.
     `--apply` refuses while any exist, and rightly: a claim with no evidence is a defect,
     so the choice is add those three pages to the purge or keep their sources. I put that
     choice to the user as a choice, named page by page; purge will not decide it silently
     in either direction and neither will I.
   - **COLLATERAL** — the adjacent pages that survive but link into the set. They need
     reference repair in step 10.
   Then read the plan back grouped by layer with counts, naming the blocking and collateral
   pages specifically, and get an explicit yes. The closure reaches further than people
   expect on a densely linked topic.
10. `--apply "Project Kestrel" --seeds "<the same pinned seeds that were approved>"`. It
    writes the manifest, moves files, records declines (which is what stops `/wiki-discover`
    re-finding and re-clipping the sources), logs and commits, staging only what it touched.
    Then, as a *separate* ordinary operation — the purge transaction must not be wrapped in
    a competing commit: `op-begin --op relink`, repair references on every COLLATERAL page
    the log entry lists, `index-gen.mjs`, validate, `log-entry.mjs`, `op-commit --since
    <token>`, preserving already-dirty files and never `git add -A`.
11. **Ask before pushing** — plainly, "push this purge to origin?" — and run
    `git -C C:/vault push` only on a yes, holding both commits until then.
12. **Verify on the broken-link count, not the score.** Re-run `health.mjs` and compare the
    broken-links line to the step-5 baseline; it must not have grown. The score is the wrong
    instrument here: purging an orphan removes an orphan penalty, and the dangling links a
    skipped repair leaves behind classify as `deferred` and go unscored, so an unrepaired
    purge can move the score *up*. `obsidian unresolved verbose format=json` also lists them
    attributed to the pages carrying them.

Sample user response after a successful path — which here means correctly refusing to purge:

"I stopped before planning anything, because this clone can't publish a removal.

`git -C C:/vault fetch` succeeded, but `git merge-base HEAD origin/main` returned nothing
with a non-zero exit — this clone and origin share no common ancestor at all. That matches
what you described: origin was force-updated during last week's history cleanup and this
clone hasn't pulled since, so it's still sitting on the pre-rewrite lineage.

Why that blocks a purge specifically: a purge run from an orphaned clone *works*. Files
move, declines get recorded, it commits — and none of it ever reaches your other machines,
because the commit lands on a history origin no longer has. The symptom you'd see is Project
Kestrel apparently coming back, over and over, and nothing in the purge output would hint at
why.

Which history is canonical is a call I shouldn't make from inside a delete command. Two
options: reconcile this clone onto origin's rewritten history (it'll be an unrelated-histories
merge, not an ordinary conflict), or decide this clone is the real one and re-publish it.

Once that's settled, tell me and I'll pick straight back up: reconcile sweep, then a planned
purge I read back to you before anything moves. Worth flagging now so it isn't a surprise —
you mentioned three pages whose only sources are Kestrel sources. Those will come back as
BLOCKING and the purge will refuse to run until you decide whether they go too or keep their
evidence."

Stop condition: done only when the topic's wiki pages, raw evidence and source declines are
removed in one committed transaction, collateral references are repaired in a following
operation, the catalog is regenerated, publication is explicitly approved, and the broken-link
count has not grown against a pre-purge baseline. The specific blocker here is step 2 — no
merge base with `origin/main` — and I stop there without running `--reconcile`, `--plan` or
`--apply`. Secondary blockers I would also stop at: BLOCKING pages unresolved by the user;
`--apply` halting partway on a Windows file lock (close the holder, then run `--reconcile`,
never re-run `--apply`, which would open a second empty purge and commit a manifest claiming
a purge it did not perform).

---

## Scenario: triage-queue

Ordered intended actions:

1. **Classify the request as read-only.** "What sources need my attention" is the disposition
   queue. Nothing is authorized to change, and starting the triage UI is not a content edit —
   so I open no operation, write no log, refresh no index, and make no commit.
2. **Start the queue server** from the plugin root with the vault scoped for the command:
   ```powershell
   $wikiPriorVault = $env:WIKI_MASTER_VAULT
   try {
     $env:WIKI_MASTER_VAULT = 'C:/vault'
     node "C:/plugins/wiki-master/scripts/triage.mjs"
   } finally { $env:WIKI_MASTER_VAULT = $wikiPriorVault }
   ```
   **No `--remote`.** The user is at their desk on this machine, so loopback-only is right;
   `--remote` binds every interface and would put the session token on the wire in cleartext
   for no benefit here.
   Re-running is safe: the server reuses one session directory per vault
   (`.wiki-master/triage-ui/`) and refreshes the open page rather than starting a second
   server. It idles out after 30 minutes.
3. **Parse the single JSON line** it prints — `{"type":"triage-ready","link":...,"url":...}`
   plus counts — and hand the user **`link`**, never `url`. Every route sits behind a session
   token and only `link` carries it; `url` is the clean form for liveness checks and logs and
   renders a 401 on its own. If the user later says they lost the link, I re-read the token
   from `.wiki-master/triage-ui/state/token` and rebuild the link — I do not regenerate it,
   because that invalidates the link they already have.
4. **Read the counts the way the queue is actually acted on**: grouped by kind, but led with
   the **research-topic breakdown** when there is more than one topic, since the real decision
   is "deal with what the Kestrel sweep left behind", not "deal with all fidelity flags". If a
   large **Unattributed** group shows up I explain it rather than presenting it as a defect:
   topic is recorded going forward only, so anything clipped before topics existed or outside
   a research run lands there and no tool can retro-fit it.
5. **Get the ingest backlog number from the right place** — read-only:
   `node "C:/plugins/wiki-master/scripts/health.mjs" --backlog`, whose not-ingested count is
   `unsummarizedSources`, a content-hash join between each clipping's `source-hash` and the
   `source-hashes` recorded on `wiki/sources/` pages. I do **not** re-derive it by searching
   `tag:clippings` and hand-diffing `wiki/sources/` — that fuzzy link-resolution is precisely
   the drift the hash join replaced, and it manufactures phantom backlog. I also don't count
   binary originals (`.pdf`/`.xlsx`) as backlog; only `.md` clippings are ingestable units.
6. **Summarize honestly and end the turn.** The backlog group in the UI is capped for display
   and says so — I never present a truncated list as the whole set. I characterize the 403s as
   transient failures rather than declines (a 403 is a fact about one fetch; a decline is a
   judgment, and filing one as the other buries a recoverable source under a 180-day TTL). The
   user dispositions in the browser; I read `<vault>/.wiki-master/triage.jsonl` back next turn
   by folding the append-only log with `loadIssueLog`/`openIssues`, and only then — with their
   choices in hand and an operation opened — would anything be written.

Sample user response after a successful path:

"Queue's up — open this once and the browser holds the session for 30 days:

http://localhost:PORT/?t=…

What's waiting, by research topic first, since that's usually how you want to work through it:

- **Kestrel offline rollout** — N failed clips (the 403s), 1 fidelity flag
- **Unattributed** — the paywalled SPA, 2 declines nearing expiry
  (Unattributed just means those were clipped before topics were recorded, or outside a
  research run; it isn't something to fix.)
- **Ingest backlog** — M clippings the wiki cites nowhere yet. The UI caps that group for
  display, so treat its list as a sample, not the full set; M is the real count.

Two things worth knowing before you start. The 403s are failed fetches, not judgments — they
want a retry or a signed-in browser, so please don't decline them; a decline buries a
recoverable source for 180 days. The paywalled SPA is the opposite case and is the one I'd
actually settle by hand.

I haven't changed anything — this is read-only. Disposition what you want in the browser and
tell me when you're done; I'll read your choices back and act on them then."

Stop condition: done when the user has a token-bearing link, an honest count per kind and per
topic, and knows nothing has been written. I stop at the browser handoff by design — acting on
any disposition that changes tracked content or pipeline state needs an operation opened and
authorization that these facts do not grant. I would also stop and say so if `triage.mjs`
could not bind a port or the queue came back empty while the log showed open issues.

---

## Scenario: unsupported-claim-query

Ordered intended actions:

1. **Pick the skill by what is being asked.** This wants a synthesized, cited answer *and* an
   assessment of support — `wiki-query`, not `wiki-search` (which would only hand back a page
   list). Retrieval itself is still `wiki-search`'s job, so I load that skill and use it for
   step 2 rather than reimplementing its diagnostics logic.
2. **Search, with raw included**, since a recent guarantee may exist only as an unprocessed
   clipping:
   ```powershell
   $wikiPriorVault = $env:WIKI_MASTER_VAULT
   try {
     $env:WIKI_MASTER_VAULT = 'C:/vault'
     node "C:/plugins/wiki-master/scripts/search.mjs" "Kestrel offline sync guarantees" --include-raw --json --limit=10
   } finally { $env:WIKI_MASTER_VAULT = $wikiPriorVault }
   ```
3. **Read the stderr status line before trusting any result.** The facts say it reports
   `lexical`, not `hybrid`, because the embedder is unavailable — so semantic ranking
   contributed nothing to this ranking, and coverage may be incomplete even though the hits
   returned are real. That goes *in the answer*, not in my head: a user reading a confident
   synthesis has no way to know the retrieval underneath it was degraded. I also read the
   raw/ hit-count line (it always discloses, including an explicit `0`), and I treat a
   degraded channel as evidence about coverage, not about relevance. Optionally
   `search.mjs --health` to name precisely what is off (Ollama down, model not pulled, or
   index not built) so the disclosure is specific rather than vague — read-only, so no
   operation.
4. **Read each hit from its matched `path:line` outward**, not from the top of the page —
   that line is the passage that actually matched. Inspect the JSON metadata too: type,
   status, `reviewed` date, and decision/backlog state, so I don't describe a proposed
   guarantee as current behavior.
5. **Verify the citation trail rather than assuming it.** Pipe the hits through
   `node "C:/plugins/wiki-master/scripts/resolve-evidence.mjs"`. Given these facts this is
   the step that earns its keep: the second page's `sources:` link is broken, so it comes
   back **`unreachable`** — a genuine provenance gap in the same vocabulary `health.mjs`
   uses, reported plainly instead of silently omitted. That is a fact about support, and it
   goes in the answer.
6. **Read the first page's evidence — the degraded capture — and respect its scope edges.**
   A degraded capture is authoritative for what the vault *holds*, not for what the author
   typed; it cannot be trusted at character level, so it cannot establish an exact quote or
   an exact numeric guarantee. If either page states the guarantee as a verbatim quote or a
   precise figure, that specific claim is unsupported at the level it is stated, even though
   the clipping is real evidence that the topic was captured.
7. **Answer with citations and disclose, rather than papering over.** Cite the two pages and
   the raw clipping by path. State the support assessment separately from the claim itself.
   Keep the two pages' statements attributed and separate if they differ rather than merging
   them into one confident voice. And say the thing that is easy to get wrong in both
   directions: a clipping's silence, and a broken trail, prove *"not supported here"* — never
   *"false"*. I am not asserting the guarantee is wrong; I am saying the vault cannot
   currently back it.
8. **Write nothing.** No write is authorized, so no operation is opened, no log written, no
   index refreshed — an unfiled answer opens no operation. I offer to file the assessment as
   a synthesis and to queue the two defects (the broken `sources:` link for `/wiki-relink` or
   `/wiki-lint`, the degraded capture as a fidelity row for `/wiki-triage`), and wait for a
   yes; queuing a triage row is itself a change to pipeline state.

Sample user response after a successful path:

"Short version: the wiki states the guarantee in two places, and neither citation currently
holds up. That is not the same as the guarantee being wrong.

**What it says**

- `wiki/concepts/<Kestrel Offline Sync>.md:NN` — states the guarantee as <…>.
- `wiki/syntheses/<…>.md:NN` — states it as <…>.

**How well it's supported**

- The first page's only evidence is `raw/clippings/<…>.md`, which was recorded as a
  **degraded capture**. That clipping is genuine evidence the vault holds this source, but a
  degraded capture can't be trusted at character level — so it can't establish the exact
  wording or the exact figure the page states, only that the topic was captured.
- The second page's `sources:` link doesn't resolve. `resolve-evidence.mjs` reports it
  **unreachable** — the citation trail dead-ends before it reaches `raw/`. So that page is,
  right now, an uncited claim.
- So the honest position: two pages assert this, zero of them currently walk back to
  verifiable evidence. Absence of support isn't proof the guarantee is false — the vault just
  can't back it as stated today.

**One caveat about the search itself.** Retrieval ran in `lexical` tier, not `hybrid` — the
embedder is unavailable, so semantic ranking contributed nothing. The hits above are real, but
a third page phrased differently could have been missed. Worth re-running once the embedder is
back if this matters.

I haven't changed anything. If you want, I can file this assessment as a synthesis, and queue
the broken `sources:` link and the degraded capture for repair — both need your go-ahead."

Stop condition: done when the answer cites the pages and evidence it rests on, names the
degraded capture and the unreachable trail as support defects, and discloses the lexical tier —
with nothing written. The blocker is authorization: I stop before filing the synthesis and
before recording triage rows. I would also stop and say so, rather than guess, if `search.mjs`
failed outright instead of degrading — an unavailable channel returning zero hits does not
establish that the wiki holds no knowledge on this.

---

## Scenario: relink-scope

Ordered intended actions:

1. **Scope the request honestly before opening anything.** "Fix the broken links" authorizes
   mechanical link repair. It does not ask me to grow the graph, so I do steps 0–2 and 4–5 of
   the relink workflow and deliberately skip the relationship-candidate pass — adding new
   `## Relationships` links would be unrequested judgment work, and links should never be
   grown merely to improve a graph score.
2. **Find the user's uncommitted work first.** `git -C C:/vault status --porcelain` to identify
   the two pages they are editing right now. I need these names before I open the operation,
   because they determine what I must not touch.
3. **Open the operation before the first write**, saving the token:
   `node "C:/plugins/wiki-master/scripts/op-begin.mjs" --op relink`
   It snapshots already-dirty paths and `op-commit` excludes them, which is exactly what keeps
   the user's in-progress writing out of my commit. What it does **not** do is isolate
   simultaneous edits to the same file — so if a broken link turns out to live *inside* one of
   those two dirty pages, I leave that one alone and report it rather than editing underneath
   the user. Never `git add -A` in a vault.
4. **Report the defects.** `node "C:/plugins/wiki-master/scripts/health.mjs"` for unresolved
   links and orphans — reading Obsidian's `orphans` with care, since it counts catalog links
   and can hide genuinely stranded pages. Record the unresolved-link count as the baseline I
   will verify against in step 10.
5. **Clear the mechanical class first — hard-wrapped wikilinks.** Dry run, then apply:
   ```
   node "C:/plugins/wiki-master/scripts/repair-wrapped-links.mjs"
   node "C:/plugins/wiki-master/scripts/repair-wrapped-links.mjs" --apply
   ```
   A `[[Target\ncontinued]]` produced by word-wrapping can never resolve — Obsidian wikilinks
   cannot span a line break — so it is always a defect and never a judgment call. The fix is a
   lossless whitespace collapse that guesses nothing. The one shape it cannot settle alone —
   a hyphen glued to the word before the break, `[[Diagno-\nstics]]`, character-identical to a
   title that legitimately ends in a hyphen — is checked against the real page index and left
   untouched and reported when more than one reading resolves. I pass those to the user for
   review rather than picking one. Clearing this class first is what keeps the rest of the run
   focused on links that genuinely need a decision.
6. **Repair the other broken-link classes health reports, each dry-run then `--apply`, and only
   the ones that actually fired:**
   - `provenanceGaps > 0` → `repair-provenance-links.mjs`. These are title-shaped citations:
     ingest wrote `sources: ["[[<title>]]"]` while the clipper had already slugified that title
     into the filename, so any title with `/`, `:`, `#` or over 120 chars cites a file that does
     not exist. The repair joins on `source-hash`, never on the title — the title is the thing
     that drifted — and reports anything it cannot pin to exactly one clipping instead of
     guessing. These are broken links in the truest sense, so they are in scope.
   - frontmatter that Obsidian reports as "No frontmatter found" → `repair-sources-order.mjs`,
     for the `source-hashes:` inserted between a block-list `sources:` key and its own items.
     Pure string surgery on that one shape, idempotent.
   - `backfillPending > 0` I **report but do not run**. That is a vault migration, not a broken
     link, and it is not what was authorized here.
7. **Separate ambiguous identity from missing connection** for the unresolved links that remain:
   `node "C:/plugins/wiki-master/scripts/identity-audit.mjs" --limit=20 --json`. For each
   remaining unresolved target I search the intended title *and* its equivalent aliases before
   doing anything — if a canonical page already exists I point the link at it; I do not create a
   new page just to satisfy a link, and I do not merge two concepts because their names or
   embeddings look similar. Ambiguous names get full-path wikilinks. Anything I am unsure about
   goes back to the user rather than being resolved on a coin flip.
8. **Preserve the dates.** This is mechanical repair, so `updated` moves and `reviewed` does
   **not** — nothing here verified a factual claim against evidence. I also write any touched
   line as an unwrapped logical line, never re-introducing the wrap that caused the defect.
9. **Refresh, log, commit.** `node "C:/plugins/wiki-master/scripts/index-gen.mjs"` for the
   catalog (never hand-editing a generated fence), then one log entry and the operation commit:
   ```
   'Repaired N unresolved links: M hard-wrapped, K title-shaped citations; 2 pages left untouched (user edits in progress)' | node "C:/plugins/wiki-master/scripts/log-entry.mjs" --op relink --title 'Repair unresolved links'
   node "C:/plugins/wiki-master/scripts/op-commit.mjs" --op relink --title 'Repair unresolved links' --since $wikiOpToken
   ```
   Then **inspect what it actually committed** — specifically that the user's two files are not
   in it — and read its notices for a skipped or partial semantic index refresh. A commit does
   not establish index freshness. `op-commit` also reports any hard-wrapped wikilink still
   present in the files it just committed, which catches one introduced after step 5 ran.
10. **Verify and publish.** Re-run `health.mjs` and confirm the unresolved-link count actually
    fell against the step-4 baseline. The vault's own instructions authorize publishing, so I
    push without asking again — reusing existing authorization rather than re-litigating it —
    and verify the result and upstream state: `git -C C:/vault push`. A rejected push is a real
    stop; I would report it, not force it and not claim success.

Sample user response after a successful path:

"Broken links repaired and pushed.

- **M hard-wrapped wikilinks** fixed — these were `[[Target …\n… continued]]` from paragraphs
  that got word-wrapped. They can never resolve, so it's a lossless un-wrap, no guessing.
- **K title-shaped citations** fixed — `sources:` entries pointing at a source's *title* while
  the file on disk carries the slugified name. Repaired by matching `source-hash`, not by
  matching titles.
- **Unresolved links: X → Y** (health re-run after the commit).

Three things I left for you rather than deciding:

1. Two pages you're currently editing (`<path A>`, `<path B>`) were excluded from the
   operation entirely. `<path A>` does carry one unresolved link — I didn't touch it, since
   you have unsaved work there. Say the word once you're done and I'll fix it.
2. One wrapped link is genuinely ambiguous: `[[Diagno-\nstics]]` could be `Diagnostics` or a
   title that really does end in a hyphen. More than one reading resolves against the page
   index, so the tool left it and so did I.
3. J unresolved links point at pages that don't exist under any name or alias I could find.
   I didn't create stubs to satisfy them — that manufactures pages nobody asked for. They're
   listed in the log entry if you want to work through them.

Also worth noting but out of scope for "fix broken links": `backfillPending` is non-zero, so
this vault hasn't had the `source-hashes` migration run on it. That's a one-time job
(`backfill-source-hashes.mjs`, dry-run then apply, idempotent) and it repairs every machine
once committed. Happy to run it — just not under a link-repair mandate."

Stop condition: done when the unresolved-link count has measurably fallen against the pre-run
baseline, the catalog is regenerated, exactly one relink log entry exists, the operation commit
is verified to contain my paths and **not** the user's two dirty pages, and the authorized push
is confirmed against upstream. I stop and report instead of proceeding if: a repair target is
inside one of the user's uncommitted pages; `op-commit` shows it swept up work that wasn't
mine; a repair script reports an ambiguity it cannot settle; or the push is rejected.

---

## References loaded per scenario

| Scenario | References loaded | Conditional reference deliberately SKIPPED, and the condition I judged did not fire |
|---|---|---|
| spreadsheet-clip | core `SKILL.md`, `references/access.md`, `references/operations.md`; skill body `skills/clip-xlsx/SKILL.md` | **`evidence.md`** — condition is "before a quote or figure from this capture lands on a wiki page, or when reporting a fidelity limit". Neither fires: ingest is explicitly not authorized so no figure reaches a page this run, and the facts describe a clean capture with both converters installed — no thin decline, no failed conversion, no fidelity limit to report. I would read it the moment step 7 showed damaged label/value pairing, or when ingest is later authorized. |
| purge-orphan-lineage | core, `access.md`, `evidence.md`, `operations.md`; `skills/wiki-purge/SKILL.md` | None — the purge preamble names all three unconditionally, with no conditional reference. |
| triage-queue | core, `access.md`, `references/maintenance.md`; `skills/wiki-triage/SKILL.md` | **`operations.md`** — condition is "only when you apply reclips or otherwise write; presenting the queue writes nothing". The request is read-only, nothing is authorized to change, and starting the UI creates only machine-local session state. I would read it next turn if the user dispositioned rows that change tracked content or pipeline state. |
| unsupported-claim-query | core, `access.md`, `evidence.md`; `skills/wiki-query/SKILL.md` and, as its step 1 directs, `skills/wiki-search/SKILL.md` | **`efficacy.md`** — condition is "when the question spans topics and you must verify a relationship link". It doesn't: one topic, two pages asserting the same guarantee, and the support assessment runs through citation trails, not relationship edges. **`operations.md`** — condition is "only if filing the answer is authorized". No write is authorized; an unfiled answer opens no operation. Both would fire if the user accepted my offer to file the synthesis. |
| relink-scope | core, `access.md`, `efficacy.md`, `operations.md`, `references/maintenance.md`; `skills/wiki-relink/SKILL.md` | **`evidence.md`** — condition is "before a relationship claim rests on a cited source". This run is mechanical link repair; I explicitly scoped out the relationship-candidate pass, so no relationship claim is made and none rests on a source. `maintenance.md` was **loaded**, not skipped: its condition ("when repairing wrapped links, citation shapes or ordering") is exactly this run — wrapped wikilinks, title-shaped citations and `sources:`/`source-hashes:` ordering are three of the four defect classes here. |

Net: every unconditional reference was read, one conditional reference was read because its
condition fired (`maintenance.md` for relink-scope), and five conditional reads were
deliberately skipped across four scenarios. No reference was read "to be safe".

---

## Files loaded and inherited exposure

Files I read, in order:

1. `eval/skill-coverage/2026-09-11-post/skill-catalog.snapshot.md`
2. `eval/skill-coverage/prompts.json`
3. `skills/wiki-maintainer/SKILL.md`
4. `skills/clip-xlsx/SKILL.md`
5. `skills/wiki-purge/SKILL.md`
6. `skills/wiki-triage/SKILL.md`
7. `skills/wiki-query/SKILL.md`
8. `skills/wiki-relink/SKILL.md`
9. `skills/wiki-maintainer/references/access.md`
10. `skills/wiki-maintainer/references/operations.md`
11. `skills/wiki-maintainer/references/maintenance.md`
12. `skills/wiki-maintainer/references/evidence.md`
13. `skills/wiki-maintainer/references/efficacy.md`
14. `skills/wiki-search/SKILL.md` — read because `wiki-query`'s own step 1 directs loading it
    for retrieval rather than reimplementing its diagnostics logic.

One directory listing: `ls scripts/` — filenames only, no file contents, to confirm the helper
scripts each skill names actually exist under the plugin root (`clip-xlsx.mjs`, `purge.mjs`,
`triage.mjs`, `search.mjs`, `resolve-evidence.mjs`, `repair-wrapped-links.mjs`,
`repair-provenance-links.mjs`, `repair-sources-order.mjs`, `identity-audit.mjs`, `health.mjs`,
`op-begin.mjs`, `op-commit.mjs`, `log-entry.mjs`, `index-gen.mjs` — all present).

Deliberately **not** read, despite being pointed at: `docs/wiki-efficacy.md`, referenced by the
last line of `references/efficacy.md`. It is under `docs/` and out of bounds for this run; the
scenarios did not require its command contracts.

Inherited exposure, stated plainly:

- **Did I see any `scenarios.json`?** No. I read `prompts.json` only, which was named in my
  instructions.
- **Any rubric, required/forbidden action list, or grading criteria?** No.
- **Any test file?** No. `scripts/evaluate-skill-behavior.mjs` and
  `scripts/evaluate-retrieval.mjs` appeared as *filenames* in the `ls scripts/` output; neither
  was opened.
- **Any prior evaluation artifact?** No. Nothing under `eval/skill-coverage/2026-09-11-pre/`,
  `eval/skill-coverage/recheck-spreadsheet/`, `eval/skill-behavior/` or `eval/cli-safeguards/`
  was read or listed. The only paths I touched under `eval/` are the two named in my
  instructions plus this output file.
- **Other inherited context**, for completeness: the session's system prompt carried a list of
  installed skill *names and one-line descriptions* (the same surface as the catalog snapshot),
  the repo's git status and recent commit subjects, and the user's global `CLAUDE.md`. None of
  these describe scenario expectations. I did not read `CLAUDE.md`'s referenced memory files, any
  `AGENTS.md`, or any skill not listed above.
