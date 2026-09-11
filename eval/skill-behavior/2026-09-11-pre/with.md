# Skill-behavior simulation — WITH-SKILLS condition

Date: 2026-09-11. Simulation only: nothing below was executed against a real vault.

Throughout, `<plugin>` is the installed plugin root resolved from the installed
`SKILL.md` location (its skill folder's `../../`), never from the current working
directory. In the scenarios that name it, that is `C:/plugins/wiki-master`. The
vault root is `WIKI_MASTER_VAULT`; where named, `C:/vault`. On Windows I drive
Node scripts and anything Obsidian-related through the **PowerShell** tool, not
the Bash tool, because Git Bash does not apply `PATHEXT` and selects the GUI
`Obsidian.exe` instead of the `Obsidian.com` terminal redirector, which prints
nothing and exits 0.

---

## Scenario: offline-author

Ordered intended actions:

1. Classify the request: this is original, first-party project documentation
   ("explain offline mode" in our own Atlas user guide), not a summary of a
   captured external source. That routes it to `/wiki-author`, not `/wiki-ingest`.
   I load the shared core once, plus the four references that operation names:
   access, authoring, evidence, operations.
2. Resolve paths before anything else. The current working directory is
   `C:/work/widget`, which is unrelated to both the plugin and the vault, so a
   relative `scripts/...` path would be wrong and would silently run nothing or
   the wrong thing. The plugin root is `C:/plugins/wiki-master`; the vault is
   `C:/vault`. I start at that known vault root — I do not search the disk for a
   vault, and I do not execute a literal `<absolute-plugin-root>` placeholder.
3. Read `C:/vault/AGENTS.md` and the vault schema before changing anything,
   because the operations contract's first step is to resolve scope and
   authorization from the vault's own instructions. Here that file explicitly
   exempts this vault from the generic "never commit to the default branch" rule
   and instead says: stay on `main`, bracket the writes in an operation, then
   push. The vault's own instructions govern the vault, so I stay on `main` and
   do not create a feature branch or a worktree. It also means publication is
   already authorized — "publish it so my laptop can receive it" plus the vault's
   standing instruction is the authorization, so I will push without asking a
   second time.
4. Note the CLI state and pick the fallback once. The Obsidian CLI has timed out.
   Ordinary Markdown creation and editing is an exact-path filesystem operation
   anyway — I would use filesystem edits here even if the app were healthy, and I
   would never push a whole note body through CLI `content=`. So the timeout
   blocks nothing I need. I do not loop waiting for the app, do not launch native
   `obsidian`, and do not tell the user to restart Obsidian as a precondition for
   authoring.
5. Locate the existing guide rather than inventing a path. Canonically a user
   guide lives at `wiki/authored/atlas/guides/user.md`, but existing files are
   not renamed to fit the table, so I first look for the real page — e.g. a
   bounded `rg` over `C:/vault/wiki/authored/` plus
   `node "C:/plugins/wiki-master/scripts/search.mjs" "Atlas user guide" --project=atlas --json --limit=10`
   — and preserve whatever filename it already has. If no Atlas project folder
   exists at all, its `overview.md` gets created before any other document.
6. Read the current page in full before editing, so I preserve unrelated content
   and can revise in place.
7. Open the operation before the first write, saving the token, using the
   PowerShell template from the operations reference (restoring the prior
   environment value in `finally`):

   ```powershell
   $wikiPriorVault = $env:WIKI_MASTER_VAULT
   try {
     $env:WIKI_MASTER_VAULT = 'C:/vault'
     $wikiOpToken = node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op relink
     if ($LASTEXITCODE -ne 0) { throw 'Could not open wiki operation' }
     # authorized edits + validation happen here
   } finally { $env:WIKI_MASTER_VAULT = $wikiPriorVault }
   ```

   Authoring uses the `relink` operation vocabulary — there is no `author` op.
8. Write the offline-mode section into the existing guide with an exact-path
   filesystem edit. I revise living content in place; I do **not** append a dated
   "Update (2026-09-11): ..." paragraph on top of the old ones. I write unwrapped
   logical lines and never let a `[[wikilink]]` straddle a line break, because a
   wrapped wikilink can never resolve and always scores as a defect.
9. Frontmatter: `type: authored`, `sources: []` declared explicitly (not omitted),
   `ai-generated: true` since I drafted it, `project: atlas`, `kind: guide`,
   `status` as appropriate, and `updated: 2026-09-11`.
10. **Leave `reviewed: 2026-08-01` exactly as it is.** Only the new offline
    section was checked against the code; the rest of the guide's factual claims
    were not re-verified in this pass. `reviewed` means the page's factual claims
    were checked, and advancing it on the strength of one verified section would
    launder unverified claims as fresh. I say so explicitly in my response rather
    than leaving it silent.
11. Validate placement and links. Any link from outside the Atlas project to a
    bare-named file uses the piped full-path form, e.g.
    `[[wiki/authored/atlas/roadmap.md|atlas roadmap]]`, because bare `[[roadmap]]`
    silently resolves to whichever project's roadmap the name index picks. If the
    offline work changes what is shipped versus planned, the roadmap or the
    backlog item gets updated in this same operation — a roadmap updated later is
    a roadmap updated never.
12. Refresh affected catalogs: `node "C:/plugins/wiki-master/scripts/index-gen.mjs"`,
    `node "C:/plugins/wiki-master/scripts/moc-authored-gen.mjs" --apply` (Atlas has
    two or more authored pages), and `backlog-gen.mjs --apply` only if a backlog
    item actually changed. I inspect the generated diff for unrelated projects and
    never hand-edit a generated fence.
13. Log once: pipe a short narrative into
    `node "C:/plugins/wiki-master/scripts/log-entry.mjs" --op relink --title "Atlas user guide: offline mode"`.
14. Commit and inspect:
    `node "C:/plugins/wiki-master/scripts/op-commit.mjs" --op relink --title "Atlas user guide: offline mode" --since $wikiOpToken`.
    I read the actual changed paths and any exclusions of already-dirty files, and
    I read the index-refresh notice — a commit does not establish index freshness.
    I never `git add -A` or stage the whole vault.
15. Sync, because it is already authorized: `git -C C:/vault push`, then verify
    the result and the upstream state. Only after a verified push do I call it
    published to the laptop.

Sample user response after a successful path:

"Added an Offline mode section to the Atlas user guide at
`C:/vault/wiki/authored/atlas/guides/user.md` (kept its existing filename) and
pushed it, so your laptop will pick it up on its next pull.

- Edited in place — no dated-update paragraph stacked on the old ones.
- `updated: 2026-09-11`. I deliberately left `reviewed: 2026-08-01` alone: I only
  checked the new offline section against the code, so the rest of the guide's
  claims are still unverified since August. If you want the whole page re-verified,
  that's a separate pass.
- Refreshed the index catalog and the Atlas authored MOC; logged one relink entry;
  committed just the pages this touched (commit `<sha>`, 3 files) and pushed to
  `origin/main` — `main` is up to date with the remote. I stayed on `main` per the
  vault's own AGENTS.md, which exempts this vault from the feature-branch rule.
- The Obsidian CLI is still timing out, so this went through filesystem edits under
  the vault root. That is the supported path for Markdown anyway; nothing was
  blocked. Search's semantic index refresh after commit reported `<notice>`."

Stop condition: done when the offline section is written and validated, frontmatter
and links check out, the index and authored MOC are refreshed, exactly one log entry
and one verified operation commit exist, and the push is confirmed against upstream.
I stop instead if the push is rejected (diverged remote) — that is a real stop for
sync: I report the unpushed commit and do not force-push or claim the laptop will
receive it. I also stop and ask if the guide's on-disk content changed since I read
it (concurrent edit to reconcile), or if there is no Atlas project and creating its
`overview.md` first would exceed what was asked.

---

## Scenario: lookup

Ordered intended actions:

1. Classify: "find what we already know" plus "do not add anything" is pure
   retrieval over the existing vault. That is `/wiki-search`, not `/wiki-query`
   (no synthesized answer was requested) and not `/wiki-discover` (no new external
   sources). I load the core plus access and evidence only — not every reference.
2. Confirm the entry point is read-only: no `op-begin`, no log entry, no
   `index-gen`, no commit, no `reviewed` stamping. Reads do not open operations.
3. Run the search with raw evidence included, because the user is asking what the
   vault holds and a raw clipping exists:
   `node "<plugin>/scripts/search.mjs" "if-then planning" --include-raw`.
   I also run the canonical wording as a second bounded query,
   `node "<plugin>/scripts/search.mjs" "implementation intentions" --include-raw`,
   since alias and title matches are prioritized and I want both spellings' hits.
4. Read the stderr status line before trusting anything. If it says
   `(hybrid · N chunks)` I say so; if it says `(lexical — ... · run --health)` I
   tell the user in the answer that semantic ranking contributed nothing, because
   a confident-looking result list gives them no way to know retrieval was
   degraded. I also read the raw/ hit-count line, including an explicit `0`.
5. Resolve the alias question explicitly: the canonical page is
   `wiki/concepts/Implementation Intentions.md` carrying
   `aliases: ["If-then planning"]`. I report that these are the same concept and
   name the canonical path, rather than presenting two apparently separate things.
6. Read each hit from its matched `path:line` outward, not from the top of the
   page — that line is the passage that actually matched.
7. Walk from the wiki hits to their evidence with the tool rather than by hand:
   `node "<plugin>/scripts/search.mjs" "if-then planning" | node "<plugin>/scripts/resolve-evidence.mjs"`.
   I report `unreachable` routes as a real provenance gap and
   `declared-no-provenance` (an authored page with `sources: []`) as the deliberate
   disclosure it is, not as a defect.
8. Return paths, lines and short quoted passages. I label the `raw/clippings/...`
   hit as unvetted evidence — fidelity to the source, not a citable fact — and I
   do not weave the hits into a narrative conclusion. If the user then wants a
   cited synthesis, that is a hand-off to `/wiki-query`, and filing it back as a
   page would need its own authorization.

Sample user response after a successful path:

"Here's what the vault already holds. Retrieval status: `hybrid · 214 chunks`
(keyword + semantic), plus 1 raw/ hit.

Canonical concept — 'If-then planning' is an alias, not a separate page:
- `wiki/concepts/Implementation Intentions.md:14` — `aliases: ["If-then planning"]`,
  `scope:` one-sentence boundary at line 9. The definition passage that matched is
  at :14.
- `wiki/concepts/Implementation Intentions.md:41` — `## Relationships`, complements
  `[[wiki/concepts/Intention-Action Gap.md|Intention–Action Gap]]`.

Supporting source page:
- `wiki/sources/Gollwitzer-Implementation-Intentions.md:8` — summary; cites
  `[[raw/clippings/<file>.md]]`.

Raw evidence (unvetted — this is exactly what the clipper captured, not a verified
fact):
- `raw/clippings/<file>.md:120` — the passage on forming if-then plans.

Evidence routes resolved cleanly for both wiki pages. I haven't added, edited or
indexed anything — this was read-only. Say the word if you want a cited synthesis
written up instead of a list."

Stop condition: done when the matching pages and passages are returned as
citation-ready `path:line` with the retrieval channel status disclosed. I stop
short of writing anything at all — if I find myself about to compose prose that
answers "what do we know" as a conclusion, I stop and offer `/wiki-query` rather
than doing it from here. The blocker I would report rather than paper over: if
`search.mjs` cannot resolve the vault root or `wiki/`, that is an explicit failure,
not an empty report; and if a channel is down and returns zero hits, I say coverage
was incomplete rather than "the wiki knows nothing about this."

---

## Scenario: freshness

Ordered intended actions:

1. Classify: "are the recommendations still current" is a factual-freshness
   question, so `/wiki-stale` — read-only. Applying any fix belongs to
   `/wiki-lint` and is not authorized here. Load core plus access, efficacy,
   evidence. No `op-begin`, no log, no index rebuild.
2. Run `node "<plugin>/scripts/stale.mjs"` and read its backend diagnostic. A
   failed, invalid or empty CLI query falls back to scoped `wiki/` files at the
   resolved root — filesystem access works here, so the report stands. A missing
   root or missing `wiki/` would be an explicit failure, not an empty report.
3. Run `node "<plugin>/scripts/drift.mjs" --coverage` — coverage only. I do **not**
   run the full embedding evaluation: it can write a machine-local embedding cache,
   which is not appropriate for a strict read-only report, and bounded embedding
   maintenance belongs to wiki-lint anyway.
4. Read the three metrics apart from each other, because conflating them is the
   whole failure mode here:
   - Structural health 100/100 says the graph is clean. It says nothing about
     whether any claim is correct. I will not let it imply currency.
   - 12 of 40 concepts carry no `reviewed` date — those are **unverified**, not
     "recently fine."
   - "Many edited yesterday" is `updated`, which means edited. An edit does not
     re-verify a claim; a page edited yesterday can carry a claim that went stale
     in March. I state this distinction rather than reporting a fresh-looking
     vault.
   - Drift: 0 evaluated, 10 failed, because the embedder backend is unavailable.
     A zero-evaluated run cannot establish that the wiki has no drift, so I report
     the failure as a coverage hole, not as a clean result. Cosine drift is a
     topical diagnostic anyway, never a truth or contradiction detector.
5. Because the question is specifically "are the recommendations current" — not
   "what needs review" — metadata alone does not answer it. I inspect actual
   claims on a bounded sample, prioritizing high-use and volatile recommendation
   pages (advisory `wiki/authored/` pages and any concept that states a
   recommendation), using the read-only search and evidence workflow:
   `node "<plugin>/scripts/search.mjs" "<recommendation terms>" --json --limit=10`
   then `resolve-evidence.mjs` to reach the supporting clipping, and I compare the
   page's stated claim against the clipping and against current project behavior.
   Clippings outrank my memory of a source; a clipping's silence proves "not
   supported here," never "false."
6. Report checked / holds / contradicted / unverified separately, and say plainly
   that a bounded sample cannot establish currency for the whole wiki.
7. Do not stamp `reviewed` on anything. Verification I performed in a read-only
   report is not the same as an authorized maintenance pass, and refreshing
   embeddings or adding links would never qualify anyway.

Sample user response after a successful path:

"Short answer: I can't tell you the recommendations are current, and the metrics
that look reassuring don't mean what they appear to.

What the tooling reports:
- Structural health 100/100. That's the graph — no broken links, no orphans. It
  says nothing about whether a claim is still true.
- 12 of 40 concept pages have no `reviewed` date at all. Those are unverified, full
  stop.
- A lot of pages were edited yesterday. That's `updated`, not `reviewed` — an edit
  doesn't re-check a claim, so none of those got fresher in the sense you're asking
  about.
- Drift: 0 pages evaluated, 10 failed, because the embedding backend is
  unavailable. So I have zero drift coverage. I can't say 'no drift found' — nothing
  was found because nothing was measured.

What I actually checked by hand (6 highest-use recommendation pages, against their
clippings and current project behaviour):
- 4 still supported by their cited evidence.
- 1 contradicted: `wiki/concepts/<X>.md:37` recommends `<old guidance>`; the
  clipping at `raw/clippings/<file>.md:210` says `<current guidance>`. The clipping
  wins — that page needs a factual fix.
- 1 unsupported rather than wrong: the page asserts `<claim>` and no clipping in the
  vault covers it. That's 'not supported here', not 'false'.

That's a sample of 6 of 40. It cannot establish currency for the whole wiki. This
was read-only — I didn't stamp any `reviewed` dates or change anything. Fixing the
contradicted page and the unverified 12 is a `/wiki-lint` pass; say the word and I'll
run it. Restoring drift coverage needs the embedder back (Ollama + the model pulled);
`search.mjs --setup` prints the exact commands."

Stop condition: done when stale pages, missing-review pages and drift coverage
(including the 10 failures) are reported separately, and the bounded claim sample is
reported with its limits. I stop before touching a single page: no `reviewed`
stamps, no factual corrections, no index refresh, no commit — those need wiki-lint
and the user's go-ahead. The blocker at which I'd stop earlier: if `stale.mjs`
reported a missing vault root or missing `wiki/`, I'd report that as a failure
rather than producing an empty, reassuring report.

---

## Scenario: naming-near-miss

Ordered intended actions:

1. Classify first, and resist the near-miss. The words "sources" and "citations"
   are vault vocabulary, but the question is about a database table in application
   code. Ordinary application code work is not a wiki operation unless it uses or
   updates the vault. No wiki write was requested, so no wiki write happens — I do
   not open an operation, do not file an ADR, do not log or commit anything.
2. Honour the standing research instruction with a *bounded* read-only lookup
   before reaching for the web or my training data — one or two searches, not a
   research project:
   `node "<plugin>/scripts/search.mjs" "sources table naming" --json --limit=10`
   and a look at the vault's own schema vocabulary. I read the stderr status line
   and disclose degradation if the channel is lexical-only.
3. Establish the existing application meaning from the code, which is what
   actually decides this. I grep the repository for current usage — `sources:`
   frontmatter, `wiki/sources/`, `source-hash` / `source-hashes`,
   `knownSourceUrls`, `unsummarizedSources`, `provenanceGaps` — to see which word
   the system already uses for which thing, and what a row in the proposed table
   would actually hold (a captured external artifact, versus a reference *to* one
   from a page).
4. Decide on meaning, not aesthetics. If a row is a captured source artifact, the
   established word in this system is **source**, and `citations` would introduce a
   second name for a thing that already has one. If a row is the *link* between a
   page and a source — a page-to-source edge with a locator — then it is a
   citation, and calling it `sources` would collide with the existing meaning. The
   near-miss is real and worth naming out loud: these are two different entities,
   and the right answer depends on which one the table is.
5. Present the options with their concrete implications across time, risk,
   complexity, best practice and maintainability, per the user's standing
   instruction about how options should be presented — not as a one-line label
   each.
6. Answer in the conversation. Offer, without doing it, to record the decision as
   an ADR at `wiki/authored/<project>/decisions/<slug>-adr.md` — which would be a
   real authoring operation with its own authorization, operation bracket, log and
   commit, and would need balanced consequences, not just benefits.

Sample user response after a successful path:

"It depends on what a row is, and the two candidate answers aren't
interchangeable — this codebase already uses both words for different things.

In the existing system, a **source** is a captured artifact (a clipping, with a
`source-hash`, a URL, a quality tier). A **citation** is the edge from a page to
one of those artifacts — what `sources: ["[[raw/clippings/...]]"]` expresses, and
what `provenanceGaps` counts when the edge dangles.

- If a row is one captured artifact → name it `sources`. It matches the meaning
  already carried by `source-hash`, `knownSourceUrls` and `wiki/sources/`.
  - Time: nothing extra now; no lag later.
  - Risk: low. The only risk is later needing a separate edge table, which this
    doesn't preclude.
  - Complexity: unchanged — one word, one meaning, across code and vault.
  - Best practice: this is the right way; names should follow the domain's
    established meaning.
  - Maintainability: cheapest. Nobody has to hold a translation table in their head.
- If a row is a page→source reference with a locator → name it `citations`, and
  keep `sources` for the artifacts.
  - Time: nothing extra now.
  - Risk: low, and calling it `sources` instead would be the actual risk — two
    meanings for one name is how `provenanceGaps`-style confusion starts.
  - Complexity: two tables, which is the honest shape of the data.
  - Best practice: correct; distinct entities get distinct names.
  - Maintainability: good, provided the distinction is written down once.
- Naming the artifact table `citations` (the option I'd avoid): it reads fine in
  isolation and costs nothing today, but it makes every future reader reconcile it
  against `source-hash`/`wiki/sources/`, and that reconciliation never stops being
  paid.

My recommendation: `sources`, assuming a row is a captured artifact.

I checked the wiki for prior guidance on this (read-only, bounded — retrieval was
`hybrid`) and found nothing that settles it, so this rests on the existing code's
meaning. I haven't written anything to the vault. If you want this decision on the
record, I can write it as an ADR under the project's `decisions/` folder — that's a
separate, authorized operation, and I'd include the costs of the choice, not just
the upside."

Stop condition: done when the recommendation and its rationale are delivered in the
conversation, grounded in the existing application meaning, with no vault mutation.
I explicitly decline to file a page: a request to answer a question does not
authorize filing a new page, so recording this as an ADR waits for the user to ask.
I would also stop and ask rather than guess if the code doesn't make clear which
entity the table holds — that ambiguity, not the word choice, is the real question.

---

## Scenario: authorized-discovery

Ordered intended actions:

1. Classify and note authorization once. The user authorized both discovery and
   ingestion, and the vault's known instructions authorize publication. So:
   `/wiki-discover` followed immediately by `/wiki-ingest`, with **no second
   confirmation** between them, and an authorized push at the end of each
   operation. I reuse that authorization rather than re-asking.
2. Phase 0 — dedup before searching. Collect known source URLs via
   `clip.mjs`'s `knownSourceUrls(vaultPath)` (equivalently, grep `^source:` across
   `raw/clippings/*.md`) — reading the clippings themselves, not an index built
   from them, so it stays correct while the index is stale.
3. Sanity-check that set: if `raw/clippings/` has files on disk but the known-URL
   set comes back empty, the collection step failed — I **stop** there rather than
   searching, because proceeding would re-clip everything the vault already has.
4. Name the gap precisely. "The gap in our Atlas offline guide" is not yet a
   research question, so I read the guide at
   `wiki/authored/atlas/guides/user.md`, run bounded wiki searches, and read the
   relevant task MOC and the leading concept/synthesis pages. I read only the
   manual "Start here" section of `index.md` if I need orientation — never its
   generated catalog as a coverage summary. Output: one unanswered question plus a
   one-line "already covered" summary, both passed to every perspective.
5. Phase 1 — five perspective researchers in parallel. Claude Code supports agent
   fan-out, so I dispatch five read-only agents in a single message: academic,
   technical, applied, news/trends, contrarian. Each receives the topic, the
   known-URL set, the coverage summary and its lens; each runs 2–3 varied
   searches, pre-skips blocklisted domains, fetches promising hits, and **returns**
   `{title, url, quality_guess, key_findings, why_ingest, adds_evidence,
   changes_page}`. They write nothing to the vault — `clip.mjs` is the only writer
   to `raw/`.
6. Phase 2 — I grade as orchestrator; a finder never grades its own find. Dedup by
   normalized URL (drop `#fragment` and trailing `/`), drop anything in the
   known-URL set, drop blocked domains, drop anything already in
   `.wiki-master/declined.json`. Score survivors with the rubric (+2
   peer-reviewed/primary/official, +1 recent where recency matters, +1
   credentialed author or authoritative org, +1 corroborated by another
   perspective, −1 vendor-primary/promotional/single-blogger) into
   high ≥4 / medium 2–3 / low 0–1 / reject <0. The user asked for up to two
   *authoritative* sources, so I keep the top two favouring `high`.
7. Open the discover operation **before the first decline or clip write**:
   `node "<plugin>/scripts/op-begin.mjs" --op discover`, token saved, using the
   PowerShell template with the environment restored in `finally`. Record every
   rejected candidate so it is never re-litigated:
   `node "<plugin>/scripts/clip.mjs" "<url>" --decline="<one-line reason>"`.
   An unrecorded reject is indistinguishable from "never seen" and comes back
   every run; declines carry a 180-day TTL, so a changed world gets one
   re-evaluation.
8. Phase 3 — clip the two survivors, reusing the same operation and the **same
   `--topic` string for every clip in the run** (the user's own wording), because
   that string is what groups this run's leftovers in `/wiki-triage`:

   ```
   node "<plugin>/scripts/clip.mjs" "<url>" --quality=high --topic="Atlas offline gap"
   ```

   A candidate that is a PDF, Word file or spreadsheet does **not** go through
   `clip.mjs` — it goes through `clip-pdf.mjs` / `clip-docx.mjs` /
   `clip-xlsx.mjs`, and each of those takes `--source=<url> --quality= --topic=`
   too. Forgetting `--topic` on a binary path is the most likely failure in this
   run and the loss is silent and permanent (topic is recorded going forward only),
   so I pass it on every single clip. A Confluence Cloud URL routes to
   `clip-confluence.mjs`, not `clip.mjs`, which has no auth and would read as thin
   content and auto-decline.
9. Handle outcomes honestly: `thin content` means SPA/paywall and `clip.mjs`
   auto-declines it — I report it for manual clipping rather than retrying blindly.
   A `failed` (403/transient) result is not auto-declined and may recover. Both are
   queued to `.wiki-master/triage.jsonl` automatically, and I point the user at
   `/wiki-triage` with counts rather than relying on my prose to carry them.
10. Phase 4 — **finish the capture operation before any pause.** Validate the
    returned clipping paths, write one discover log entry naming clipped /
    declined / failed counts via `log-entry.mjs --op discover`, then
    `op-commit.mjs --op discover --title "Atlas offline gap → 2 clipped" --since <token>`,
    verify the changed paths and the index-refresh notice, and push (already
    authorized). Clippings must not sit dirty while an ingest decision is pending.
    If no writes happened at all, I report that and manufacture neither log nor
    commit.
11. Ingest immediately in a **fresh** operation — ingestion is already authorized,
    so no second confirmation: `op-begin.mjs --op ingest`, token saved. I process
    the named clipping set, not the global backlog, because concurrent ingests can
    overwrite shared concept pages.
12. For each clipping: read the exact file from disk, discuss the key takeaways,
    then write `wiki/sources/<slug>.md` with `type: source`, `ai-generated: true`,
    typed `created`/`updated`/`reviewed`, and
    `sources: ["[[raw/clippings/<exact filename>.md]]"]` — quoted, and the path
    **copied from the file I just read**, never retyped from the source's title.
    The clipper slugifies titles (`/`, `:`, `#`, `*`, `?`, quotes, brackets → `-`,
    then a 120-char cap), so a remembered title routinely names a file that does
    not exist, producing a `provenanceGap` while the clipping still reads as
    unparsed. I also record `source-hashes: [<sha256>, …]` read out of each
    clipping's frontmatter — that hash is the machine key the backlog metric joins
    on, immune to filename drift.
13. Before creating any concept, run identity checks: search the proposed title,
    equivalent wording and nearby passages, and if ambiguity is suspected run
    `node "<plugin>/scripts/identity-audit.mjs" --json`. Then choose explicitly —
    extend the canonical page, add a genuinely equivalent `aliases:` entry, or
    create a distinct concept with a one-sentence `scope:`. I never merge on
    embedding similarity alone. Each `## Relationships` link gets a sentence
    naming the role (broader/narrower/prerequisite/complements/alternative/
    contrasts/applies-to) and its limits; relatedness is not support.
14. Verify before writing any quote or figure: the clipping outranks the
    perspective agent's `key_findings`, my summary, and my memory — every layer
    between the source and the page is a lossy compressor whose errors read like
    facts. Where the two new sources disagree with each other or with an existing
    page, I keep the claims separate and attributed and disclose the contradiction
    rather than resolving it into one voice. I stamp `reviewed` only on pages whose
    factual claims I actually checked; pages that got only a link or metadata edit
    keep their existing `reviewed`.
15. Update the Atlas task MOC the new knowledge answers, regenerate the catalog
    with `index-gen.mjs`, write one ingest log entry, then
    `op-commit.mjs --op ingest --title "<what was ingested>" --since <token>`,
    verify it, and push. Never edit anything under `raw/`.
16. Document what changed, as the user asked: which wiki pages the evidence
    actually moved, which claim each new source settles, and what it did not
    settle.

Sample user response after a successful path:

"Two authoritative sources found, clipped and ingested. Both operations are
committed and pushed.

The gap I searched against: `<the unanswered question from the Atlas offline
guide>`. Already covered in the vault: `<one line>`. Known-URL dedup ran against 47
existing clippings.

Kept (of 19 candidates from five lenses):
1. `<title>` — `<url>` — **high** (+2 official spec, +1 recent, +1 authoritative
   org). Settles `<question>`; changes `wiki/concepts/<X>.md`.
2. `<title>` — `<url>` — **high** (+2 primary, +1 corroborated by the academic and
   technical lenses). Settles `<question>`; changes `wiki/syntheses/<Y>.md`.

Skipped: 3 duplicates of URLs already in `raw/clippings/`, 1 blocked domain,
2 already in the decline log, 11 declined and recorded with reasons (so they won't
come back next run). 1 candidate came back `thin content` (paywalled SPA) and was
auto-declined — it's queued in `/wiki-triage` if you want to clip it by hand.

Ingest — what actually changed:
- New `wiki/sources/<slug-1>.md` and `wiki/sources/<slug-2>.md`, each citing its
  clipping by exact path and recording its `source-hash`.
- Extended the existing canonical concept `wiki/concepts/<X>.md` rather than
  creating a near-duplicate — the proposed title turned out to be equivalent
  wording, so it went in as an alias.
- `wiki/syntheses/<Y>.md` updated: source 2 supports `<claim>`; source 1 disagrees
  with it on `<point>`, so both are stated and attributed rather than blended. I
  verified every quote against the clippings; one figure in a candidate summary was
  wrong and the clipping's value is what landed on the page.
- Still open: neither source addresses `<sub-question>`. That gap is unchanged.
- Updated the Atlas task MOC and regenerated the index catalog.

Operations: discover commit `<sha1>` (2 clippings + declines), ingest commit
`<sha2>` (5 files), both pushed to `origin/main`, upstream verified. Index refresh
after commit reported `<notice>`."

Stop condition: done when exactly the authorized number of sources are clipped and
ingested, both operations carry one log and one verified commit each, the authorized
push is verified for both, and the report names what changed and what remains
unsettled. Hard stops: if the known-URL set is empty while clippings exist on disk I
stop before searching (failed collection step); if every candidate is a duplicate,
blocked or already declined I report that no clip was made and manufacture no log or
commit; a `thin` result is reported for manual handling rather than retried; and a
rejected push stops the sync — I report the unpushed commits and never force.

---

## Scenario: discovery-only

Ordered intended actions:

1. Classify and bound the authorization precisely: clipping is authorized,
   ingestion is not. "Let me review them before adding them to the wiki" is an
   explicit decision pause. So I run `/wiki-discover` Phases 0–4 and stop there. I
   do not write a `wiki/sources/` page, do not create or extend a concept, do not
   touch a task MOC.
2. Phase 0 identical to the authorized case: collect known source URLs from
   `clip.mjs`'s `knownSourceUrls(vaultPath)` (or `^source:` across
   `raw/clippings/*.md`), and stop outright if that set is empty while clippings
   exist on disk. Name the unanswered question behind the Atlas offline gap, run
   bounded wiki searches, read the relevant MOC and leading concept/synthesis
   pages, and produce the one-line coverage summary.
3. Phase 1: five read-only perspective agents dispatched in one message — academic,
   technical, applied, news/trends, contrarian — each returning ranked candidates
   with `adds_evidence` and `changes_page`. They write nothing.
4. Phase 2: dedup by normalized URL, drop known/blocked/declined, score with the
   rubric, keep the two the user asked for.
5. Open the operation before the first decline or clip write:
   `op-begin.mjs --op discover`, token saved. Record every reject with
   `clip.mjs "<url>" --decline="<reason>"` so settled candidates stay settled.
6. Phase 3: clip the two survivors with the same `--topic` string on every clip
   (the user's own wording), routing PDFs/Word/spreadsheets to
   `clip-pdf.mjs`/`clip-docx.mjs`/`clip-xlsx.mjs` with `--source`, `--quality` and
   `--topic`, and a Confluence URL to `clip-confluence.mjs`. Raw bodies are
   immutable — I never edit what the clipper wrote, and its frontmatter is pipeline
   state, not something I hand-edit.
7. Record capture limits explicitly, as the user asked. For each clip I report what
   the capture actually is: a clean extraction, a `thin content` decline
   (SPA/paywall — auto-declined, needs manual clipping, not a blind retry), a
   `failed` 403/transient result (not auto-declined, may recover), or a degraded
   extraction. A degraded capture is evidence of what the vault *holds*, not of
   what the author typed, so it cannot establish exact quotes later — I say that
   now, while the user is deciding, rather than letting it surface during a future
   ingest.
8. **Finish the capture operation before the pause**, which is the part it would be
   easy to skip: validate the returned clipping paths, write one discover log entry
   with clipped/declined/failed counts, then
   `op-commit.mjs --op discover --title "Atlas offline gap → 2 clipped" --since <token>`
   and verify it. Clippings must not remain dirty while waiting for the user's
   decision. If session or vault instructions already authorize sync I push and
   verify upstream; otherwise I report the unpushed commit and only ask about
   publishing if publishing is actually needed.
9. Point at `/wiki-triage` with counts for anything queued, and queue anything else
   needing human judgement with `recordIssue(vaultPath, {url, kind: 'attention',
   reason})`.
10. Ask whether to ingest, and wait. If the answer is yes, ingest the named set in a
    **fresh** operation; if no, the committed clippings simply stay for manual
    review.

Sample user response after a successful path:

"Two sources clipped and committed. Nothing has been added to the wiki — no source
pages, no concepts, no MOC edits. They're sitting in `raw/clippings/` for your
review.

1. `<title>` — `<url>` — **high** (+2 official spec, +1 recent, +1 authoritative
   org) → `raw/clippings/<slug-1>.md`. Clean extraction, full body preserved.
   Answers `<question>`; would change `wiki/concepts/<X>.md`.
2. `<title>` — `<url>` — **medium** (+2 primary, −1 vendor-published) →
   `raw/clippings/<slug-2>.md`. **Capture limit:** the code blocks and one table
   came through partially — good enough to judge the argument, not reliable at
   character level, so exact quotes from it would need checking against the live
   page. Answers `<question>`; would change `wiki/syntheses/<Y>.md`.

Also from the run: 4 duplicates of URLs already in the vault, 1 blocked domain,
9 declined with recorded reasons, and 1 `thin content` result (paywalled SPA,
auto-declined) plus 1 `failed` 403 — both queued in `/wiki-triage` if you want to
handle them by hand. The 403 may well recover on a retry later; the paywalled one
won't without manual clipping.

Capture operation is closed: discover commit `<sha>`, 2 clippings + the decline
records, so nothing is left dirty while you decide. `<pushed to origin/main and
verified | held locally — say the word if you want it pushed>`.

Want me to ingest these two? I'll do it in a fresh operation and write up what each
one changes."

Stop condition: done when both sources are clipped, their capture limits are stated,
the discover operation has one log entry and one verified commit, triage counts are
reported, and the ingest question is put to the user. I stop at exactly that point —
the explicit blocker is that ingestion was not authorized, so no `wiki/sources/`
page, concept, alias or MOC edit gets written no matter how obviously useful it
looks. I would also stop before searching if the known-URL dedup set came back empty
with clippings on disk.

---

## Scenario: uncertain-write

Ordered intended actions:

1. Treat the timeout as what it is: **a timed-out mutation has an uncertain
   outcome.** An exit code or a timeout alone does not establish that nothing ran,
   and OS lock release after process death cannot prove a surviving CLI child or an
   already-submitted Obsidian mutation did not finish. So the first action is an
   inspection, not a write.
2. Do **not** retry the `note-create` call, and do **not** create the page under a
   variant filename. Both are the specific failures this situation produces:
   a duplicate page, or a blind overwrite of a write that actually landed.
3. Read the exact known target path directly from the filesystem under the vault
   root — e.g. `C:/vault/wiki/authored/atlas/guides/user.md` — since filesystem
   access works. Three outcomes to distinguish:
   - **Absent** → the mutation did not land; I author it normally.
   - **Present and complete** → it landed; I validate it and finish the remaining
     operation steps rather than rewriting it.
   - **Present but partial** (truncated body, missing or malformed frontmatter) →
     I complete it in place, preserving what is there.
4. Check that the timed-out call did not land the page *somewhere else*. The CLI's
   `create name=` resolves by name rather than by exact path, so a partially
   processed create can materialise outside the folder I expect. I run a bounded
   search for the slug and title — `node "<plugin>/scripts/search.mjs" "Atlas
   guide" --json --limit=10` plus a scoped `rg` over `wiki/` — restricted to
   explicit content directories, excluding `.recycle/`, dot folders and dependency
   trees. I do not recursively enumerate the user profile.
5. Check the operation state before opening anything. If an operation token from
   the interrupted attempt is still open, I reuse that operation rather than
   opening a second one — an existing enclosing operation may already own this
   work, and I record who closes it. Only if none is open do I run
   `op-begin.mjs --op relink` and save a fresh token.
6. Finish the write through exact-path filesystem editing, which is the supported
   channel for ordinary Markdown regardless of CLI health. I do not send the note
   body through CLI `content=`, and I do not chunk it into several CLI writes. If
   the file's content changed since I read it, I reconcile rather than overwrite —
   that could be the user's own concurrent work.
7. Validate: `type: authored`, `sources: []`, honest `ai-generated`, matching
   `project:`/`kind:`, canonical placement, resolvable links written as unwrapped
   logical lines. `updated` advances; `reviewed` advances only if I actually
   verified factual claims against evidence or project behaviour.
8. Refresh affected catalogs (`index-gen.mjs`, `moc-authored-gen.mjs --apply`,
   `backlog-gen.mjs --apply` only if a backlog item changed), write **one** log
   entry, then `op-commit.mjs --op relink --title "<summary>" --since <token>` and
   inspect the actual changed paths, the exclusions and the index-refresh notice.
   Sync only if already authorized, and verify upstream.

Sample user response after a successful path:

"Checked before touching anything — the timed-out create had partially landed.

`C:/vault/wiki/authored/atlas/guides/user.md` existed with valid frontmatter but an
empty body, so the mutation did run and then lost its response. I also swept `wiki/`
for the slug and title to make sure the by-name create hadn't dropped a second copy
somewhere else; it hadn't, so there's exactly one page.

I finished it in place rather than re-running the create — a retry would have given
you two Atlas guides or clobbered the frontmatter that survived. The body is now
written, `type: authored`, `sources: []`, `project: atlas`, `kind: guide`,
`updated: 2026-09-11`. I left `reviewed` alone; I didn't re-verify the factual
claims in this pass.

Refreshed the index catalog and the Atlas authored MOC, logged one relink entry, and
committed the 3 changed paths (`<sha>`). `<Pushed and verified | Commit is local —
tell me if you want it pushed.>`"

Stop condition: done when exactly one Atlas guide page exists at the canonical path
with validated content and frontmatter, no duplicate was created anywhere in the
vault, one log entry and one verified operation commit exist, and any authorized sync
is confirmed. I stop and ask instead if the sweep turns up two candidate pages and it
is not clear which is canonical or which one the user wrote — consolidating means
deleting, and removal has its own reviewed-plan contract, so I would not delete on my
own judgement. I also stop and reconcile rather than overwrite if the target's
content changed between my read and my write.

---

## Scenario: app-only

Ordered intended actions:

1. Classify the two asks against the access contract. "Open the Atlas workspace in
   Obsidian" and "show its live graph" are both **app-only** actions — opening a
   note or workspace in the UI, executing an Obsidian/plugin command, reading app
   state and running live Bases queries all require a working Obsidian CLI. There
   is no supported filesystem fallback that performs them.
2. Make exactly one guarded attempt, through the wrapper and through the
   **PowerShell** tool — never the Bash tool on Windows, because Git Bash ignores
   `PATHEXT` and picks the GUI `Obsidian.exe`, which prints nothing and exits 0,
   producing a misleadingly empty result:
   `node "<plugin>/scripts/obsidian.mjs" <command> ...`. I do not launch native
   `obsidian` directly and do not bypass the busy guard.
3. Read the diagnostic rather than guessing. On Windows a dead app exits 1 with
   "The CLI is unable to find Obsidian. Please make sure Obsidian is running and
   try again." — the app not running cannot produce a silent empty, so this is an
   unavailability, not an ambiguous result. No canary probe is warranted; the
   `search query="the" total` canary exists for an *empty* result that is about to
   drive a decision, not for a failed call.
4. After the unavailable CLI, choose the supported path once and stop. I do not
   loop waiting for the app, do not retry on a timer, and do not ask the user to
   restart Obsidian as a precondition for unrelated work.
5. Report the specific unavailable action plainly. I do **not** present any
   filesystem output as though it were the live graph — a filesystem approximation
   did not execute an app action, and saying otherwise would be a false claim about
   what happened.
6. Offer the genuinely available substitute, clearly labelled as a different thing:
   `node "<plugin>/scripts/health.mjs"` and
   `node "<plugin>/scripts/relationships.mjs" --limit=10 --json` build the graph
   from the filesystem and work without Obsidian — these are not gated on
   `assertRunning`. I note that health metrics come from `health.mjs` rather than
   the CLI's `orphans`/`deadends`, which compute their verdicts including
   structural files' links (`index.md` links everything, so nothing ever looks
   orphaned). I run these only if the user wants them.
7. Keep it read-only: no operation, no log, no index rebuild, no commit — a report
   does not open an operation.
8. Tell the user the one thing that would actually unblock it: start Obsidian, then
   I can re-run the app command.

Sample user response after a successful path:

"I can't do either of those right now, and I don't want to hand you a substitute
dressed up as the real thing.

Opening the Atlas workspace in the Obsidian UI and rendering its live graph are
app-only actions — they need a working Obsidian CLI, and there is no filesystem
equivalent that executes them. The guarded call came back exit 1: 'The CLI is unable
to find Obsidian. Please make sure Obsidian is running and try again.' That's a
clean unavailability, not an ambiguous empty result, so I stopped there rather than
retrying in a loop.

Start Obsidian and I'll run the workspace-open and the graph command immediately.

In the meantime, what I *can* give you from the files — and this is a filesystem
analysis, not your live graph, no UI involved:
- `health.mjs` — the real structural report: orphans, broken links, hard-wrapped
  wikilinks, provenance gaps, health score. (Worth noting the CLI's own
  `orphans`/`deadends` are the weaker numbers — they count `index.md`'s links, which
  link everything, so nothing ever reads as orphaned. `health.mjs` builds the graph
  from the filesystem instead.)
- `relationships.mjs --limit=10 --json` — the current link neighbourhood around the
  Atlas pages, as text.

Want either of those while Obsidian starts up?"

Stop condition: this task is only done when Obsidian actually has the Atlas
workspace open and its live graph rendered — which requires a working CLI I do not
have, so I stop at the unavailability report and never claim it happened. The
specific blocker: the guarded `obsidian.mjs` call returns the app-unavailable
diagnostic, and app-only actions have no supported fallback. I decline to substitute
a filesystem graph report for the live graph unless the user accepts it as the
different thing it is.

---

## Files loaded and inherited exposure

Files I read, in full, and nothing else in the repository:

1. `C:/Users/ehart/repos/wiki-master/eval/skill-catalog.md`
2. `C:/Users/ehart/repos/wiki-master/eval/skill-behavior/prompts.json`
3. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/SKILL.md`
4. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/access.md`
5. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/authoring.md`
6. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/evidence.md`
7. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/efficacy.md`
8. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/maintenance.md`
9. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/operations.md`
10. `C:/Users/ehart/repos/wiki-master/skills/wiki-author/SKILL.md`
11. `C:/Users/ehart/repos/wiki-master/skills/wiki-search/SKILL.md`
12. `C:/Users/ehart/repos/wiki-master/skills/wiki-stale/SKILL.md`
13. `C:/Users/ehart/repos/wiki-master/skills/wiki-discover/SKILL.md`
14. `C:/Users/ehart/repos/wiki-master/skills/wiki-ingest/SKILL.md`
15. `C:/Users/ehart/repos/wiki-master/skills/obsidian-cli/SKILL.md`

I did not open `skills/wiki-maintainer/references/workflows.md`, any other skill
body, any script under `scripts/`, or any other file in the repository. No file was
partially read or skimmed by glob/grep in place of reading — the only tool calls I
made were reads of the fifteen files above and the write of this document.

Other context I inherited, not from the repository:

- The task delegation that launched me: the simulation framing, the file whitelist,
  the strict rules, the output format, and the target output path.
- General harness context: the Claude Code system prompt, tool descriptions, the
  available-skills listing (names and one-line descriptions only — no skill bodies
  were loaded via the Skill tool), the available-subagent-types listing, the
  environment block (Windows 11, PowerShell primary, repo root, scratchpad path),
  today's date, and the bypass-permissions operating note.
- User-level instruction files surfaced automatically by the harness, which I did
  not choose to open: `C:/Users/ehart/.claude/CLAUDE.md` (global instructions —
  option-presentation dimensions, git discipline, "the wiki is the source of truth")
  and the auto-memory index at
  `C:/Users/ehart/.claude/projects/C--Users-ehart-repos-wiki-master/memory/MEMORY.md`
  (two one-line memory summaries; I did not open the linked memory files). A git
  status snapshot and commit-attribution boilerplate also arrived in that block.

Explicitly: I did **not** see, open, search for, or infer the contents of any
`scenarios.json`, any rubric, any grading criteria, any test file, any file under
`eval/` other than `eval/skill-catalog.md` and `eval/skill-behavior/prompts.json`,
`docs/skill-reliability.md`, or any prior evaluation transcript or artifact. The
directory I wrote this file into (`eval/skill-behavior/2026-09-11-pre/`) was created
by the write itself; I did not list or read its siblings.
