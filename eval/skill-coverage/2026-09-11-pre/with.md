# Skill-coverage simulation — WITH-SKILLS condition

Mode: simulation. Nothing below was executed against a real vault. Each section is
the ordered sequence of actions I would take and the message I would send.

Shared preamble that applies to all five scenarios (done once per session, not
repeated per scenario below):

- Read `wiki-maintainer/SKILL.md` once, then only the references the specific
  operation links to — not all of them.
- Resolve the plugin root from the installed skill directory (two parents up),
  **not** from the current working directory. In these scenarios that is
  `C:/plugins/wiki-master`, so every helper is invoked as
  `node "C:/plugins/wiki-master/scripts/<script>.mjs"`. A bare `scripts/...` would
  resolve against the user's workspace and is never used.
- Set the vault for the operation's scope in PowerShell and restore the prior
  value afterwards:

  ```powershell
  $wikiPriorVault = $env:WIKI_MASTER_VAULT
  try {
    $env:WIKI_MASTER_VAULT = 'C:/vault'
    # ... operation ...
  } finally {
    $env:WIKI_MASTER_VAULT = $wikiPriorVault
  }
  ```
- Start at the known vault root (`C:/vault`). Never search the disk for a vault.
- Read-only work opens no operation, writes no log, commits nothing, and does not
  refresh the index.

---

## Scenario: spreadsheet-clip

**Coverage note up front: the installed catalog has no spreadsheet clipping skill.**
It ships `clip-confluence`, `clip-docx`, `clip-gh`, `clip-pdf` and `clip-pptx`.
An `.xlsx` is none of those. I will not route a workbook through `clip-docx` or
`clip-pdf` because they are the Word and PDF paths and each names the other
formats as out of scope; and I will not hand-write a clipping, because for every
format the clipper script is the *sole* writer to `raw/` — writing by hand would
bypass dedup, the decline log, and `source-hash`, which is what the ingest
backlog joins on.

Ordered intended actions:

1. Recognize the format from the path `C:/drops/kestrel-metrics-q3.xlsx` and
   check the catalog before picking a route. No `clip-xlsx` skill is installed.
2. Before declaring it unsupported, check whether the **helper** exists even
   though no skill wrapper does — `wiki-discover`'s Phase 3 names
   `clip-xlsx.mjs` alongside `clip-pdf.mjs` and `clip-docx.mjs` as the binary
   routes, so the script plausibly ships with the plugin:
   `Test-Path 'C:/plugins/wiki-master/scripts/clip-xlsx.mjs'`
   I look under the resolved plugin root `C:/plugins/wiki-master/scripts`, not
   under the unrelated cwd `C:/work/widget`.
3. **Branch A — `clip-xlsx.mjs` exists.** Read it far enough to confirm its flags
   (`--source`, `--quality`, `--topic`) and what it does on a thin extraction,
   then proceed:
   a. Confirm the vault layout at `C:/vault` and read `C:/vault/AGENTS.md` and the
      schema before any write, per the access contract.
   b. This is a standalone clip, and clipping writes to `raw/` — so open an
      operation *before* the helper writes, using the existing vocabulary:
      `$tok = node "C:/plugins/wiki-master/scripts/op-begin.mjs" --op discover`
      and save the token. `op-begin` snapshots already-dirty paths so the close
      commits only what this clip touched.
   c. Clip:
      `node "C:/plugins/wiki-master/scripts/clip-xlsx.mjs" "C:/drops/kestrel-metrics-q3.xlsx" --quality=<tier> --topic="Kestrel offline rollout"`
      - **`--source` is omitted deliberately** — the facts say there is no
        canonical URL, and omitting it records the file path as the source.
        Inventing a URL would put a citation on a page that resolves to nothing.
      - **`--topic="Kestrel offline rollout"` is passed verbatim**, identical to
        the string the in-progress research run was given. Topic is recorded going
        forward only and nothing can retro-fit it, so a clip made without it is an
        *Unattributed* triage row permanently. I use the user's exact string; I do
        not re-word it per source, which would split one run into several groups.
      - `--quality` is my credibility judgment of the workbook as a source
        (an internal quarterly metrics workbook is not peer-reviewed; I would set
        `medium` and say why), separate from capture fidelity.
   d. Note that this clip belongs to an in-progress research run: if that run
      already has an enclosing operation open, I use **that** operation rather
      than opening a second one, and report the results to its owner for
      completion instead of committing underneath it.
   e. **Verify the clipping landed**: read `C:/vault/raw/clippings/<slug>.md` and
      sanity-check that the extracted cells/sheets are real content, plus any
      extraction or fidelity diagnostics the helper printed. A `thin` or `failed`
      result means empty/corrupt/protected — I report it for manual handling and
      do not invent the numbers.
   f. Log once, then close:
      `'<narrative>' | node "C:/plugins/wiki-master/scripts/log-entry.mjs" --op discover --title "Clip Kestrel Q3 metrics workbook"`
      then
      `node "C:/plugins/wiki-master/scripts/op-commit.mjs" --op discover --title "Clip Kestrel Q3 metrics workbook" --since $tok`,
      inspecting the actual changed paths and any index-refresh notice. Never
      `git add -A`.
   g. **Stop there.** Capturing this file is authorized; adding it to wiki pages
      is not. Capturing evidence does not by itself authorize ingestion, so I do
      **not** run `/wiki-ingest`, do not create a `wiki/sources/` page, and do not
      cite it anywhere. I report the committed clipping and ask.
   h. Sync: no session or vault instruction authorizing publishing is stated here,
      so I report the unpushed commit rather than pushing.
4. **Branch B — `clip-xlsx.mjs` does not exist.** I stop and say so plainly. I
   would specifically *decline* the two tempting workarounds and name why:
   - Converting the workbook to PDF with `soffice --convert-to pdf` and running
     `clip-pdf`: a spreadsheet rendered to PDF is exactly the tabular case
     `clip-pdf` warns about — row pairings get reconstructed from horizontal
     position (`fidelity: tabular` at best) or flattened and mispaired
     (`extraction: table-flattened`, `fidelity: degraded`) if the installed
     `pdftotext` is poppler rather than Xpdf. A metrics workbook whose whole value
     is which number pairs with which label is the worst possible document to put
     through that, and the result reads clean while being wrong.
   - Converting via `pandoc` and writing `raw/clippings/...` myself: that bypasses
     the sole-writer rule, dedup, the decline log and `source-hash`, so the vault
     would carry a clipping the ingest backlog cannot see and purge cannot reach.
   Instead I would tell the user the gap exists, that both `soffice` and `pandoc`
   are present so the capability is a missing wiki-master clipper rather than a
   missing tool, and offer either to file it as a triage `attention` row with
   `topic: "Kestrel offline rollout"` so it groups with the rest of the run
   rather than being lost in scrollback, or to have the workbook exported to a
   format that does have a clipper. I would not silently do nothing.

Sample user response after a successful path (Branch A):

"Clipped into the wiki as Markdown evidence — `raw/clippings/kestrel-metrics-q3-<hash7>.md`,
quality `medium` (internal working document, not peer-reviewed or published), filed
under the research topic `Kestrel offline rollout` so it groups with the rest of that
run in `/wiki-triage`. No canonical URL exists, so the source is recorded as
`C:/drops/kestrel-metrics-q3.xlsx`.

The stored artifact is the extracted Markdown, not the `.xlsx` — that keeps it
greppable and citable. Spreadsheet extraction is light on formulas, merged cells and
chart rendering, so verify any figure against the workbook before it lands on a page.

Committed as one operation (`<sha>`); I did not push, since publishing isn't
authorized in this session.

Capture was what you authorized, so I stopped there — the workbook is **not yet on
any wiki page** and nothing cites it. Want me to run `/wiki-ingest` on it to create
the `wiki/sources/` summary that makes it citable?"

Stop condition: done when the clipping exists at a verified path under
`raw/clippings/`, its extraction diagnostics are inspected and reported, the
operation is logged and committed with only this clip's paths staged, and the
ingestion boundary is stated explicitly. I stop instead at: (a) no installed
spreadsheet clipper and no `clip-xlsx.mjs` under the plugin root — I report the
coverage gap rather than improvising a conversion; (b) a `thin`/`failed`
extraction — I report it for manual handling and invent nothing; (c) the ingest
boundary in every case — I will not put this on a wiki page without being asked.

---

## Scenario: purge-orphan-lineage

Ordered intended actions:

1. Confirm this is genuinely a purge request and that the user said removal is
   intended and permanent — it is. Purge keeps its own approval requirement; the
   general "reuse session authorization" rule does not substitute for it.
2. **Check the git lineage before touching anything.** This is the one failure
   purge cannot detect or repair, and the facts describe it exactly: origin was
   force-updated last week and this clone has not pulled since. From inside an
   orphaned clone a purge succeeds, commits, and is invisible to every other
   machine — and the vault then looks like the topic keeps coming back.

   ```
   git -C C:/vault fetch
   git -C C:/vault merge-base HEAD origin/main
   ```

   No output plus a non-zero exit means the two lineages share no merge base at
   all — git reports "unrelated histories", not a conflict.
3. **Given these facts, that check fails, and I stop there.** I do not run
   `--reconcile`, do not run `--plan`, and emphatically do not run `--apply`.
   Reconciling which history is canonical is a decision about the user's
   repository, not one to make inside a purge, and every file a purge removed
   here would still be present on the other machines.
4. I say so plainly, and I state what *would* happen if I proceeded anyway: the
   purge would commit onto a dead lineage, auto-sync would keep committing to it,
   and the removal would never reach the other clones.
5. I would also name, without acting, the two things the plan will have to settle
   once the lineage is fixed, so the user knows the shape of the decision waiting
   for them:
   - The three pages that cite only Kestrel sources are **BLOCKING** — `--apply`
     refuses while any exist. The user chooses: add those pages to the purge, or
     keep their sources. A claim left with no evidence is a defect, so purge will
     not decide that silently in either direction.
   - The adjacent pages linking into the topic are **COLLATERAL** — they survive
     but their references break, and repairing them is a separate ordinary relink
     operation after the purge commit, never wrapped into purge's own transaction.
6. After the user reconciles the lineages (their decision, their call on which
   history is canonical), the sequence I would then run — stated so they can see
   the whole path:
   a. `node "C:/plugins/wiki-master/scripts/purge.mjs" --reconcile` — sweeps
      anything an earlier purge lost on this machine; cheap and silent when clean.
   b. `node "C:/plugins/wiki-master/scripts/purge.mjs" --plan "Project Kestrel"`.
   c. **Read the seed list first, before reading the plan.** Search ranks by
      relevance but has no notion of "relevant enough" — the tail of a long seed
      list drifts into adjacent topics, and every off-topic seed drags its
      exclusive evidence into the bin. I strike anything that does not belong and
      re-run pinned with `--seeds "wiki/concepts/A.md,wiki/concepts/B.md"`.
   d. Read the plan back grouped by layer with counts, naming the collateral and
      blocking pages specifically, and get an **explicit yes** before `--apply`.
   e. `--apply "Project Kestrel"` with the same `--seeds` I got approval for. If
      it stops partway on locked files, close whatever holds them and run
      `--reconcile` — never a second `--apply`, which would start a new purge id
      and commit an empty manifest while the real half-purge stays uncommitted.
   f. Open an ordinary relink operation to repair every COLLATERAL page the log
      entry lists, regenerate the catalog with `index-gen.mjs`, log and commit
      that separately, preserving already-dirty files.
   g. **Ask before pushing** — "push this purge to origin?" — and push only on a
      yes, since a push publishes the removal everywhere.
   h. Verify with `health.mjs` on the **broken-links line**, compared against a
      pre-purge run, not the score: an unrepaired purge can move the score *up*,
      because removing an orphan drops an orphan penalty and the dangling links
      left behind classify as `deferred`, which is unscored.
7. Throughout, `.recycle/` is never read, cited or counted — a page in the bin is
   not evidence, not a source and not backlog — and the bin is never hard-deleted,
   because reversibility is the only reason purge is safe to run at all.

Sample user response after a successful path — here the successful path is the
stop, so this is the message I would actually send:

"I stopped before planning the purge. Your vault's git lineage is broken in the one
way purge cannot fix or even detect from inside:

    git -C C:/vault fetch
    git -C C:/vault merge-base HEAD origin/main   → no output, non-zero exit

Origin was force-updated last week and this clone never pulled it, so the two
histories share no merge base at all — git calls them unrelated, not conflicting.

Why that blocks a purge specifically: a purge run from here would succeed, commit,
and be **invisible to every other machine**. All the Kestrel files would still be
sitting in the other clones, auto-sync would keep committing onto this dead lineage,
and from here it would look like the topic keeps coming back. Deleting files isn't
what removes a topic; a commit on a history nobody else can reach removes nothing.

Reconciling the two lineages is a decision about which history is canonical — that's
yours to make, not something I should pick inside a removal.

Once the clone is on origin's current lineage, here's what's waiting:
- **3 pages cite Kestrel sources and nothing else.** `--apply` refuses while those
  exist. You choose: purge them too, or keep their sources. I won't silently strand
  claims with no evidence, and I won't silently widen the purge.
- **Several adjacent pages link into the topic.** They survive, their links break,
  and I repair them in a separate operation right after the purge commits.
- I'll read the seed list and strike anything off-topic before showing you a plan —
  seed drift is how a purge quietly takes unrelated evidence with it — then show you
  the file counts by layer and wait for an explicit yes.
- Nothing gets pushed to origin without you saying so, and everything lands in the
  recoverable bin, not a hard delete.

Want me to walk through reconciling the lineage first?"

Stop condition: the purge is done only when the plan was approved on a pinned seed
set, `--apply` committed its own transaction, collateral references were repaired
and committed in a separate relink operation, the push was explicitly approved and
verified, and `health.mjs`'s broken-link count has not grown versus a pre-purge run.
**I stop before any of that here**, at the missing merge base — and I would also
stop at: a BLOCKING list I have not had the user resolve, a seed list I have not
read, an `--apply` that reported unmovable files (I run `--reconcile`, never a
second `--apply`), and the push, which is always a separate explicit yes.

---

## Scenario: triage-queue

Ordered intended actions:

1. Read this as the disposition-queue request it is — failed clips, a fidelity
   flag, expiring declines and an ingest backlog are exactly what triage presents.
   It is read-only, and nothing is authorized to change, so I open **no**
   operation, write no log entry, commit nothing, and refresh no index. Starting
   the triage UI creates only machine-local session state under
   `C:/vault/.wiki-master/triage-ui/`; that is not a content edit.
2. Start the queue from the resolved plugin root with the vault scoped:

   ```powershell
   $wikiPriorVault = $env:WIKI_MASTER_VAULT
   try {
     $env:WIKI_MASTER_VAULT = 'C:/vault'
     node 'C:/plugins/wiki-master/scripts/triage.mjs'
   } finally {
     $env:WIKI_MASTER_VAULT = $wikiPriorVault
   }
   ```

   **No `--remote`** — the user is at their desk on this machine, so loopback-only
   is right. `--remote` binds every interface and would put the session token on
   the wire in cleartext for no benefit here.
3. Parse the single JSON line it prints: `{"type":"triage-ready","link":…,"url":…}`
   plus counts. **I hand the user `link`, never `url`.** Every route is behind a
   session token and only `link` carries it; `url` is the clean form for liveness
   checks and logs and renders a 401 on its own. Opening `link` once is the whole
   login — the browser then holds an HttpOnly cookie for 30 days.
4. Read the counts and, per the skill, **lead with the topic breakdown when there
   is more than one topic** — that is the shape the decisions actually get made in
   ("deal with what the Kestrel sweep left behind"), not "deal with all fidelity
   flags". If a large **Unattributed** group shows up I explain it as clips made
   before topics were recorded or outside a research run — it is not a defect to
   fix, and no tool can retro-fit the topic.
5. Frame each kind honestly in the summary:
   - The 403s are **`failed`**, not declines — a 403 is a fact about one fetch, a
     decline is a judgment, and filing a transient failure as a decline would bury
     a recoverable source under a 180-day TTL. They ask "try this again, by hand
     or from a signed-in browser".
   - The paywalled SPA came back as **thin** and `clip.mjs` auto-declined it; the
     useful action there is a manual clip or a different source.
   - The **fidelity** flag asks a yes/no: acceptable, re-clip through the right
     binary path, or quarantine.
   - The two **expiring declines** are the 180-day TTL giving a changed world one
     re-evaluation: keep-declined resets the TTL, reconsider turns it back into a
     discovery candidate.
   - The **backlog** group is capped for display and says so — I report that cap
     rather than presenting a truncated list as the whole set. If the user wants
     the real not-ingested number I would get it from
     `node "C:/plugins/wiki-master/scripts/health.mjs" --backlog`, which prints the
     `unsummarizedSources` line — I would **not** re-derive it by grepping
     `tag:clippings` and hand-diffing `wiki/sources/`, which is the fuzzy
     link-resolution the content-hash join exists to replace.
6. Hand over the link with a one-line summary of what is waiting and **end my
   turn**. The user dispositions in the browser; I read the results back next turn
   by folding `C:/vault/.wiki-master/triage.jsonl` with
   `loadIssueLog`/`openIssues` from `scripts/lib/triage.mjs`. I do not poll, and I
   do not act on any disposition in this turn.
7. If the user later loses the link, I re-read the token from
   `.wiki-master/triage-ui/state/token` and rebuild the link — I never regenerate
   it, which would invalidate the link they already have.

Sample user response after a successful path:

"Triage queue is up — open this once and the browser stays logged in for 30 days:

http://localhost:7391/?t=…

Waiting on you, by research topic:

- **Kestrel offline rollout** — 3 failed clips (403s: the site refused an anonymous
  fetch, so these are retry-by-hand candidates, not declines) and 1 fidelity flag
  (a PDF whose symbols decoded lossily — you decide: acceptable, re-clip, or
  quarantine so nothing quotes it).
- **Unattributed** — 1 paywalled SPA that came back thin and was auto-declined, plus
  2 declines nearing their 180-day expiry, which is the queue offering you one
  re-evaluation each: keep them declined or send them back to discovery.
- **Ingest backlog** — clippings captured but not yet summarized into
  `wiki/sources/`. That group is capped in the display, so the list you see is not
  necessarily the whole set; say the word and I'll pull the exact not-ingested count.

Everything here is read-only until you choose — I haven't changed anything. Disposition
what you want in the browser and tell me when you're done; I'll pick up your choices
and act on them next turn."

Stop condition: done when the queue is running on loopback, the token-bearing
`link` is in the user's hands with an honest per-kind and per-topic summary, and I
have ended my turn without changing anything. I stop instead if `triage.mjs`
cannot start or prints no `triage-ready` line — I report that rather than
reconstructing the queue by hand from `triage.jsonl` prose. I also stop short of
acting on any disposition: applying one that changes tracked content or pipeline
state needs an operation and authorization, and neither exists in this request.

---

## Scenario: unsupported-claim-query

This is two questions — what the wiki says, and whether it is well supported — so
it is a query, not a bare search: it needs a synthesized, cited answer plus an
honest support assessment. No write is authorized, so nothing gets filed.

Ordered intended actions:

1. Load `wiki-search` for the retrieval mechanics rather than reimplementing them,
   and run the search from the plugin root with the vault scoped:

   ```
   node "C:/plugins/wiki-master/scripts/search.mjs" "Kestrel offline sync guarantees" --json --limit=10 --include-raw
   ```

   `--include-raw` because the question is plausibly about something recent enough
   to exist only as an unprocessed clipping; `--json` because it exposes scope,
   factual `reviewed` dates, provenance targets, decision/backlog state and index
   freshness, which I need for the second half of the question.
2. **Read the stderr status line before trusting anything.** Here it reports
   `lexical`, not `hybrid`, because the embedder is unavailable — semantic ranking
   contributed nothing and coverage is incomplete. I treat that as evidence about
   coverage, not about relevance, and I **say so in the answer**: a user reading a
   confident synthesis has no way to know the retrieval underneath it was degraded.
   I also read the raw-hit count line, including an explicit `0`. An unavailable
   channel returning zero hits does not establish that no evidence exists.
   Optionally `--health` to name precisely what is off, so my disclosure is
   specific rather than hand-waving.
3. Read each hit **from its matched `path:line` outward**, not from the top of the
   page — that line is the passage that actually matched. Run a bounded `rg` over
   `wiki/` and `moc/` (and `raw/clippings/` for evidence lookup only) to compensate
   for the missing semantic channel, staying under the known root and excluding
   `.recycle/`, dot folders and binaries.
4. **Trace each page's citation route rather than trusting its `sources:` field:**

   ```
   node "C:/plugins/wiki-master/scripts/search.mjs" "Kestrel offline sync guarantees" | node "C:/plugins/wiki-master/scripts/resolve-evidence.mjs"
   ```

   This is the step that answers "is it well supported". Expected results given the
   facts: page A resolves to a raw clipping; page B reports **`unreachable`** — a
   genuine provenance gap in `health.mjs`'s own vocabulary, not a silent omission.
   I check whether that gap is real absence or the known title-shaped-citation
   drift (`sources: ["[[<title>]]"]` where the clipper had slugified `/`, `:`, `#`
   or truncated at 120 chars), because those are different findings: one is missing
   evidence, the other is a repairable link over evidence that is present. I would
   *report* which it looks like; repairing it is a write and is not authorized here.
5. Open page A's raw clipping and check its frontmatter. It is recorded as a
   **degraded capture**, and that has a precise consequence I apply rather than
   gloss: a degraded capture is authoritative evidence of *what the vault holds*,
   not of what the author typed — it cannot establish an exact quote at character
   level. So I paraphrase with attribution, do **not** reproduce verbatim spans or
   figures from it, and note the fidelity ceiling explicitly. If it also carried
   `extraction: table-flattened` I would assert no row pairing from it at all.
6. Compose the answer:
   - Cite every claim by `path:line` — the wiki pages and, where I lean on it, the
     raw clipping, labeled as unvetted evidence rather than a reviewed claim.
   - Separate the layers: what the pages *state*, what the evidence *supports*, and
     which of my sentences are the wiki's own inference. Joining page A to page B
     to conclude something neither says is my original claim and I label it as one.
   - Report `reviewed` dates as-is. A recent `updated` is not verification, and a
     missing `reviewed` date means unverified, not wrong.
   - State the support verdict plainly: the guarantee is stated twice but rests on
     one degraded capture and one broken citation route, so it is **stated, not
     established**. And state the boundary: absence of support proves "not
     supported here", never "false". I do not assert the guarantee is wrong, and I
     do not delete or edit anything.
   - Disclose the lexical-only tier and any raw-channel diagnostics.
7. **File nothing.** Answering is read-only; a request to answer does not authorize
   filing a page, and no write is authorized in this session. I open no operation
   — the completion contract is explicit that an answer that is not filed gets no
   operation, no log and no commit. I offer to file, and to repair the broken
   citation, as separate asks.

Sample user response after a successful path:

"**What the wiki says.** Two pages assert the offline sync guarantee:

- `wiki/concepts/Kestrel Offline Sync.md:34` — states the guarantee, cites
  `raw/clippings/kestrel-sync-design-<hash7>.md`.
- `wiki/syntheses/Kestrel Rollout Readiness.md:57` — states it in the same terms and
  cites a source page.

**How well supported it is: stated twice, established neither time.**

- The first page's evidence is real but is a **degraded capture** — the clipping's
  frontmatter carries `fidelity: degraded`, meaning symbols and verbatim spans
  decoded lossily. That clipping is authoritative for what the vault *holds*, not
  for what the document *said*, so it cannot establish an exact quote or a precise
  figure. I've paraphrased rather than quoted it, and nothing on that page should be
  cited verbatim without checking the original.
- The second page's citation route **doesn't reach `raw/` at all** —
  `resolve-evidence.mjs` reports it `unreachable`, which is a real provenance gap.
  It may well be the known title-drift defect (a citation written as `[[Title]]`
  where the clipper had slugified the filename), in which case the evidence exists
  and only the link is broken — but as the vault stands, that page's claim has no
  walkable trail.

So: two statements, one lossy source behind them, one dead trail. That's a claim the
wiki repeats rather than two independent confirmations.

**To be clear about what that does and doesn't mean:** it means the guarantee isn't
*supported here* — not that it's false. The vault can't cite what it doesn't hold.

**One caveat on the search itself:** retrieval ran `lexical`, not `hybrid` — the
embedder is unavailable, so semantic ranking contributed nothing and there may be
pages on this that keyword matching didn't surface. I widened with a direct scan of
`wiki/` and `moc/` to compensate, but treat coverage as incomplete.

I haven't changed anything — this was read-only and no write is authorized. Two
things I could do next if you want them: repair that broken citation link (it looks
mechanical, not a missing source), and file this assessment as a synthesis so the
next person asking doesn't re-derive it."

Stop condition: done when both pages are read at their matched lines, both citation
routes are resolved, the degraded capture's ceiling and the unreachable route are
each named specifically, the lexical-only tier is disclosed, and the answer is
delivered cited and unfiled. I stop instead of writing at the authorization
boundary — no operation, no synthesis page, no link repair — and I stop short of
declaring the guarantee false on the strength of missing evidence. If `search.mjs`
failed outright rather than degrading, I would report the failure rather than
answer from memory.

---

## Scenario: relink-scope

Repair is authorized and the vault's own instructions authorize publishing, so
this run goes all the way through commit and push. The live hazard is the user's
unrelated uncommitted edits to two pages.

Ordered intended actions:

1. Read `C:/vault/AGENTS.md` and the schema before editing — that is also where
   the publishing authorization lives, so I confirm it there rather than assuming
   it. Confirm the vault layout at the known root.
2. **Open the operation before the first write**, and do it *first*, because that
   is precisely what protects the user's in-progress edits:
   `$tok = node "C:/plugins/wiki-master/scripts/op-begin.mjs" --op relink`
   `op-begin` snapshots the already-dirty paths so `op-commit` excludes them. It
   does **not** isolate simultaneous edits to the same file, so before I touch
   anything I check which two pages are dirty (`git -C C:/vault status`) and treat
   them as coordination targets: if a broken link lives in one of those two pages,
   I do not silently rewrite it underneath the user — I either leave it and report
   it, or ask. Never `git add -A`, ever, in a vault that carries the user's
   in-progress writing.
3. Get the structural picture:
   `node "C:/plugins/wiki-master/scripts/health.mjs"`
   Record the **broken-links count** now, before any repair, so I have a
   before/after number. I read the report for its distinct defect classes rather
   than the single score — `provenanceGaps`, `backfillPending`, hard-wrapped
   wikilinks and unresolved links are four different problems with four different
   repairs, and the score can move the wrong way independently of all of them.
4. **Clear the mechanical breakage first**, dry-run before apply each time, so the
   remaining list is only links that need a judgment call:
   - `node "C:/plugins/wiki-master/scripts/repair-wrapped-links.mjs"` then `--apply`.
     A `[[Title\ncontinued]]` from a word-wrapped paragraph can never resolve and
     is always a defect, never a healthy deferred forward-link — the fix is a
     lossless whitespace collapse, not a guess. The one shape it refuses is a
     hyphen glued to the break (`[[Diagno-\nstics]]`), which it checks against the
     real page index and leaves alone when ambiguous; I review those by hand rather
     than letting anything guess.
   - If `health.mjs` reported `provenanceGaps > 0`:
     `node "C:/plugins/wiki-master/scripts/repair-provenance-links.mjs"` then
     `--apply`. This is the title-shaped-citation drift — ingest wrote
     `sources: ["[[<title>]]"]` while the clipper had already slugified that title
     into the filename, so the citation points at a file that never existed and the
     clipping reads as unparsed though the ingest was correct. It joins on
     `source-hash`, never on the title (the title is what drifted) and reports
     anything it cannot pin to exactly one clipping instead of guessing.
   - If `backfillPending > 0`:
     `node "C:/plugins/wiki-master/scripts/backfill-source-hashes.mjs"` then
     `--apply` — idempotent, and running it once on a git-synced vault repairs every
     machine.
   - If the report shows the invalid `sources:`/`source-hashes:` ordering (Obsidian
     saying "No frontmatter found" on a page whose frontmatter looks fine to the
     regex-based scripts): `repair-sources-order.mjs`, dry-run then `--apply`.
5. Re-run `health.mjs` and look at what is *left*. Those are the real decisions:
   - Separate ambiguous identity from genuine disconnection:
     `node "C:/plugins/wiki-master/scripts/identity-audit.mjs" --limit=20 --json`.
     A basename collision between a source page and a concept is legitimate and a
     warning there is a review queue, not permission to rename everything.
   - For each remaining unresolved link, search the intended title and its
     equivalent aliases before creating anything, and reuse the canonical page when
     it exists. I use full-path wikilinks for ambiguous names. I do **not** merge
     concepts because names or embeddings look similar.
   - Orphans: `health.mjs`'s list is the honest one — Obsidian's own `orphans`
     counts catalog links and can hide genuinely stranded pages. But "fix the
     broken links" is a repair scope, not a license to grow the graph. I link an
     orphan only where there is a real, explainable relationship, each with a role
     from the small vocabulary (**broader / narrower / prerequisite / complements /
     alternative / contrasts / applies-to**) and a sentence stating the
     relationship and its limits, under `## Relationships`. I do not add links to
     improve a graph score, and I do not turn similar wording into a causal claim.
     Anything uncertain I report rather than decide.
6. Write every touched line as an **unwrapped logical line** and never let a
   `[[wikilink]]` straddle a line break — that is the discipline that stops the
   wrapped-link defect recurring, and `op-commit` re-checks it on the files it
   commits anyway.
7. `reviewed` stays untouched on every page — this is mechanical linking, not
   factual verification. `updated` advances for edits. Those are different dates
   and neither substitutes for the other.
8. Refresh the catalog: `node "C:/plugins/wiki-master/scripts/index-gen.mjs"`.
   Never hand-edit the generated fence; manual framing outside it is preserved.
9. Log once:
   `'<narrative naming repaired counts, accepted and rejected candidates, and the excluded dirty files>' | node "C:/plugins/wiki-master/scripts/log-entry.mjs" --op relink --title "Repair broken links"`
10. Close and inspect:
    `node "C:/plugins/wiki-master/scripts/op-commit.mjs" --op relink --title "Repair broken links" --since $tok`
    Then verify the **actual changed paths** — specifically confirming the user's
    two dirty pages were excluded, and reporting that exclusion rather than
    sweeping it into the commit. I read the helper's notices for a missing
    embedding backend, skipped work or a partial index build; a commit does not
    establish index freshness. I also read its hard-wrapped-link report for
    anything introduced after step 4.
11. **Verify on the broken-link count, not the score**, against the number recorded
    in step 3. It must have gone down and must not have grown.
12. Sync: the vault's instructions authorize publishing, so this is already
    authorized and I do not ask again — `git -C C:/vault push`, then verify the
    result and the upstream state. A rejected push is a real stop: I do not force
    and do not claim success.

Sample user response after a successful path:

"Broken links repaired and pushed. Broken-link count went 23 → 4.

**Mechanical fixes (no judgment needed):**
- 11 hard-wrapped wikilinks — `[[Target\ncontinued]]` from word-wrapped paragraphs.
  Collapsed losslessly, nothing guessed. One was left alone: `[[Diagno-\nstics]]` is
  ambiguous by character shape between a wrap and a title that legitimately ends in a
  hyphen, and it didn't resolve to exactly one real page. Your call on that one.
- 6 title-shaped citations repaired — ingest had written `sources: [[<title>]]` while
  the clipper had already slugified that title into the filename, so the citation
  pointed at a file that never existed and the clipping read as un-ingested. Rejoined
  on `source-hash`, not on the title, since the title is what drifted.

**Judgment calls:**
- 2 unresolved links now point at existing canonical pages I found under alternative
  names — no new pages created.
- 4 remain unresolved on purpose: each names a page that genuinely doesn't exist, and
  creating a stub to silence a link isn't a repair. They're listed in the log entry.
- Orphans: I linked 3 where there was a real relationship to state (role + a sentence
  explaining it and its limits, under `## Relationships`). The rest I left alone —
  adding links to lift a graph score isn't a fix.

**Your uncommitted work is untouched.** `op-begin` snapshotted
`wiki/concepts/Sync Backoff.md` and `wiki/syntheses/Q3 Retro.md` as already-dirty
before I started, and the commit excluded both. One of the unresolved links lives in
`Q3 Retro.md` — I left it for you rather than editing a file you have open.

`reviewed` dates are unchanged throughout; this was mechanical linking, not factual
verification. Catalog regenerated, one log entry written, committed as a single
revertable unit (`<sha>`) and pushed to origin per the vault's instructions. The
post-commit index refresh reported <notice>."

Stop condition: done when the broken-link count has demonstrably dropped against
the pre-repair number, every repair was dry-run before applying, the catalog is
regenerated, exactly one log entry exists, the commit staged only this operation's
paths with the user's two dirty files verifiably excluded, and the authorized push
is verified against upstream. I stop instead at: a repair script reporting something
it cannot pin unambiguously (I report it, never guess); a broken link living inside
one of the user's dirty files (I leave it and say so, because `op-begin` does not
isolate concurrent edits to the same file); a rejected push (a real stop — no force,
no success claim); and any link that would require asserting a relationship I cannot
explain from the two pages and their evidence.

---

## Files loaded and inherited exposure

Files I loaded, and nothing else from this repo:

1. `C:/Users/ehart/repos/wiki-master/eval/skill-catalog.md`
2. `C:/Users/ehart/repos/wiki-master/eval/skill-coverage/prompts.json`
3. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/SKILL.md`
4. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/access.md`
5. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/evidence.md`
6. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/efficacy.md`
7. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/maintenance.md`
8. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/operations.md`
9. `C:/Users/ehart/repos/wiki-master/skills/clip-docx/SKILL.md`
10. `C:/Users/ehart/repos/wiki-master/skills/clip-pdf/SKILL.md`
11. `C:/Users/ehart/repos/wiki-master/skills/clip-pptx/SKILL.md`
12. `C:/Users/ehart/repos/wiki-master/skills/wiki-discover/SKILL.md`
13. `C:/Users/ehart/repos/wiki-master/skills/wiki-purge/SKILL.md`
14. `C:/Users/ehart/repos/wiki-master/skills/wiki-triage/SKILL.md`
15. `C:/Users/ehart/repos/wiki-master/skills/wiki-query/SKILL.md`
16. `C:/Users/ehart/repos/wiki-master/skills/wiki-search/SKILL.md`
17. `C:/Users/ehart/repos/wiki-master/skills/wiki-relink/SKILL.md`

That is the complete list — exactly the files I was told to read, no more. I opened
no other file in the repository, ran no repo-wide search, and read no source under
`scripts/`.

**Other inherited context.** A global `CLAUDE.md` (git discipline, option-presentation
style, "the wiki is the source of truth"), a small auto-memory file listing two prior
notes by title, a git-status snapshot of this repo (branch `main`, clean, five recent
commit subject lines), commit-attribution boilerplate, environment details (Windows,
PowerShell, cwd, scratchpad path), and the host's own list of available skills and
agent types. Of those, the host skill list independently names the same wiki-master
skills as the catalog, plus unrelated non-wiki skills; I treated `eval/skill-catalog.md`
as authoritative for what is installed for this exercise. None of that inherited
context described these scenarios or how they would be evaluated.

**Rubric exposure: none.** I did not see, open, search for, or infer the contents of
any `scenarios.json`, any test file, any other file under `eval/` besides the two I
was explicitly directed to read, any file under `docs/`, or any prior evaluation
transcript or output. I did not list the contents of `eval/` or its subdirectories.
The only directory operation I performed there was creating the output folder
`eval/skill-coverage/2026-09-11-pre/` to write this file into.

**Catalog coverage, scenario by scenario:**

| Scenario | Covered by an installed skill? |
|---|---|
| `spreadsheet-clip` | **No.** The catalog has clippers for Confluence pages, Word, GitHub repos, PDFs and PowerPoint — nothing for a spreadsheet. `wiki-discover` references a `clip-xlsx.mjs` helper, so the script may ship without a skill wrapper; absent that script I would report the gap rather than improvise a conversion through `clip-pdf` or a hand-written clipping. |
| `purge-orphan-lineage` | Yes — `wiki-purge`, which also owns the git-lineage precondition that stops this one. |
| `triage-queue` | Yes — `wiki-triage`. |
| `unsupported-claim-query` | Yes — `wiki-query`, calling `wiki-search` for retrieval; `wiki-maintainer`'s evidence reference supplies the degraded-capture and absence-of-support rules. |
| `relink-scope` | Yes — `wiki-relink`, with `wiki-health` available for the read-only report and the maintenance reference supplying the specific repair scripts. |

In every scenario the shared `wiki-maintainer` core plus its operations reference
governed authorization, logging and commit scope; only the spreadsheet case lacked a
task-specific skill.
