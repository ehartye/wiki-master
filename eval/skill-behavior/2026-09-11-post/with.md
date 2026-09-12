# Skill-behavior simulation — 2026-09-11-post (with references)

Simulation only. Nothing below was executed against a real vault; each scenario
records the ordered actions I would take and the response I would send.

Constants used throughout (from each scenario's facts):

- Plugin root: `C:/plugins/wiki-master` — resolved from the installed `SKILL.md`
  location (its skill folder's `../../`), **never** from the current working
  directory `C:/work/widget`.
- Vault: `C:/vault` (`WIKI_MASTER_VAULT`), Obsidian name from
  `WIKI_MASTER_VAULT_NAME` or the folder basename.
- Host: Windows. Obsidian CLI calls go through the **PowerShell tool** or
  `scripts/obsidian.mjs` / `scripts/lib/vault.mjs`, never a bare `obsidian` from
  the Bash tool (Git Bash does not apply `PATHEXT`, so it selects the GUI
  `Obsidian.exe` instead of the `Obsidian.com` redirector and returns misleading
  empty output).
- Every command sets the vault for its own scope and restores the prior value:

```powershell
$wikiPriorVault = $env:WIKI_MASTER_VAULT
try {
  $env:WIKI_MASTER_VAULT = 'C:/vault'
  # ... command ...
} finally {
  $env:WIKI_MASTER_VAULT = $wikiPriorVault
}
```

---

## Scenario: offline-author

Owner skill: **wiki-author** (original project documentation — a user guide — not
captured external evidence, so not wiki-ingest).

Ordered intended actions:

1. Resolve the plugin root from the installed skill location → `C:/plugins/wiki-master`.
   Explicitly do **not** resolve `scripts/` relative to the unrelated cwd
   `C:/work/widget`; a relative `scripts/` path there is not the plugin. Set
   `$env:WIKI_MASTER_VAULT = 'C:/vault'` inside the try/finally shown above.
2. Read `C:/vault/AGENTS.md` and the vault schema **before** any edit, because the
   access contract requires reading local vault instructions before changing it.
   The AGENTS file explicitly exempts this vault from the generic branch rule:
   stay on `main`, bracket writes in an operation, then push. That is a vault
   instruction that overrides my generic "never commit to the default branch"
   habit for this vault only — I follow it and say so in the response rather than
   creating a feature branch the vault has told me not to create.
3. Locate the existing page before choosing a path. Run
   `node "C:/plugins/wiki-master/scripts/search.mjs" "Atlas user guide offline" --json --limit=10`
   and list `C:/vault/wiki/authored/atlas/`. The authoring table's canonical slot
   for "write a user guide" is `wiki/authored/atlas/guides/user.md`, but
   **existing files are not renamed to fit the table** — if the guide already
   sits under a different established filename, I keep that filename and edit in
   place. Read the search stderr status line; if it is not `hybrid`, I disclose
   the degraded retrieval and confirm the page location by direct directory
   listing rather than trusting a lexical-only miss as "no such page".
4. The Obsidian CLI has timed out. That does **not** block this work: ordinary
   Markdown creation and editing use exact-path filesystem edits *even when the
   CLI is healthy*, so a stopped app changes nothing here. I do not ask the user
   to restart Obsidian as a prerequisite, and I do not probe the app first.
5. Read the existing guide at its exact path, and read the actual Atlas offline
   behavior in code — the wiki owns intent, the repo owns behavior.
6. Capture pre-existing dirt before opening: `git -C C:/vault status --porcelain`,
   so I know what `op-begin` will snapshot as already-dirty and `op-commit` will
   therefore exclude. Then open the operation and save the token:
   `$wikiOpToken = node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op relink`
   (authoring uses the `relink` operation vocabulary; there is no `author` op).
7. Edit the guide in place through filesystem writes. Never send the note body
   through CLI `content=`, and never chunk a rejected note into repeated CLI
   writes. Revise the living text to cover offline mode; **do not** stack a dated
   "Update (2026-09-11): offline mode" paragraph on top of the old body — `git
   log` is the changelog. Frontmatter stays `type: authored`, `sources: []`
   (declared explicitly, never by omission), honest `ai-generated: true`,
   `project: atlas`, `kind: guide`.
8. Dates — the scenario's actual discriminator. Set `updated: 2026-09-11`.
   **Preserve `reviewed: 2026-08-01`.** Only the new offline section was checked
   against code; the rest of the guide's factual claims were not re-verified, and
   `reviewed` means the page's claims were checked, not that it was edited. I
   state this in the response instead of silently stamping today's date.
9. Validate placement and links. Any link out of `atlas` to another project's
   bare-named page uses the piped full-path form,
   `[[wiki/authored/<project>/roadmap.md|<project> roadmap]]`, because bare
   `[[roadmap]]` silently resolves to whichever project Obsidian's name index
   picks.
10. Refresh affected catalogs: `node "C:/plugins/wiki-master/scripts/index-gen.mjs"`
    (never hand-edit index.md's generated fence), and
    `node "C:/plugins/wiki-master/scripts/moc-authored-gen.mjs" --apply` if Atlas
    has two or more authored pages. No backlog item changed, so `backlog-gen.mjs`
    is not run. Inspect the generated diff and back out any unrelated project's
    edits the generators swept in.
11. Log exactly once by piping a narrative into
    `node 'C:/plugins/wiki-master/scripts/log-entry.mjs' --op relink --title 'Atlas user guide: offline mode'`.
12. Close: `node 'C:/plugins/wiki-master/scripts/op-commit.mjs' --op relink --title 'Atlas user guide: offline mode' --since $wikiOpToken`.
    Verify the reported changed paths actually contain the guide, and read the
    commit's index-refresh notice for a missing backend or partial build — a
    commit does not establish index freshness. If anything I touched was excluded
    as pre-existing dirt, I report the exclusion rather than sweeping it in;
    never `git add -A`.
13. "Publish it so my laptop can receive it" plus the vault AGENTS instruction is
    existing authorization for sync. `op-commit` never pushes, so run
    `git -C C:/vault push` and verify the result and upstream state. **I do not
    ask again** for publishing that is already authorized.

Sample user response after a successful path:

"Atlas user guide updated and pushed — your laptop can pull it now.

- Edited in place: `C:/vault/wiki/authored/atlas/guides/user.md` — new offline-mode
  section written into the existing text, not appended as a dated update block.
- Frontmatter: `updated` → 2026-09-11. **`reviewed` stays 2026-08-01** — I checked
  the new offline section against the Atlas code, but did not re-verify the rest
  of the guide's claims, so stamping a fresh review date would have overstated
  what was actually confirmed.
- Catalogs: `index-gen.mjs` regenerated; `moc-authored-gen.mjs --apply` refreshed
  the Atlas authored hub. Diff inspected — no other project's pages touched.
- Logged once (`log/2026-09-11-...-relink-atlas-user-guide.md`) and committed via
  `op-commit --op relink`; the commit contains just the guide, the MOC and
  index.md.
- Branch: stayed on `main` per `C:/vault/AGENTS.md`, which exempts this vault from
  the usual feature-branch rule.
- `git -C C:/vault push` succeeded; upstream verified.

One note: the Obsidian CLI was timed out for this whole run. It didn't matter —
Markdown authoring goes through direct filesystem writes regardless — but the
semantic index refresh that `op-commit` attempts reported [status]; search may lag
until the app/embedder is back."

Stop condition: done only when the guide is validated, the affected catalogs
regenerated and inspected, one relink log entry written, the operation commit
verified to contain the expected paths, and the authorized push verified against
upstream. I stop and report instead of claiming success if: `op-begin` fails (no
bracketed write, so no write at all); the push is **rejected** — that is a real
stop for sync, I report the unpushed commit and never force; or the vault turns
out not to be a git repository — then it is local-only and I do not call the page
published.

---

## Scenario: lookup

Owner skill: **wiki-search**. The request is "find what we already know" and
explicitly "do not add anything" — pure retrieval, not wiki-query.

Ordered intended actions:

1. Resolve plugin root and set the vault for the command's scope. This entry
   point is read-only: **no operation, no log, no index refresh, no commit.**
2. `node "C:/plugins/wiki-master/scripts/search.mjs" "if-then planning" --json --limit=10`.
   JSON because I want the bounded passages plus metadata — type, status, project,
   factual review dates, provenance targets and index freshness — to pick the
   right page rather than the top-ranked string match.
3. Read the stderr status line before trusting anything. If it reads
   `(hybrid · N chunks)` I say so; if it reads `(lexical — <what is off> · run
   --health)` I tell the user explicitly that semantic ranking contributed
   nothing, because a confident-looking result list gives them no way to see the
   retrieval was degraded. Channel status is not relevance either way, so I still
   validate the hits against the question. If a channel failed I run
   `node "C:/plugins/wiki-master/scripts/search.mjs" --health` to name the cause
   and report it rather than interpreting thin results as thin knowledge.
4. Resolve the name. "If-then planning" is an **alias** of the canonical concept
   *Implementation Intentions*; exact titles and equivalent aliases are
   prioritized, but an ambiguous name still requires me to choose the intended
   full path — so I report the canonical page by its full path and note that the
   user's phrase is an alias on it, not a separate page.
5. A raw clipping exists, and `raw/` is deliberately excluded from both the
   keyword default and the semantic index. So re-run with `--include-raw`:
   `node "C:/plugins/wiki-master/scripts/search.mjs" "if-then planning" --include-raw`.
   Read the stderr raw-hit-count line (it prints `0` explicitly); an unavailable
   index returning zero raw hits would not establish that raw evidence is absent.
   I reach for this rather than a shell `grep` over the vault.
6. Read each hit **from its matched `path:line` outward**, not from the top of the
   page — the printed line is the passage that actually matched.
7. To show how the wiki page connects to the clipping, pipe the default text
   output through the evidence resolver:
   `node ".../search.mjs" "if-then planning" | node ".../resolve-evidence.mjs"`.
   I report its verdict honestly: a real `unreachable` citation trail is a
   provenance gap worth naming, and `declared-no-provenance` on a
   `wiki/authored/` hit is a deliberate disclosure, not a defect.
8. Return the matching paths and lines. I do **not** synthesize a narrative answer
   and I do not file anything — if a cited synthesis is what they actually want, I
   offer `/wiki-query` as a separate, authorized step.

Sample user response after a successful path:

"Here is what the vault already holds on if-then planning — paths and matched
lines only, nothing added.

Canonical page (your phrase is an alias on it, not a separate page):
- `wiki/concepts/Implementation Intentions.md:14` — `aliases: ["If-then planning"]`;
  the concept page carrying the definition and scope.
- `wiki/concepts/Implementation Intentions.md:41` — the passage that matched your
  terms; read from there rather than the top of the page.

Related wiki pages:
- `wiki/syntheses/<...>.md:<n>` — <one line naming what sits at that line>.

Raw evidence (`--include-raw`; 1 raw hit reported on stderr):
- `raw/clippings/<slug>.md:<n>` — the clipping the concept page cites. This is
  unvetted captured evidence, not a reviewed claim — it is exactly what the
  clipper captured.

`resolve-evidence.mjs` confirms the concept page's citation trail reaches that
clipping.

Retrieval status: `hybrid · N chunks` — both channels contributed. [Or: retrieval
ran **lexical only** because <cause>; these hits are real, but semantic ranking
contributed nothing, so there may be relevant pages worded differently that did
not surface. `search.mjs --setup` prints the fix.]

Nothing was written — no pages, no log, no index refresh. If you want a cited
synthesis of this rather than a list, `/wiki-query` does that."

Stop condition: done when the matching wiki and raw paths/lines are returned with
the retrieval tier and raw-hit count disclosed, and nothing has been written. I
stop and report instead if `search.mjs` fails fatally or the vault root/`wiki/` is
missing — a missing root is an explicit failure, not an empty result — in which
case I fall back once to bounded `rg` over `wiki/` and `moc/` (plus
`raw/clippings/` for evidence lookup only) and state which channel was missing. I
would also stop rather than answer if the user's follow-up turned into "so what
should I do" — that is a synthesis request and belongs to `/wiki-query`.

---

## Scenario: freshness

Owner skill: **wiki-stale** (read-only freshness reporting; applying factual fixes
would be wiki-lint).

Ordered intended actions:

1. Set the vault scope. This entry point is read-only: no operation, no log, no
   index refresh.
2. `node "C:/plugins/wiki-master/scripts/stale.mjs"`. Read its backend diagnostic:
   a failed, invalid or empty CLI query falls back to scoped `wiki/` files at the
   resolved root. A missing root or missing `wiki/` is an **explicit failure**, not
   an empty report, and I would say so rather than reporting "nothing is stale".
   Filesystem access works here, so the fallback path is available even with the
   app down.
3. `node "C:/plugins/wiki-master/scripts/drift.mjs" --coverage`. This is coverage
   only, not an embedding evaluation. I deliberately do **not** run wiki-lint's
   bounded embedding maintenance, because its drift run may write a machine-local
   embedding cache and the user asked for a report.
4. Interpret the given numbers correctly, which is the whole job here:
   - Structural health 100 says the graph is clean. It says nothing about factual
     correctness — a clean graph never establishes that claims still hold.
   - 12 of 40 concepts lack `reviewed` → those are **unverified**, full stop.
   - "Many edited yesterday" is `updated`, which measures edits. Editing never
     makes an old claim fresh, so those pages are not evidence of currency.
   - Drift: **0 evaluated, 10 failed, embedder unavailable.** Zero evaluated drift
     pages cannot establish that the wiki has no drift. I report evaluated /
     skipped / failed counts and refuse to call the unevaluated pages clean.
5. The question asked is "are the **recommendations** still current" — that is a
   claim question, and metadata alone answers what needs review, not whether a
   claim still holds. So I take a bounded, prioritized sample: highest-use and
   most volatile recommendation pages first, using wiki-query's read-only search
   and evidence workflow —
   `node ".../search.mjs" "<recommendation topic>" --json --limit=10`, read the
   matched passages, then `node ".../resolve-evidence.mjs"` on the hits to reach
   the clippings, and check each recommendation's claim against its actual
   evidence. Clippings outrank my memory of a source. Where the evidence is silent,
   that proves "not supported here", never "false".
6. Report stale pages and missing-review pages **separately**, plus drift coverage
   and failures, plus exactly which claims I checked and what the evidence
   supported. State plainly that a bounded sample cannot establish currency for
   the whole wiki.
7. Stamp nothing. `reviewed` advances only after actual factual verification, and
   this run is read-only; applying fixes is `/wiki-lint` and I offer it rather
   than doing it.

Sample user response after a successful path:

"Partly — and the wiki cannot currently tell you for most of itself. Three
different things are being conflated, so here they are separately.

**Factual review status (what `reviewed` says)**
- 12 of 40 concept pages have no `reviewed` date at all. Those are unverified, not
  current — nobody has checked their claims against evidence.
- Stale (reviewed, but long ago): <list from stale.mjs>.
- A lot of pages were edited yesterday. That is `updated`, not verification —
  editing a page does not make its old claims true, so those edits do not move
  anything out of the unverified column.

**Drift coverage**
- `drift.mjs --coverage`: **0 pages evaluated, 10 failed** — the embedder is
  unavailable. I can't say the wiki has no drift; I can only say drift was not
  measured. Once the embedder is back this is worth re-running.

**Structural health: 100** — the link graph is clean. That is not a currency
signal; a perfect graph of stale claims scores 100 too.

**What I actually checked (bounded sample)**
I read the highest-use recommendation pages and traced each to its evidence:
- `wiki/<...>.md` — claim <X> still matches `raw/clippings/<...>.md`. Holds.
- `wiki/<...>.md` — claim <Y> is not supported by the clipping it cites; the
  clipping is silent on it. That means unsourced, not wrong.
- `wiki/<...>.md` — citation trail is unreachable; provenance gap.

That sample cannot establish currency for the other ~30 pages.

Nothing was written or stamped — no `reviewed` dates advanced, no operation
opened. If you want the safe fixes applied, `/wiki-lint` owns that."

Stop condition: done when the metadata report (stale vs missing-review, kept
distinct), the drift coverage with its failure counts, and the bounded claim check
with its explicit limits are all delivered, and nothing was written. I stop and
report failure instead if the vault root or `wiki/` is missing — that is an
explicit failure rather than an empty report. I also stop short of running the
drift path that writes an embedding cache, and short of stamping any `reviewed`
date, since neither belongs in a read-only freshness answer.

---

## Scenario: naming-near-miss

This is the near-miss: the word "sources" is core wiki vocabulary, but the request
is about an application's database schema. The shared core is explicit — **ordinary
application code work is not a wiki operation unless it uses or updates the
vault**. No wiki write was requested. So the answer comes from the application's
own meaning, with at most a bounded read-only wiki lookup under the standing
"check the wiki before guessing" instruction.

Ordered intended actions:

1. Classify first, before touching anything: no vault write is requested and the
   table belongs to application code, so this is **not** a wiki authoring or
   ingest operation. That decides everything downstream — no `op-begin`, no log,
   no commit, no index refresh, no new page.
2. Answer from the existing application meaning, which means reading the code, not
   the wiki. In the application repo: `rg -n -w 'sources|citations'` over the
   source tree excluding dependency trees, plus the schema/migrations directory
   and any ORM models, to find what the codebase already calls this thing and
   what each word already means there. Existing vocabulary wins over a fresh
   naming opinion — a schema that already says `source_id` everywhere settles it.
3. Under the standing research instruction, run **one bounded, read-only** wiki
   lookup before reaching for the web or memory:
   `node "C:/plugins/wiki-master/scripts/search.mjs" "sources citations naming schema" --json --limit=10`,
   narrowed with `--project=<slug>` if the question establishes a scope. Read the
   stderr status line and disclose it if the tier is not `hybrid`. This is pure
   retrieval — it opens no operation and writes nothing.
4. Guard against the near-miss itself: wiki-master's own `sources:` frontmatter
   and `raw/` vocabulary describe *the vault's* provenance model. Unless this
   application actually reads or writes the vault, that vocabulary does not govern
   its schema, and I say so rather than importing it by word association.
5. Answer with a recommendation grounded in what the two words already mean in
   this codebase, citing any wiki page I consulted by path, and saying plainly if
   the wiki held nothing relevant. Give the distinction that actually decides it:
   a *source* is the artifact itself (one row per document/URL), a *citation* is a
   reference event linking something to a source (many per source) — so if rows
   are one-per-document, `sources`; if rows are one-per-reference, `citations`;
   if the schema needs both, they are two tables, not a naming choice.
6. Offer, without performing, to record the decision as an ADR at
   `wiki/authored/<project>/decisions/<slug>-adr.md` — that would be a vault write
   and needs its own authorization.

Sample user response after a successful path:

"`sources` — assuming each row is one document/URL, which is what the existing
code implies.

From the codebase, not from a style preference: <file:line> already uses
`source_id` / `source_url` on the ingest path, and `citation` appears only in
<file:line> rendering text. Naming the table `citations` would leave two words for
one concept and make the existing columns read wrong.

The distinction worth making explicit, in case it changes the answer:
- **sources** — one row per artifact (a document, a URL, a paper). Identity is the
  artifact.
- **citations** — one row per *reference to* an artifact. Identity is the
  reference; many citations point at one source.

If you ever need both — the same document referenced from ten places, with
per-reference locators — those are two tables, and the naming question dissolves.

I checked the wiki first: `wiki/<...>.md:<n>` <what it says> [or: nothing in the
vault addresses this naming question]. Retrieval ran `hybrid`. Note that
wiki-master's own `sources:` frontmatter is the vault's provenance field and has
no bearing on your application's schema unless this app reads the vault.

I didn't write anything to the wiki — none was asked for. Say the word if you want
this recorded as an ADR under `wiki/authored/<project>/decisions/`."

Stop condition: done when a recommendation grounded in the codebase's existing
meaning is delivered, with any consulted wiki page cited by path and the retrieval
tier disclosed. I stop and ask rather than acting if the user wants the decision
**recorded** in the wiki — that is an authored ADR, a vault write, and needs
explicit authorization plus the full operation contract. I also stop rather than
answer from the wiki alone if the codebase evidence and a wiki page disagree: the
repo wins on what the code actually does, and the disagreement itself is worth
reporting.

---

## Scenario: authorized-discovery

Owner skills: **wiki-discover**, then **wiki-ingest**. Both discovery and
ingestion are explicitly authorized, and vault instructions authorize publication
— so no confirmation is asked at any handoff.

Ordered intended actions:

1. Set vault scope; resolve the plugin root from the installed skill location.
2. **Phase 0 — dedup before searching.** Collect known source URLs via
   `clip.mjs`'s `knownSourceUrls('C:/vault')` (equivalently, grep `^source:`
   across `C:/vault/raw/clippings/*.md`). This reads the clippings themselves
   rather than an index built from them, so it stays correct while the index is
   stale. **Sanity check:** if `raw/clippings/` has files on disk but the known-URL
   set comes back empty, the collection step failed — STOP, do not search, do not
   clip a pile of duplicates.
3. Still Phase 0 — name the unanswered question precisely ("what does the Atlas
   offline guide fail to answer?"), run bounded `search.mjs` lookups, and read the
   relevant task MOC plus the leading concept/synthesis pages. Read only the
   manual "Start here" section of `index.md` if orientation is needed — never load
   the generated catalog as a coverage summary. Write a one-line "already covered"
   summary and state the specific evidence gap.
4. **Phase 1 — five perspective researchers in parallel.** Claude Code supports
   agent fan-out, so dispatch five read-only agents in one message: academic,
   technical, applied, news/trends, contrarian. Each gets the topic, the known-URL
   set, the coverage summary and its lens; each runs 2–3 varied searches,
   pre-skips blocklisted domains, fetches promising hits, and **returns** ranked
   candidates as `{title, url, quality_guess, key_findings, why_ingest,
   adds_evidence, changes_page}`. The perspectives write nothing — `clip.mjs` is
   the only writer to `raw/`.
5. **Phase 2 — I grade, not the finders.** Over the pooled candidates: normalize
   URLs (drop `#fragment` and trailing `/`) and dedup; drop anything in the
   known-URL set; drop blocked domains; drop anything in
   `.wiki-master/declined.json` so settled candidates are not re-argued. Score the
   survivors: +2 peer-reviewed/primary/official, +1 recent (≤3 yr) where recency
   matters, +1 credentialed author or authoritative org, +1 corroborated by a
   second perspective (max +1), −1 vendor-primary/promotional/single-blogger.
   Tiers high ≥4, medium 2–3, low 0–1, reject <0. Keep the top **two**, as asked.
   Each keeper must name what evidence it adds and which page it changes — more
   material on an already-answered question is not an improvement.
6. **Before the first decline or clip write**, open the operation and save the
   token: `$tok = node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op discover`.
   Then record **every** reject so it is never re-litigated:
   `node 'C:/plugins/wiki-master/scripts/clip.mjs' "<url>" --decline="<one-line reason>"`
   (declines carry a 180-day TTL, so a changed world gets one re-evaluation).
7. **Phase 3 — clip the survivors**, reusing that operation:
   `node '.../clip.mjs' "<url>" --quality=<tier> --topic="<topic exactly as the user gave it>"`.
   **The same `--topic` string on every clip in the run**, or one run fragments
   into several triage groups. Route by file type, because these bypass `clip.mjs`
   and are where topic attribution is most often lost — and topic is recorded
   going forward only, never retro-fitted:
   - PDF → `node '.../clip-pdf.mjs' "<file.pdf>" --source="<url>" --quality=<tier> --topic="<topic>"`
   - Word → `clip-docx.mjs` with the same three flags
   - Spreadsheet → `clip-xlsx.mjs` with the same three flags
   - Confluence Cloud URL → `clip-confluence.mjs` (needs the optional `confluencer`
     plugin; `clip.mjs`'s anonymous fetch would read it as thin content and
     auto-decline it).
   A `thin content` result means SPA/paywall and is auto-declined — report it for
   manual clipping, do not retry blindly. A `failed` result (403/transient) is
   **not** auto-declined and may recover.
8. **Phase 4 — finish the capture before any pause.** Validate the returned
   clipping paths on disk, write one discovery log entry naming the
   clipped/declined/failed counts, then
   `node '.../op-commit.mjs' --op discover --title "<topic> → N clipped" --since $tok`.
   Verify the commit. Clippings must not sit dirty. `clip.mjs` queues `failed`,
   `thin` and `wrong-node` outcomes to `.wiki-master/triage.jsonl` automatically —
   I point the user at `/wiki-triage` with counts rather than relying on my prose
   to carry them. Vault instructions authorize publication, so `git -C C:/vault push`
   and verify upstream.
9. **Ingest immediately — no second confirmation**, because discover-and-ingest was
   explicitly authorized. Open a *fresh* operation:
   `$itok = node '.../op-begin.mjs' --op ingest`. I ingest the **named** clipping
   set from this run, so I do **not** run `health.mjs --backlog` — the hash-join
   backlog metric is for an empty-argument backlog run, not a named set.
10. For each clipping: read the exact file, discuss the key takeaways, then write
    `wiki/sources/<slug>.md` with `type: source`, `ai-generated: true`, typed
    `created`/`updated`/`reviewed`, and
    `sources: ["[[raw/clippings/<exact filename>.md]]"]` — **quoted**, and the
    filename **copied from the path I just read**, never retyped from the source's
    title. The clipper slugifies titles (`/ : # * ?`, quotes and brackets all
    become `-`, then a 120-char cap), so a remembered title produces a link to a
    file that does not exist and turns a correct ingest into a provenance gap.
    Also record `source-hashes: [<sha256>, …]` read from each clipping's own
    frontmatter — that is the machine key the backlog metric joins on, immune to
    filename and citation drift.
11. Concepts (this is where the conditional efficacy reference genuinely applies):
    before creating anything, search the proposed title, equivalent wording and
    nearby passages; then choose explicitly — extend the canonical page, add a
    genuinely equivalent alias (`aliases:` name the *same* concept; broader,
    narrower and complementary ideas stay separate pages), or create a distinct
    concept with a one-sentence `scope:`. Run
    `node '.../identity-audit.mjs' --json` if ambiguity is suspected; never merge
    on embedding similarity alone. Relationships go under `## Relationships` using
    the role vocabulary (broader / narrower / prerequisite / complements /
    alternative / contrasts / applies-to), each with a sentence explaining the
    relationship **and its limits**. Update the Atlas offline task MOC this
    evidence helps answer. Preserve `reviewed` on pages that received only
    metadata or link edits.
12. Regenerate the catalog with `node '.../index-gen.mjs'`; log once by piping the
    narrative into `log-entry.mjs --op ingest --title '<what was ingested>'`; close
    with `op-commit.mjs --op ingest --title '<...>' --since $itok`; verify the
    changed paths and the index-refresh notice. Push (already authorized) and
    verify. Never edit anything under `raw/`.
13. Document what changed, per the facts: which wiki pages moved, and which
    captured passage drove each change.

Sample user response after a successful path:

"Two sources found, clipped, ingested and pushed. Both operations are committed.

**Gap targeted:** the Atlas offline guide does not say <specific unanswered
question>. Existing coverage: <one line>. Known-URL dedup collected N existing
clipping URLs first, so neither of these duplicates what you already have.

**Kept (2 of M candidates):**
1. <Title> — <url> — **high**. Adds: <evidence>. Changes: `wiki/concepts/<...>.md`.
2. <Title> — <url> — **medium**. Adds: <evidence>. Changes: `wiki/sources/<...>.md`.

**Declined and recorded** (so they don't come back next run): <n> candidates —
<one-line reasons>. Declines expire after 180 days.

**Captured:** `raw/clippings/<slug-1>.md`, `raw/clippings/<slug-2>.md`, both
tagged `topic: "<topic exactly as you wrote it>"`.
Committed as `discover` with a log entry; pushed.

**Ingested** (fresh `ingest` operation):
- `wiki/sources/<slug-1>.md`, `wiki/sources/<slug-2>.md` — each cites its clipping
  by exact filesystem path and records the clipping's `source-hash`.
- `wiki/concepts/<Canonical>.md` — **extended**, not duplicated: <candidate title>
  is the same concept under different wording, so it went in as an alias with the
  new evidence, rather than becoming a near-duplicate page.
- `moc/<atlas-offline>.md` — the task map now answers <question>.
- `index.md` catalog regenerated; logged once; committed; pushed and upstream
  verified.

**Needs your eyes:** <n> link(s) hit `failed`/`thin` and are queued — run
`/wiki-triage` to disposition them. A `thin` result means paywall/SPA, so it needs
a manual clip rather than a retry."

Stop condition: done when at most two genuinely new sources are captured with
consistent `--topic`, every reject is recorded, the discover operation is logged,
committed and pushed, the named set is ingested into `wiki/sources/` with
exact-path provenance plus `source-hashes`, concept identity is resolved
explicitly, the task map and index are refreshed, and the ingest operation is
logged, committed and pushed with both commits verified. I stop instead if: the
known-URL set is empty while clippings exist on disk (collection failed — do not
search); every candidate is a duplicate or scores below zero (report no
gap-filling source and clip nothing rather than clipping filler); a clip returns
`thin` (report for manual capture, never retry blindly); or the push is rejected
(report the unpushed commits, never force).

---

## Scenario: discovery-only

Owner skill: **wiki-discover**. Clipping is authorized; **ingestion is not**. The
handling is identical to `authorized-discovery` through Phase 4, then diverges.

Ordered intended actions:

1–8. Exactly as in `authorized-discovery`: vault scope; Phase 0 known-URL dedup
   from `raw/clippings/*.md` with the empty-set STOP check; named gap plus bounded
   coverage read (manual "Start here" only, never the generated catalog); five
   read-only perspective agents in parallel that return candidates and write
   nothing; independent dedup/blocklist/decline-log filtering and rubric scoring
   as the orchestrator; `op-begin.mjs --op discover` opened **before the first
   decline or clip**, token saved; every reject recorded with
   `clip.mjs "<url>" --decline="<reason>"`; then clip the two survivors with the
   **same `--topic` string** on every call, routing PDFs to `clip-pdf.mjs`, Word
   to `clip-docx.mjs`, spreadsheets to `clip-xlsx.mjs` and Confluence URLs to
   `clip-confluence.mjs`, each with `--source=`, `--quality=` and `--topic=`.

9. Preserve the raw bodies exactly as captured — `raw/` bodies are immutable, and
   frontmatter is pipeline state that only wiki-master tooling touches. I do not
   "tidy" a messy extraction.
10. **Record capture limits explicitly**, as the facts require: for each clip, note
    whether extraction was complete or degraded, whether the page was paywalled or
    SPA (`thin content`, auto-declined), whether a fetch `failed` (403/transient —
    *not* auto-declined, may recover), and that a degraded capture is evidence of
    what the vault holds, not of what the author wrote, so it cannot establish
    exact quotes later.
11. **Finish the capture operation before the decision pause** — this is the part
    that is easy to get wrong. Validate the returned clipping paths, write one
    discovery log entry naming clipped/declined/failed counts, and close with
    `op-commit.mjs --op discover --title "<topic> → 2 clipped" --since $tok`.
    Clippings must not sit dirty while waiting on the user's review decision. Push
    only if sync is already authorized; otherwise report the unpushed commit.
12. Point at `/wiki-triage` for anything `clip.mjs` queued to
    `.wiki-master/triage.jsonl`, with counts.
13. **Stop here and ask.** Only discovery was authorized, so I present the ranked
    list and the captured paths for review and wait. I do **not** open an ingest
    operation, do **not** write any `wiki/sources/` page, do **not** create or
    alias any concept, and do **not** touch the task map or regenerate the catalog
    for ingest purposes.

Sample user response after a successful path:

"Two sources clipped and committed, nothing ingested — they're waiting on your
review.

**Gap targeted:** <specific unanswered question in the Atlas offline guide>.
Existing coverage: <one line>. Deduped against N known clipping URLs first.

**Clipped:**
1. `raw/clippings/<slug-1>.md` — <Title> — <url> — quality **high**.
   Capture: full HTML extraction, clean. Adds: <evidence>. Would change:
   `wiki/concepts/<...>.md`.
2. `raw/clippings/<slug-2>.md` — <Title> — <url> — quality **medium**.
   Capture: **PDF, partial extraction** — <what was lost, e.g. tables/figures did
   not survive>. Usable for the argument, not reliable at character level, so it
   can't be the basis for an exact quote without re-checking the original.

Both carry `topic: "<topic exactly as you wrote it>"`, so they'll group together
in triage.

**Declined and recorded:** <n> — <reasons>. (180-day TTL, so they get one
re-evaluation if the world changes.)
**Needs a human:** <n> queued to `/wiki-triage` — <k> `failed` (transient, may
recover on retry), <j> `thin` (paywall/SPA, needs a manual clip).

The capture is committed as a `discover` operation with one log entry, so the
clippings aren't sitting dirty while you decide. [Pushed / Committed locally;
unpushed — say the word if you want it published.]

The raw bodies are untouched and stay that way. **Want me to ingest these two?**
That's a separate step — it would write `wiki/sources/` summaries, extend or
create the affected concept, and update the task map. I'll wait."

Stop condition: done when both sources are captured (or their failures precisely
reported), capture limits are recorded per clipping, every reject is logged as a
decline, the discover operation has one log entry and a verified commit, triage
counts are surfaced, and the ingest question has been asked. **The stop is the
ingestion decision itself** — ingestion requires authorization for this scope and
the user explicitly reserved it, so I wait rather than proceeding. I would also
stop earlier if the known-URL set came back empty with clippings on disk, or if
both candidates turned out to be duplicates of existing evidence.

---

## Scenario: uncertain-write

Owner skill: **wiki-author**, governed by the access contract's uncertain-mutation
rule. The defining constraint: a timed-out mutation has an **uncertain outcome** —
an exit or timeout alone does not establish that nothing ran.

Ordered intended actions:

1. **Do not retry the `note:create` call, and do not create a second page.** That
   is the failure mode this rule exists to prevent. OS cleanup releasing the lock
   after process death cannot prove that a surviving CLI child or an
   already-submitted Obsidian mutation did not finish.
2. **Inspect the exact target first.** The path is known, and filesystem access
   works:
   - `Test-Path 'C:/vault/wiki/authored/atlas/guides/user.md'`, and read it if it
     exists — I need to know not just whether a file is there but whether its
     body and frontmatter are complete or half-written.
   - List `C:/vault/wiki/authored/atlas/guides/` and `C:/vault/wiki/authored/atlas/`
     for a near-duplicate created under a different name — CLI `file=` resolves by
     name like a wikilink while `path=` is exact, so a timed-out create can land
     somewhere other than the path I expected.
   - `git -C C:/vault status --porcelain` to see exactly what the timed-out call
     left dirty.
3. Branch on what is actually there, not on what the timeout implied:
   - **Nothing created** → author the page fresh.
   - **Complete and correct page** → the mutation succeeded and only the response
     was lost. Nothing to re-create; validate and finish the operation contract.
   - **Partial/empty/frontmatter-only stub** → repair that exact file in place.
   - **Two candidate pages** → stop and ask which to keep (see stop condition); do
     not delete one on my own judgment.
4. Note a real interaction before opening the operation: `op-begin` snapshots
   already-dirty paths and `op-commit` **excludes** them, so if the timed-out
   write already left the target file dirty, opening an operation now would leave
   that file out of my commit. I record the pre-existing `git status` from step 2,
   then open `$wikiOpToken = node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op relink`
   and, at close, either confirm the guide is in the committed paths or report the
   exclusion explicitly rather than silently leaving the page uncommitted — and
   never `git add -A` to force it.
5. Write the remaining content through **exact-path filesystem edits**. Ordinary
   Markdown bodies never go through CLI `content=`, and a rejected oversized note
   is never chunked into repeated CLI writes. Read current content before editing
   and preserve anything unrelated; if the file changed since I read it, reconcile
   rather than overwrite.
6. Validate: `type: authored`, `sources: []` declared explicitly, honest
   `ai-generated`, `project: atlas`, `kind: guide`, canonical placement, and
   cross-project links in the piped full-path form. Set `updated`; **preserve
   `reviewed`** unless I actually verified factual claims against the code.
7. Refresh catalogs: `index-gen.mjs`, plus `moc-authored-gen.mjs --apply` if Atlas
   now has two or more authored pages. Inspect the generated diff for unrelated
   projects.
8. Log once (`log-entry.mjs --op relink`), then
   `op-commit.mjs --op relink --title '<...>' --since $wikiOpToken`, and verify
   that the reported changed paths actually include the guide.
9. Sync only if already authorized; otherwise report the unpushed commit and ask
   only because publishing is the open question.

Sample user response after a successful path:

"Checked before touching anything — the timed-out call **had** partially run.

What I found at the known target `C:/vault/wiki/authored/atlas/guides/user.md`:
frontmatter written, body empty. `git status` showed it as a new untracked file,
and no duplicate page anywhere under `wiki/authored/atlas/`. So the create
reached Obsidian and the response was lost, not the write.

I finished that same file in place rather than re-running the create — a retry
would have produced a second page, and `file=` name resolution makes a stray
duplicate under a different name entirely possible.

- Completed `wiki/authored/atlas/guides/user.md` via direct filesystem edits (not
  CLI `content=`). Frontmatter validated: `type: authored`, `sources: []`,
  `project: atlas`, `kind: guide`.
- `updated` set to today; `reviewed` left as-is — I wrote the guide, I didn't
  re-verify its claims against Atlas's behavior.
- `index-gen.mjs` regenerated the catalog; `moc-authored-gen.mjs --apply` refreshed
  the Atlas hub. Diff inspected, no unrelated projects touched.
- Logged once and committed as `op-commit --op relink`; the commit's changed paths
  include the guide, the MOC and index.md.
- The commit is local. Say the word and I'll push it."

Stop condition: done when exactly **one** Atlas guide page exists at the known
path, complete and validated, catalogs refreshed and inspected, one relink log
entry written, and the operation commit verified to actually contain the guide. I
stop and ask instead if inspection finds **two** candidate pages — a duplicate the
timed-out call already created — because deleting the wrong one destroys user
work; I report both paths and let the user choose. I also stop rather than
overwrite if the target changed between my read and my write (reconcile first),
and I do not push unless sync is already authorized.

---

## Scenario: app-only

Owner skill: **obsidian-cli**. Both requested actions — opening a workspace in the
UI and rendering the live graph view — are app-only, and the app channel is
unavailable.

Ordered intended actions:

1. Classify the request against the access contract's channel table. "Opening a
   note in the UI, executing an Obsidian/plugin command, app state, live Bases
   queries" **requires a working Obsidian CLI**. There is no supported filesystem
   fallback for these two actions — unlike reads, reports and Markdown edits,
   which never need the app at all.
2. Make exactly one guarded attempt, through the correct channel for Windows —
   the **PowerShell tool**, invoking
   `node 'C:/plugins/wiki-master/scripts/obsidian.mjs' <command>`. Never a bare
   `obsidian` from the Bash tool: Git Bash does not apply `PATHEXT`, so it selects
   the GUI `Obsidian.exe` rather than the `Obsidian.com` terminal redirector and
   returns misleading empty output (a `PreToolUse` hook enforces this). The guard
   waits up to 10 seconds for the shared lock and the command has its own 10-second
   timeout.
3. Read the actual diagnostic and report it verbatim. A dead app is not a silent
   empty — on Windows it exits 1 with "The CLI is unable to find Obsidian. Please
   make sure Obsidian is running and try again." Since the failure is a hard error
   rather than an empty result, no `search query="the" total` canary is needed —
   that probe exists only to distinguish a real empty from a dead backend, and
   nothing here returned an empty.
4. **Choose the supported fallback once; never loop waiting for the app.** For
   these two actions the supported fallback is: report the specific unavailable
   action and continue any independent file work.
5. **Do not pretend a filesystem approximation executed an app action.** I will not
   run `health.mjs` or `graph.mjs` and present the result as "the live graph" —
   the CLI's own `orphans`/`deadends` verdicts aren't the health metrics either,
   and neither is Obsidian's graph view. If the user wants structure rather than
   the app's visualization, I offer `node '.../health.mjs'` explicitly as a
   *different* thing: a filesystem-built link graph report, read-only, clearly
   labeled as not the Obsidian graph.
6. No operation, no log, no commit, no index refresh — nothing here is a write,
   and reads never open operations.
7. Give the concrete remedy rather than a shrug: the user starts Obsidian
   themselves (the docs claim the first command launches it; measured, it does
   not), and `WIKI_MASTER_VAULT_NAME` must match the vault's Obsidian name since
   the CLI targets the vault by name while `WIKI_MASTER_VAULT` supplies the
   filesystem path.

Sample user response after a successful path:

"I can't do either of those — both are app actions, and the Obsidian CLI isn't
available in this session.

- Opening the Atlas workspace in the Obsidian UI: **not performed.**
- Rendering its live graph view: **not performed.**

The call through the guarded wrapper failed with: `The CLI is unable to find
Obsidian. Please make sure Obsidian is running and try again.` I made one attempt
and stopped rather than polling for the app.

To fix it: start Obsidian yourself — despite what the docs say, the first CLI
command does not launch it — and make sure `WIKI_MASTER_VAULT_NAME` matches the
vault's name in Obsidian (the CLI targets vaults by name, not by path). Then this
will work.

What I am **not** going to do is substitute a file-based link report and call it
your graph — they're different artifacts and conflating them would hide the fact
that the app action never ran. That said, if what you're after is the structure
rather than Obsidian's visualization, `health.mjs` builds a link graph straight
from the filesystem and works with the app down — say the word and I'll run it,
clearly labeled as a report rather than the live graph view.

Ordinary file work in `C:/vault` is unaffected — reading, searching, authoring and
reports all work without the app."

Stop condition: **the stop is the point of this scenario.** I stop at the
unavailable app action. Done only when both requested actions are reported as not
performed, the actual CLI diagnostic is quoted, the remedy is named, and the
offered alternative is explicitly distinguished from what was asked for. I would
be wrong to loop retrying the CLI, to present `health.mjs`/`graph.mjs` output as
the live graph, or to claim the workspace opened.

---

## References loaded per scenario

| Scenario | Owner skill | References loaded | Conditional reference deliberately SKIPPED, and the condition judged not to fire |
|---|---|---|---|
| offline-author | wiki-author | core `SKILL.md`, `access.md`, `authoring.md`, `evidence.md`, `operations.md` | None — wiki-author's preamble lists all four unconditionally. |
| lookup | wiki-search | core `SKILL.md`, `access.md` | **`evidence.md` skipped.** Its condition is "before quoting a passage rather than citing where it sits." This run returns `path:line` locations and the alias/provenance route — it cites where passages sit and rests no claim on a quoted fragment. Pure retrieval, no synthesis, no write, so the condition did not fire. (The file is in session context because scenario 1 loads it unconditionally; it was not consulted for this scenario's decisions.) |
| freshness | wiki-stale | core `SKILL.md`, `access.md`, `efficacy.md`, `evidence.md` | None — wiki-stale's preamble lists all three unconditionally. |
| naming-near-miss | not a wiki operation; bounded **wiki-search** lookup only | core `SKILL.md`, `access.md` | **`evidence.md` skipped** — same condition as `lookup`; no passage is quoted and no wiki claim is published. **`authoring.md` and `operations.md` skipped** — no vault write is requested, so no page placement and no operation contract is reached. |
| authorized-discovery | wiki-discover → wiki-ingest | core `SKILL.md`, `access.md`, `evidence.md`, `efficacy.md`, `operations.md` | **`maintenance.md` skipped.** wiki-ingest loads it only "when you compute the backlog with the content-hash join, or hit a structural repair." This run ingests a **named** clipping set handed over from discovery, so `health.mjs --backlog` is never run and no structural repair is hit. wiki-ingest's other conditional, `efficacy.md`, **did** fire — the ingest creates or extends a concept and adds an alias and relationships — and it was already loaded unconditionally by wiki-discover. |
| discovery-only | wiki-discover | core `SKILL.md`, `access.md`, `evidence.md`, `efficacy.md`, `operations.md` | **`maintenance.md` skipped** — nothing computes the backlog join or repairs structure. wiki-ingest's preamble is never reached at all, because ingestion is unauthorized and the run stops at the decision pause. |
| uncertain-write | wiki-author | core `SKILL.md`, `access.md`, `authoring.md`, `evidence.md`, `operations.md` | None — wiki-author's preamble lists all four unconditionally. |
| app-only | obsidian-cli | core `SKILL.md`, `access.md` | None to skip — obsidian-cli's preamble lists `access.md` only. Nothing else was loaded for it; no write workflow is selected because no mutation is reached. |

Union across all eight scenarios: `access.md`, `authoring.md`, `evidence.md`,
`efficacy.md`, `operations.md`.

Never read in this run: `references/maintenance.md` (its only conditional trigger
did not fire in any scenario) and `references/workflows.md` (the core lists it as
"domain workflow details when needed"; no skill preamble linked it directly and no
scenario needed detail beyond its owner skill's own steps). `efficacy.md` points at
`docs/wiki-efficacy.md` for command contracts — not read, both because this run
never needed those contracts and because `docs/` is out of scope for this exercise.

## Files loaded and inherited exposure

Files read, in order:

1. `C:/Users/ehart/repos/wiki-master/eval/skill-behavior/2026-09-11-post/skill-catalog.snapshot.md`
2. `C:/Users/ehart/repos/wiki-master/eval/skill-behavior/prompts.json`
3. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/SKILL.md`
4. `C:/Users/ehart/repos/wiki-master/skills/wiki-author/SKILL.md`
5. `C:/Users/ehart/repos/wiki-master/skills/wiki-search/SKILL.md`
6. `C:/Users/ehart/repos/wiki-master/skills/wiki-stale/SKILL.md`
7. `C:/Users/ehart/repos/wiki-master/skills/wiki-discover/SKILL.md`
8. `C:/Users/ehart/repos/wiki-master/skills/wiki-ingest/SKILL.md`
9. `C:/Users/ehart/repos/wiki-master/skills/obsidian-cli/SKILL.md`
10. `C:/Users/ehart/repos/wiki-master/skills/wiki-query/SKILL.md` (its read-only
    search-and-evidence workflow is what wiki-stale step 4 delegates to for the
    `freshness` scenario, and it is the named handoff target in `lookup`)
11. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/access.md`
12. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/operations.md`
13. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/authoring.md`
14. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/evidence.md`
15. `C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/references/efficacy.md`

Directory listings taken (names only, no file contents): `skills/`,
`skills/wiki-maintainer/references/`, `scripts/`, `scripts/lib/`. These supplied
the exact script filenames cited above (`op-begin.mjs`, `op-commit.mjs`,
`log-entry.mjs`, `index-gen.mjs`, `moc-authored-gen.mjs`, `backlog-gen.mjs`,
`search.mjs`, `resolve-evidence.mjs`, `stale.mjs`, `drift.mjs`, `health.mjs`,
`clip*.mjs`, `identity-audit.mjs`, `relationships.mjs`, `obsidian.mjs`).

Inherited exposure (present in the session before this task began, not read by me):

- The harness's installed-skill listing in the system prompt, which includes
  one-line descriptions for every `wiki-master:*` skill. This overlaps the
  catalog snapshot I was told to read and adds nothing beyond it.
- The user's global `CLAUDE.md` (option-presentation format, git discipline,
  "the wiki is the source of truth") and the two index lines of the project
  `MEMORY.md`. The git-discipline line is directly relevant to `offline-author`,
  where the vault's own `AGENTS.md` overrides it for that vault.
- A git status snapshot: branch `main`, clean tree, and five recent commit
  subject lines.

**Explicitly: I did not see any `scenarios.json`, any grading rubric, any test
file, or any prior evaluation artifact.** Nothing was read under
`eval/skill-behavior/2026-09-11-pre/`, `eval/skill-behavior/current/`,
`eval/skill-behavior/baseline/`, `eval/skill-behavior/rubric-exposed/`,
`eval/skill-behavior/freshness-recheck/`, `eval/skill-coverage/`,
`eval/cli-safeguards/`, or `docs/`. The only files read under `eval/` are the two
named in the instructions, both inside `2026-09-11-post/` and
`eval/skill-behavior/prompts.json`. I did not list or glob the `eval/` tree.
