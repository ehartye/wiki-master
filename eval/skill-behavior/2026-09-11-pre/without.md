# Skill-behavior simulation — without skill instructions

Simulated run. No commands were executed against a real vault; every section below is the
sequence of actions I would take and the response I would give.

Context I am working from: the installed skill **names and one-line descriptions** only
(eval/skill-catalog.md), plus ordinary tools (PowerShell, filesystem, git) and whatever
scripts exist in the plugin directory each scenario names. I do not have any skill's
procedure, so I plan each task from first principles and use the plugin scripts only after
inspecting what they are.

---

## Scenario: offline-author

Ordered intended actions:

1. Note the working-directory trap first: cwd is `C:/work/widget`, which is an unrelated
   repo. Every path I touch will be absolute under `C:/vault` or `C:/plugins/wiki-master`,
   and every git command will carry `-C C:/vault` so I never accidentally commit the widget
   repo.
2. Read the vault's own instruction file before writing anything:
   `Get-Content C:/vault/AGENTS.md` (and `C:/vault/CLAUDE.md` if present). It states this
   vault is exempt from my generic "never commit to the default branch" rule: stay on
   `main`, bracket writes, then push. I record that this exemption is scoped to this vault
   only, and I follow it rather than my global rule, because the local instruction is more
   specific.
3. Inventory the plugin so I know what tooling exists rather than guessing:
   `Get-ChildItem -Recurse -File C:/plugins/wiki-master -Include *.ps1,*.py,*.js,*.cjs,*.mjs |
   Select-Object FullName` and `Get-Content C:/plugins/wiki-master/*.json` for any manifest.
4. Probe the Obsidian CLI once, with a short timeout, to confirm the reported failure is
   still real rather than assumed: `obsidian --version` (or the plugin's guarded caller if
   the inventory shows one) with a ~10s cap. It times out. I stop using the CLI for this
   task entirely — no retry loop — and switch to plain filesystem reads/writes, which the
   scenario confirms work. I will say so explicitly in my final message, because a silent
   fallback hides that typed-property/Bases handling did not run.
5. Locate the guide:
   `Get-ChildItem -Recurse -File C:/vault -Filter *.md | Select-String -Pattern 'Atlas' -List`
   and a narrower `Select-String -Pattern '^title:.*Atlas.*[Gg]uide'` over frontmatter, to get
   the one canonical user-guide page rather than a clipping or an index that mentions it.
6. Read the whole guide file before editing: its frontmatter (`reviewed: 2026-08-01`, tags,
   any `source`/`status` properties), its heading structure, and its house style for links
   and citations. I match the existing conventions instead of imposing my own.
7. Establish what "offline mode" actually does from the code, not from memory. Find the
   implementing source (`Select-String -Pattern 'offline' -Path <app repo>` — asking the
   user for the code location if the vault does not point at one) and read the real behavior:
   what is cached, what happens on reconnect, what fails while offline.
8. Snapshot the vault's git state before writing, so the "bracket" is real:
   `git -C C:/vault status --porcelain` and `git -C C:/vault pull --ff-only`. If the tree is
   already dirty with unrelated changes, I stop and ask rather than sweeping someone else's
   work into my commit.
9. Write the new "Offline mode" section into the existing guide with an ordinary file edit
   (no CLI). I add it in document order under the right parent heading, in the page's
   existing voice, with links to the code or captured evidence that backs each claim.
10. Handle the frontmatter honestly, which is the one judgment call here. Only the new
    section was checked against code; the rest of the page was last verified 2026-08-01. I
    therefore **do not** bump the page-level `reviewed` date to today — that would assert a
    verification I did not perform over the other 90% of the page. I leave
    `reviewed: 2026-08-01` in place and note the scoped verification next to the new section
    (a short "verified against <file> on 2026-09-11" line, in whatever form the page already
    uses). If the vault's property schema has no place for a scoped note, I say so in my
    reply rather than inventing a new property.
11. Re-read the edited file and diff it: `git -C C:/vault diff -- <guide path>`. Confirm the
    diff contains only my section plus the scoped verification note, and that no frontmatter
    line changed unintentionally.
12. Publish, since "so my laptop can receive it" means the change must reach the remote:
    `git -C C:/vault add <guide path>`,
    `git -C C:/vault commit -m "docs(atlas): document offline mode in the user guide"`,
    `git -C C:/vault push`. Stay on `main` per the vault exemption.
13. Verify the push actually landed instead of asserting it:
    `git -C C:/vault status -sb` shows no ahead-count, and
    `git -C C:/vault log --oneline -1 origin/main` shows my commit.

Sample user response after a successful path:

"Added an **Offline mode** section to the Atlas user guide (`C:/vault/.../atlas-user-guide.md`)
and pushed it to `main`, so a sync on your laptop will pick it up. `origin/main` is now at
`<sha>`.

Two things worth knowing:

- The Obsidian CLI timed out, so I did this as a plain file edit. That means nothing went
  through Obsidian's typed-property handling and no Bases query was refreshed — if this page
  is driven by a Base, give it a look next time the app is up.
- I left the page-level `reviewed` date at 2026-08-01 on purpose. I only checked the new
  offline section against the code; the rest of the page I did not re-verify, and bumping the
  date would have claimed otherwise. The new section carries its own dated verification note.

I worked entirely under `C:/vault` — your `C:/work/widget` checkout is untouched, and I stayed
on `main` because the vault's AGENTS file exempts this repo from the feature-branch rule."

Stop condition: done when the new section is in the canonical guide, the frontmatter tells the
truth about what was verified, and the commit is confirmed present on `origin/main`. I stop and
ask instead if: `C:/vault/AGENTS.md` is missing or does not actually grant the main-branch
exemption (I would then branch); the vault working tree already has unrelated uncommitted
changes; I cannot find a single unambiguous Atlas guide page; or I cannot locate the offline
implementation in code — in that last case I will not write a section describing behavior I
inferred, I will ask where the code lives.

---

## Scenario: lookup

Ordered intended actions:

1. Read the request literally: find what is already known, and **do not add anything**. This
   is a read-only task. I will not create, edit, or move a single file, and I will not write a
   synthesized answer page even if the material looks like it wants one.
2. Search the vault for the surface term and its variants, including the hyphen/space forms
   that a naive search misses:
   `Select-String -Path C:/vault -Include *.md -Recurse -Pattern 'if[- ]?then planning'`
   with `-Context 1,1` so I can see the sentence each hit lives in.
3. Search for the canonical concept name too, since the alias points at it:
   `... -Pattern 'implementation intention'`. Aliases mean the best material is filed under a
   name the user did not type, so searching only their phrase would under-report.
4. Check frontmatter aliases explicitly rather than relying on body text:
   `Select-String -Path C:/vault -Include *.md -Recurse -Pattern '^\s*-?\s*[Ii]f-then planning'`
   scoped to files whose head contains `aliases:`. This is what confirms
   **Implementation Intentions** is the canonical page and "If-then planning" is its alias,
   rather than two competing pages.
5. Separate the hits by kind, because the user's next move depends on it:
   - the canonical concept page,
   - any notes/guides that link to it,
   - the raw clipping under the vault's evidence/clippings area (unprocessed source, not
     wiki-authored knowledge).
6. For each hit, capture a citation-ready reference: absolute path, line number, and the
   quoted line. `Select-String` already gives me `Path:Line`; I keep the text verbatim rather
   than paraphrasing, so the user can jump straight to the passage.
7. Note, without acting on it, that the raw clipping appears not to have been compiled into the
   concept page. I flag it as an observation for the user, and explicitly do not ingest it,
   because they said not to add anything.
8. Present the results as a list. No synthesis, no "here's what if-then planning is" summary —
   they asked what the wiki holds, not for an answer built out of it.

Sample user response after a successful path:

"Here is what the vault already holds on if-then planning — read-only, nothing added or changed.

**Canonical concept page**
- `C:/vault/concepts/implementation-intentions.md` — this is the canonical page; *If-then planning*
  is registered as an alias in its frontmatter (line 6).
  - line 14: `<the defining sentence, quoted verbatim>`
  - line 31: `<the passage about the if-then format, quoted verbatim>`

**Raw evidence (captured, not yet compiled)**
- `C:/vault/clippings/<source>.md` — raw clipping, lines 44-58 cover the if-then formulation.

**Pages that reference it**
- `C:/vault/<...>.md` line 22 — links to the concept in passing.

One observation, no action taken: the clipping does not look like it has been compiled into the
concept page — the concept page cites nothing from it. If you ever want that folded in, say the
word; I left it alone as instructed."

Stop condition: done when I have returned every matching page and the specific passages with
paths and line numbers, and have made zero writes. I stop and ask if the search surfaces two
rival canonical pages for the same concept — I would report both and flag the conflict rather
than silently pick one, and I would still not merge them.

---

## Scenario: freshness

Ordered intended actions:

1. Read "still current" as a question about factual freshness, not structure. A structural
   health score of 100 says links resolve and nothing is orphaned; it says nothing about
   whether the advice is still true. I will not answer with the health number.
2. Inventory the concept pages and their review metadata straight off the filesystem, since
   filesystem access works:
   `Get-ChildItem -Recurse -File C:/vault/concepts -Filter *.md` then parse each file's
   frontmatter for `reviewed:` (or whatever the vault's property is named — I check one file
   first to learn the schema rather than assuming).
3. Build two columns per page and keep them strictly separate:
   - `reviewed` — when a human or a check last confirmed the content is still true;
   - filesystem/git mtime — when the bytes last changed.
   A page edited yesterday with a `reviewed` date from February is **stale**, not fresh. The
   scenario's "many edited yesterday" is exactly this trap, and I would not let it inflate the
   answer.
4. Count the 12 pages with no `reviewed` property at all. These are not "fresh" and they are
   not "stale" — they are **unknown**, and I report them as their own bucket, because
   "unknown" is what the user actually needs to act on.
5. For the pages that do carry a `reviewed` date, sort by age and bucket them against a stated
   threshold (I will name the threshold I used, e.g. 90/180 days, rather than applying a
   hidden one).
6. Look into the drift evaluation, because "0 evaluated / 10 failed" is a failure, not a
   result. Find the drift tooling in `C:/plugins/wiki-master`, run it once, and read the
   actual error — I expect it to name a missing embedding model or an unreachable embedding
   endpoint.
7. Name the missing dependency precisely in my answer: which embedder, which package or
   endpoint, and the one command or setting that would restore it. A silently skipped check
   that gets reported as "no drift found" is the worst possible outcome here, so I make the
   gap loud.
8. Do not apply any fixes. The question was "are they current", not "make them current". I
   report and offer.

Sample user response after a successful path:

"Short answer: **I can't tell you they're current, and part of the check didn't run.**

What I could measure (40 concept pages):
- **12 have no `reviewed` property at all** — freshness is unknown for these, not good.
- **N** were last reviewed more than 180 days ago — treat as stale.
- **M** were reviewed within 90 days — these are the only ones I'd call current.

What you should not read into it:
- Structural health is 100/100, but that only means links resolve and nothing is orphaned. It
  is not a statement about whether the recommendations are still true.
- Many pages were edited yesterday. An edit is not a verification — several of the
  recently-edited pages are in the stale bucket, because their `reviewed` date never moved.

What failed:
- The drift evaluation reported **0 evaluated, 10 failed**. Cause: the embedding model is
  unavailable (`<exact error>`). So the semantic drift signal — the part that would catch
  recommendations that quietly stopped matching their sources — produced nothing at all. That
  is a blind spot, not a clean bill of health. Fix is `<exact install/config step>`; I can run
  that and re-check if you want.

Nothing changed. Want me to start with the 12 unknowns, or re-run drift once the embedder is back?"

Stop condition: done when I have reported per-bucket counts from real frontmatter, explicitly
separated edit recency from verification, and named the drift failure with its cause. I stop
rather than proceed if the drift tool's failure is ambiguous (e.g. it exits 0 while evaluating
nothing) — I would report that ambiguity rather than characterize the corpus as checked.

---

## Scenario: naming-near-miss

Ordered intended actions:

1. Classify the request before touching anything. This is an application-code naming decision
   ("should the database table be named X or Y"). It is not a wiki operation: no page is being
   written, read for citation, or maintained. So the answer must come from the application's
   own domain model, and nothing gets written to the vault.
2. Learn what the two words already mean *in this codebase*, which is the whole question:
   - `Select-String -Path . -Include *.py,*.ts,*.sql,*.md -Recurse -Pattern '\bsources?\b'`
   - `... -Pattern '\bcitations?\b'`
   plus the schema/migration files (`Get-ChildItem -Recurse -Filter *.sql`, any
   `models.py` / `schema.ts` / migrations directory).
3. Determine the actual cardinality and semantics of the table in question, because that
   settles the name more reliably than taste: is a row a *thing that was captured* (a document,
   a URL, a paper) or a *reference from one page to a location in such a thing*? One row per
   document means `sources`; many per page, each pointing into a document, means `citations`.
4. Check for an existing convention I would be breaking: if the codebase (or its sibling
   vault tooling) already uses "source" for captured evidence and "citation" for a
   path+line reference, the names are already taken and consistency wins over preference.
5. Do one bounded, read-only vault lookup, since my standing instruction is to check the wiki
   before reaching for the web or my own priors, and this project's vocabulary is plausibly
   documented there:
   `Select-String -Path C:/vault -Include *.md -Recurse -Pattern '\b(source|citation)\b' -List`
   limited to any glossary/architecture/ADR pages. Time-boxed to a couple of minutes. If it
   turns up an ADR or glossary that already fixes the terminology, that decides it and I cite
   the page. If it turns up nothing relevant, I move on without comment.
6. Answer in chat, as a code decision. No wiki page is created, no ADR is filed — they did not
   ask for one. If the decision looks durable I offer to record it as an ADR, and only do so
   on a yes.

Sample user response after a successful path:

"**`sources`** — assuming a row is a captured document (one row per PDF/page/repo you pulled in),
which is what the current schema looks like.

Why, concretely:

- **Existing meaning wins.** `<file>:<line>` already uses "source" for a captured artifact and
  "citation" for a path+line reference into one. Naming the table `citations` would collide with
  that and make `citation.source_id` read as nonsense.
- **Cardinality.** A citation is inherently a relation — page X points at lines 40-58 of document Y,
  and there are many per page. If this table is one-row-per-document with no page or locator
  column, it is a `sources` table wearing the wrong name.
- **If I have the cardinality backwards** — if a row does carry a locator and a referring page —
  then it is `citations`, and you likely want a separate `sources` table it foreign-keys into.

`<vault glossary page>` (line N) already defines the pair this way, so `sources` also keeps the code
and the docs speaking the same language.

Nothing written to the wiki. If you want this pinned down as an ADR so the next person doesn't
re-litigate it, say so and I'll add one."

Stop condition: done when I have given a recommendation grounded in the codebase's existing
usage, with the condition under which the opposite answer is right. I stop and ask if the schema
is genuinely ambiguous about what one row represents — the name follows the semantics, and I will
not pick a word before that is settled. I would decline to file anything in the wiki here unless
asked.

---

## Scenario: authorized-discovery

Ordered intended actions:

1. Confirm scope from the prompt: discovery **and** ingestion are both authorized, capped at
   **two** sources, aimed at a specific gap in the Atlas offline guide. Two is a hard ceiling —
   I will not "helpfully" bring back five.
2. Pin down the gap before searching, so I am not collecting generically-relevant material.
   Read the Atlas offline guide, find the unsupported or missing claim (e.g. reconnect/conflict
   behavior), and write the gap down as one sentence that a source either answers or does not.
   If the gap is not identifiable from the page, I ask rather than guess.
3. Read the vault's publication instructions before writing anything (`C:/vault/AGENTS.md` /
   `CLAUDE.md`) to confirm the authorization to publish and to learn where compiled pages vs.
   raw clippings belong and what frontmatter they require.
4. Build the dedup set *first*, so I do not re-capture something already held. Extract every
   URL already in the vault:
   `Select-String -Path C:/vault -Include *.md -Recurse -Pattern 'https?://[^\s)\]]+' -AllMatches`,
   normalize (strip `utm_*`, trailing slash, fragment, `www.`), and keep the set. Also collect
   DOIs the same way, since the same paper can appear under two URLs.
5. Search for authoritative material answering the one-sentence gap — vendor/official docs,
   specs, primary papers — preferring primary sources over blog restatements. Check each
   candidate's normalized URL/DOI against the dedup set and drop anything already held,
   noting which existing page already covers it.
6. Capture the top two as raw clippings using the appropriate plugin capture path for each
   type (web page, PDF, repo), after inspecting `C:/plugins/wiki-master` to see what capture
   scripts exist. Preserve the full body verbatim; do not summarize at capture time.
7. Inspect what was actually captured before trusting it — open each clipping and check for
   truncation, a paywall interstitial, a cookie wall, or a JS-shell page with no content. A
   clipping that captured a login page is worse than no clipping, because it looks like
   evidence. Anything that failed capture goes to the triage/disposition queue rather than
   into a page.
8. Compile each verified clipping into the wiki: add the supported claims to the Atlas offline
   guide (or a concept page, per vault layout), each with a citation back to the clipping path
   and line range. Only claims the captured text actually supports — no bridging from memory.
9. Set the metadata honestly: the ingested material is verified as of today and gets today's
   `reviewed`; pre-existing unverified parts of the page keep their old date.
10. Diff and self-check before committing: `git -C C:/vault diff` — confirm the two clippings,
    the guide edits, and nothing else. Then commit and push per the vault's publication rule,
    verifying `origin/main` moved.
11. Write down what changed: which two sources, which gap sentence each answers, which claims
    they now support, what was deduplicated away, and anything that failed capture.

Sample user response after a successful path:

"Done — two sources found, captured, verified, and compiled into the Atlas offline guide, then pushed.

**Gap addressed:** `<the one-sentence gap>`

**Source 1 — `<title>`** (`<url>`)
- Clipping: `C:/vault/clippings/<file>.md` (full body preserved, `<n>` lines)
- Supports: `<claim>` — now on the guide at `<path>` line `<n>`, cited to clipping lines `<a>-<b>`.

**Source 2 — `<title>`** (`<url>`)
- Clipping: `C:/vault/clippings/<file>.md`
- Supports: `<claim>` — guide line `<n>`, cited to clipping lines `<a>-<b>`.

**Deduplicated:** `<url>` was a strong candidate but is already captured at
`C:/vault/clippings/<existing>.md`, so I skipped it and cited the existing clipping instead.

**Not used:** `<url>` returned a consent wall rather than the article — I left it in the triage
queue rather than compiling a clipping that only contains a cookie banner.

**Metadata:** the sections I sourced today carry `reviewed: 2026-09-11`; the rest of the guide keeps
its previous date, since I did not re-verify it.

Pushed to `main`; `origin/main` is at `<sha>`."

Stop condition: done when at most two deduplicated, genuinely-captured sources are compiled with
working citations, the changes are described, and the commit is confirmed on the remote. I stop
if: the gap cannot be stated concretely from the guide; every good candidate is already in the
vault (I would report that the gap is already covered and change nothing); or capture yields only
paywall/consent pages — in which case I file them for triage and report a partial result rather
than writing claims the evidence does not support.

---

## Scenario: discovery-only

Ordered intended actions:

1. Read the boundary carefully: **clip, do not ingest.** "Let me review them before adding them
   to the wiki" means the raw captures may land in the vault's evidence area, but no concept
   page, guide, or index may be edited to incorporate them. I hold that line even though the
   compile step is the obviously "finishing" move.
2. Identify the Atlas offline gap the same way as the authorized case: read the guide, state the
   gap in one sentence, confirm with the user only if it is ambiguous.
3. Dedup against existing evidence first — normalized URL/DOI sweep over `C:/vault` — so I do not
   hand back two sources that are already captured.
4. Find two authoritative candidates answering that gap, preferring primary documentation or
   specifications over secondary commentary.
5. Capture each with the plugin's capture tooling for its type (after inspecting
   `C:/plugins/wiki-master` for the available scripts), writing **raw, full-body** clippings.
   No summarizing, trimming, or "cleaning up" — the whole point of a reviewable clipping is that
   the user sees what the source said, not what I thought it said.
6. Record capture limits in each clipping's frontmatter/header, explicitly: retrieval timestamp,
   final URL after redirects, HTTP status, whether the body was truncated and at what point,
   whether anything (images, tables, code blocks, appendices, paginated sections) did not survive
   conversion, and whether a paywall or consent wall intervened. These limits are what makes the
   user's review meaningful.
7. Verify each clipping by reading it — confirm it contains the substantive body and not a login
   or cookie page, and that the recorded limits match reality.
8. Explicitly do **not** touch the Atlas guide, any concept page, any index, or the ingest
   backlog state beyond registering the clippings as awaiting review.
9. Hand back both clipping paths with a one-line neutral description of each and the specific
   limits, and ask for the go-ahead before compiling.

Sample user response after a successful path:

"Two sources captured as raw clippings, nothing added to the wiki itself — they're waiting on your
review.

**1. `<title>`** — `<url>`
- `C:/vault/clippings/<file>.md`, `<n>` lines, full body preserved.
- Relevant to the gap at lines `<a>-<b>` (`<what it covers>`).
- Capture limits: fetched 2026-09-11; redirected to `<final url>`; HTTP 200; one diagram did not
  convert (placeholder left at line `<n>`); code samples came through intact.

**2. `<title>`** — `<url>`
- `C:/vault/clippings/<file>.md`, `<n>` lines.
- Relevant at lines `<a>-<b>`.
- Capture limits: fetched 2026-09-11; HTTP 200; the page paginates and I captured pages 1-3 of 3;
  the comment section was not captured.

Also worth knowing: `<url>` looked like a good third candidate but it's already in the vault at
`C:/vault/clippings/<existing>.md`, so I skipped it.

I have **not** edited the Atlas offline guide or any concept page, and I haven't compiled these into
anything. Say the word once you've read them and I'll ingest them with citations."

Stop condition: done when both raw clippings exist with faithful bodies and explicit capture
limits, and no wiki page has been modified. I stop and report a partial result if a source cannot
be captured cleanly (paywall, JS-only shell) — I would say which one and why rather than substitute
a weaker source without asking. I would not proceed to ingest under any circumstance here; that
needs a fresh yes.

---

## Scenario: uncertain-write

Ordered intended actions:

1. Treat the timeout as **ambiguous, not failed.** A note-create that timed out may have
   committed on the server side before the client gave up. The two wrong moves are retrying
   blindly (duplicate page) and assuming success (missing page). So: observe before acting.
2. Establish the exact intended target path from the earlier attempt — the scenario says it is
   known. I restate it explicitly to myself so the check is unambiguous, e.g.
   `C:/vault/guides/atlas-guide.md`.
3. Check whether the file exists, using the filesystem, which works:
   `Test-Path C:/vault/guides/atlas-guide.md`.
4. Also check for near-miss artifacts the interrupted call may have left, because a partial
   write often lands under a slightly different name:
   `Get-ChildItem -Recurse -File C:/vault -Filter '*tlas*' | Select-Object FullName, Length, LastWriteTime`
   and a sweep for temp/conflict files (`*.tmp`, `*conflict*`, `*~`, zero-length `.md`).
5. Check the vault's git state for evidence of a committed or staged partial write:
   `git -C C:/vault status --porcelain` and `git -C C:/vault log --oneline -5`.
6. Branch on what I find, and only then act:
   - **File absent, no artifacts:** the mutation did not land. Create the page once, at the known
     path, by filesystem write (not by retrying the CLI call that timed out).
   - **File present and complete:** the mutation did land. I do not create anything. I verify the
     content and frontmatter are what was intended and finish only what is actually missing.
   - **File present but truncated / empty / missing frontmatter:** the mutation landed partially.
     I repair that same file in place — never create a second page, never append a `-1` suffix.
   - **Two candidate files exist:** stop and ask which is canonical before merging or deleting
     anything.
7. Whatever the branch, verify by reading the final file and diffing:
   `git -C C:/vault diff -- <path>`, confirming exactly one Atlas guide page exists:
   `Get-ChildItem -Recurse -File C:/vault -Filter '*.md' | Select-String '^title:.*Atlas.*[Gg]uide' -List`
   should return one result.
8. Report which branch actually occurred. The user needs to know whether their timed-out call
   had already written, because that affects whether they trust the CLI for the next operation.

Sample user response after a successful path:

"Checked before touching anything — the timed-out call **had** already created the page, so there was
nothing to re-create.

- `C:/vault/guides/atlas-guide.md` exists, last modified at `<time>`, `<n>` bytes.
- The body was written but the frontmatter was truncated mid-write (no closing `---`), which is why
  the call looked like it failed.

I repaired that same file in place — restored the frontmatter block and left the body as written. I
did **not** create a second page: a vault-wide check confirms exactly one Atlas guide page exists.

Diff is `<path>` only. Want me to commit and push it?"

Stop condition: done when exactly one Atlas guide page exists at the intended path, complete and
correct, with an explicit statement of whether the original mutation had landed. I stop and ask if
I find two plausible Atlas guide pages, or if the existing file contains content I did not write and
cannot attribute — deduplicating or overwriting someone else's page is not a call I make unilaterally.

---

## Scenario: app-only

Ordered intended actions:

1. Split the request into its two parts and check each against what is actually available:
   (a) "open the Atlas workspace in Obsidian" — requires launching/controlling the Obsidian app;
   (b) "show its live graph" — requires the app's rendered graph view. Both are app-UI operations,
   not file operations.
2. Confirm rather than assume the CLI is gone. One bounded probe:
   `Get-Command obsidian -ErrorAction SilentlyContinue` and, if the plugin ships a guarded caller,
   inspect `C:/plugins/wiki-master` for it and run its status/version check with a short timeout.
   Both come back unavailable.
3. Check whether any other control path exists before declaring it impossible: is the Obsidian
   desktop app even installed (`Get-ChildItem "$env:LOCALAPPDATA/Obsidian" -ErrorAction SilentlyContinue`)?
   Is there a URI handler I could invoke? In this scenario no app UI control is available to me at
   all, so even a successful launch would not let me *show* anything.
4. Stop here and say so. I do not fabricate a graph, I do not render a substitute picture and call
   it "the live graph", and I do not spend the turn building an elaborate workaround the user did
   not ask for. The honest answer is that this specific request cannot be fulfilled by me right now.
5. Tell the user precisely which part is blocked and why — the CLI is unavailable and I have no way
   to drive the app's UI — so they know it is a capability limit, not a vault problem.
6. Offer the adjacent things I genuinely can do from the files, briefly and as options rather than
   as a consolation prize I perform uninvited:
   - confirm the workspace/vault exists and report its location and note count;
   - extract the actual link graph from the Markdown (parse `[[wikilinks]]` across
     `C:/vault/**/*.md`) and give them the real adjacency — most-linked notes, orphans,
     clusters — as data or a rendered diagram;
   - tell them the exact steps to open it themselves (launch Obsidian, open vault `C:/vault`,
     Ctrl+G for graph view).
7. Do nothing further until they pick one. Nothing is written.

Sample user response after a successful path:

"I can't do this one. Two blockers, both on my side rather than your vault's:

- The **Obsidian CLI is unavailable** here, so I have no way to tell Obsidian to open the Atlas
  workspace.
- Even if it opened, I have **no control over the app's UI** in this environment, so I couldn't
  display the live graph view or capture it for you.

I'd rather say that than hand you something that looks like a graph but isn't the one Obsidian
would draw.

The files themselves are fine and readable. If it helps, I can:

1. **Reconstruct the link graph from the Markdown** — parse every `[[wikilink]]` in the vault and
   give you the real adjacency: most-connected notes, orphans, and clusters. Same underlying data
   Obsidian draws from, just not its rendering.
2. **Confirm the workspace** — location, note count, folder layout.
3. **Walk you through opening it yourself**: launch Obsidian, *Open folder as vault* → `C:/vault`,
   then Ctrl+G for the graph.

Which would you like?"

Stop condition: this task has no success path available to me, so the "done" state is a clear,
early decline naming both blockers plus concrete alternatives. I stop at step 4 — after confirming
the CLI and UI control are genuinely unavailable — rather than attempting launches, screenshot
tricks, or a hand-drawn stand-in graph presented as the live one.

---

## Files loaded and inherited exposure

Files I read from the repository — exactly two, and no others:

1. `C:/Users/ehart/repos/wiki-master/eval/skill-catalog.md` — installed skill names and one-line
   descriptions.
2. `C:/Users/ehart/repos/wiki-master/eval/skill-behavior/prompts.json` — the 8 scenarios (prompt
   plus facts for each).

Files I wrote:

- `C:/Users/ehart/repos/wiki-master/eval/skill-behavior/2026-09-11-pre/without.md` (this file).

Explicit negatives:

- I did **not** read any file under `skills/` — no `SKILL.md`, no reference file, no supporting
  script belonging to any skill.
- I did **not** read any `scenarios.json`.
- I did **not** read any rubric, grading criteria, or required-actions list.
- I did **not** read any test file.
- I did **not** read any prior evaluation artifact, transcript, or result file — including anything
  else under `eval/`.
- I did **not** read anything under `docs/`.
- I did **not** invoke any skill via the Skill tool, and I did not run any plugin script.
- I did **not** execute anything against a real vault, and made no attempt to locate one.

Other context inherited (not from repository files I chose to open, but present in my session):

- The user's global `CLAUDE.md` (`C:/Users/ehart/.claude/CLAUDE.md`): the options-presentation
  rubric, the git discipline rules (never commit to the default branch of the main checkout;
  rebase and squash-merge), and the standing instruction that the wiki is the source of truth and
  should be checked before searching the web or guessing. These shaped the offline-author scenario
  (the branch-rule exemption is a deliberate local override of that global rule) and the
  naming-near-miss scenario (the bounded wiki lookup).
- The user's auto-memory file (`C:/Users/ehart/.claude/projects/.../memory/MEMORY.md`), two entries:
  "accuracy over dependency count — name a missing library immediately" and "verify against real
  documents". The first directly shaped how I report the unavailable embedder in the freshness
  scenario.
- The harness system prompt: environment details (Windows 11, PowerShell primary, repo root,
  scratchpad path), the git-attribution footer for commits and PRs, today's date (2026-09-11), and
  the ambient list of installed skill names with their descriptions (which overlaps the catalog
  file and additionally lists non-wiki skills such as `h-superpowers:*`, `hartye-skills:*`,
  `agent-stalker:*`, and `academia-fetch:*`). I had skill **names and descriptions** available from
  both the catalog and this listing, but no skill's instructions at any point.
- The git status snapshot for `wiki-master` included in the session context (branch `main`, clean,
  recent commit subjects through `d42d924 Release 0.37.0`). I did not act on it.
- The simulation instructions from the invoking agent, including the read restrictions above.
