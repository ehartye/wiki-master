Read directly for this operation: [access](../../wiki-maintainer/references/access.md), [evidence](../../wiki-maintainer/references/evidence.md), [efficacy](../../wiki-maintainer/references/efficacy.md), [operations](../../wiki-maintainer/references/operations.md).
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

# Capture named sources and research selections

A named URL or file request starts here, without broad web discovery or perspective
fan-out. Capture-only work never creates derived source or concept pages. For a
format-specific source, read its route before capture: [PDF](clip-pdf.md),
[Word](clip-docx.md), [PowerPoint](clip-pptx.md), [spreadsheet](clip-xlsx.md),
[GitHub repository](clip-gh.md), or [Confluence](clip-confluence.md).
Only read the matching route, then use its actual result and the shared completion
contract. The HTML mechanics below apply to ordinary web pages and supplied pages.

## Named sources
When the user names the pages to capture (URLs or saved files), there is nothing to
search for: skip broad research and discovery scoring. Dedup still applies to
the exact pages they named:
- Check them: `node "<absolute-plugin-root>/scripts/known-urls.mjs" --check "<url>" "<url>"`
  (read-only; it needs no operation). The lines come back in the order given and carry no
  URL, so match them by position. `new`: clip it. `clipped raw/clippings/<name>.md`: it is
  already in the vault, so say so; if the user wants a second, dated copy of a page that has
  changed, clip it with `--recapture` (see the result table below).
  `declined: <reason>`: leave it, unless the user says the decline no longer holds; then
  `node "<absolute-plugin-root>/scripts/decline.mjs" supersede "<url>" --reason "<why>"`, or
  `--supersede-decline="<why>"` on the clip.
- Clip the new ones using the capture procedure below, with `--topic="<topic>"` (the topic as the user gave it),
  `--quality=<tier>` and `--since <token>` on every clip.
- A page the user rejects is recorded, not forgotten:
  `node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --decline="<one-line reason>"`.
- Use the capture and completion contract below: open a discover operation
  before the first decline or clip, pass its token as `--since`, finish the capture
  with `op-ledger.mjs show` and `op-commit`. Ingest only when the exact source set
  is already authorized; a capture-only request ends after verified capture publication.
- A page the clipper cannot read (a login, a consent wall, an age check, a thin
  extraction) is saved by the user from a signed-in browser and supplied with
  `--from-file` (below).

## Capture the selected sources
Use the operation opened before the first decline or clip. If none is open, run
`node "<absolute-plugin-root>/scripts/op-begin.mjs" --op discover` before clipping
and retain its token; never overwrite a saved token. Do prerequisite and duplicate
checks first. When there is nothing to capture or decline, return without opening
an operation. Read-only named-URL dedup does not require broad coverage research.

For each kept candidate:
`node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --quality=<tier> --topic="<topic>" --since <token>`

**Pass `--topic` on every clip in the run, and use the same string for all of
them** — it is what lets maintainer triage group this run's leftovers together
later. Use the topic as the user gave it ($ARGUMENTS); do not re-word it per
source, or one run becomes several groups. The flag feeds both places a topic
can land: the clipping's frontmatter when the clip succeeds, and the triage log
when it fails, so you never have to know which happened.

**"Every clip" includes the non-HTML ones.** A candidate that is a PDF, a Word
file or a spreadsheet does not go through `clip.mjs` — it goes through
`clip-pdf.mjs`, `clip-docx.mjs` or `clip-xlsx.mjs` (see [PDF capture](clip-pdf.md) and
[Word capture](clip-docx.md)), and **every one of those takes `--topic` too**:

```bash
node "<absolute-plugin-root>/scripts/clip-pdf.mjs"  "<file.pdf>"  --source="<url>" --quality=<tier> --topic="<topic>" --since <token>
node "<absolute-plugin-root>/scripts/clip-docx.mjs" "<file.docx>" --source="<url>" --quality=<tier> --topic="<topic>" --since <token>
node "<absolute-plugin-root>/scripts/clip-xlsx.mjs" "<file.xlsx>" --source="<url>" --quality=<tier> --topic="<topic>" --since <token>
# clip-pptx.mjs takes the same options; clip-pdf also records the figure files it renders (--figures)
```

**A Confluence Cloud URL is HTML but also does not go through `clip.mjs`** — it
requires authentication `clip.mjs`'s anonymous fetch does not have, and reads
as thin content / gets auto-declined. Route it to [Confluence capture](clip-confluence.md) instead
(only applies if the `confluencer` plugin is installed — an optional runtime
dependency this one clipper alone takes on; see that reference for why):

```bash
node "<absolute-plugin-root>/scripts/clip-confluence.mjs" "<confluence-url-or-page-id>" --quality=<tier> --topic="<topic>" --since <token>
```

Binary capture routes need the same topic string as HTML routes. Topic is
recorded going forward only; missing attribution leaves the resulting rows under
Unattributed. For a one-off named source outside a research run, omit the topic
rather than inventing one.

It blocks unreliable domains, skips dupes, extracts via Defuddle, and writes
`raw/clippings/<slug>.md` with `source`, `created`, `tags:[clippings]`, `quality`,
`topic`, `source-hash`. A `thin content` result means the page was a SPA/paywall — clip.mjs
records the decline automatically; report it for manual clipping (the user saves the page and you supply it with `--from-file <path>`, adding `--override-decline` because the decline was automatic), don't retry
blindly. A page that is a login form, a consent wall or an age check is not clipped even when it is long: its own vocabulary dominates the text and none of its title is in it (`lib/interstitial.mjs`). It is queued as `wrong-node` and is NOT declined, because a wall is not a verdict on the source; save it from a signed-in browser and supply it with `--from-file <path>`. A URL that looks like a text file (a checksum manifest, a pinned source file, anything on the raw GitHub host) is kept whole in a fence with `extraction: plaintext`, never judged thin; a binary or a file over 1 MiB served as text is refused and queued as `attention`. A `failed` result (403/transient) is NOT auto-declined — it may recover,
and a 180-day TTL would bury a source you still want.

**What a clip result means.** `clip.mjs` prints one result per URL:

| Result | Meaning | What you do |
|---|---|---|
| `clipped: raw/clippings/<name>.md` | written | cite that path |
| `duplicate (already clipped)` | this URL is already in the vault, also when another session wrote it first | nothing; do not clip it again. To keep a second, dated copy of a page that has changed, run the clip again with `--recapture` |
| `unchanged (same text as raw/clippings/<name>.md); nothing written` | `--recapture` found the page's text identical to a capture already held (exit 0) | nothing; the page has not changed |
| `recapture: not clipped yet, clipping it normally: <url>` | `--recapture` on a URL that was not in the vault; the line is followed by the ordinary result | read the result that follows |
| `clash: <url>: raw/clippings/<name>.md already exists ...` | the URL is new but every name it could have had was taken; **nothing was written** and one `attention` row is queued in triage | open the file named in the line and read its `source:` to see what holds the name, then re-run with `--slug=<name>`, or leave the row for maintainer triage |
| `declined`, `blocked`, `thin content`, `failed` | see below | see below |

A taken file name is a `clash`, never a `duplicate`: a `duplicate` always means the same URL.

**A second capture of a page already clipped.** `clip.mjs "<url>" --recapture --since <token>` fetches the page and runs the usual checks. If the text is new it writes a second clipping beside the first, named as the oldest capture's own name followed by ` (recaptured YYYY-MM-DD)`, with the same suffix on its `title`, `recapture-of` naming the newest existing capture, and `created` today; the older clipping is never edited. A second recapture on the same day with different text is a `clash`. `--slug=<name>` with `--recapture` is used exactly, with no suffix. Without the flag the same URL is a `duplicate`.

**A page a person saved.** `clip.mjs "<url>" --from-file <path> --topic="<topic>" --since <token>` records a page saved from a signed-in browser, with its real URL as `source` and nothing fetched. The file is `.md`, `.markdown` or `.txt` (the page text) or `.html` or `.htm` (read by the same extractor as a fetched page), at most 1 MiB. The clipping carries `extraction: manual` and `supplied-sha256`, the SHA-256 of the file's bytes; the file's name is not recorded. The thin, login-form and decline checks apply as to any clip: a page under 100 words is queued as `thin` and is never declined, and a login, consent or age-gate page is queued as `wrong-node` and not written. A missing file, a folder, an empty path or an extension that is not one of those exits 2; a binary file or one over 1 MiB is queued as `attention`. `--from-file` on a URL already clipped is a `duplicate`, and with `--recapture` it writes a dated recapture. The clipper's refusal lines for a thin, wrong-node or login, consent or age-gate page say to use this route. `apply-reclips` refuses a clipping with `extraction: manual` (listed as refused, not a failure); to refresh one, save the page again and run `--from-file <path> --recapture`. The login-form check compares the page's title with its text, and it cannot judge a title with no word of five letters or more, for example a URL that ends in a bare id; a gate page supplied at such a URL is not caught.

**Names.** A page's title names its file. A document with no title and no heading is named from its URL path, nearest folder first, so `.../skills/one/SKILL.md` is `one-SKILL.md` and `.../skills/two/SKILL.md` is `two-SKILL.md`; the bare last segment is used only after the folders. The frontmatter `title:` stays exactly what the extractor returned, so `title: ""` on such a clipping is not a defect. A new clipping never ends `.md.md`; an older one may, and its name is still valid. A title another clipping already holds gets the distinguishing URL part added, for example `Smith v. Jones (93-1260.ZO)`. `--slug=<name>` chooses the file name without `.md`; a taken name is a clash and is never suffixed. `clip-pdf`, `clip-docx`, `clip-pptx` and `clip-xlsx` also take `--title="<text>"`, for a file whose name is not its title (`valve.pdf`), and `--slug=<name>`.

An option a clipper does not know exits 2 with its usage and clips nothing; `--help` prints the usage and clips nothing.

**Every unresolved link is queued for triage automatically.** `clip.mjs` records
`failed`, `thin`, and `wrong-node` outcomes to `.wiki-master/triage.jsonl`, so a
link that needs a human survives the terminal scrollback. Do not rely on your
completion report to carry them — point the user at [maintainer triage](../../wiki-maintainer/references/triage.md), where they can
disposition each one (retry, decline, clipped-by-hand). Queue anything else that
needs their judgement yourself with `recordIssue(vaultPath, { url, kind:
'attention', reason })`.

## Finish capture and report
Show the ranked list (title, url, quality, why), which clips succeeded, and which
were skipped (blocked, duplicate, thin, failed). If issues were queued, mention
maintainer triage and report their counts.

**Finish the capture operation before any decision pause.** The clipping set is what
the clippers recorded, not something to rebuild afterwards: run
`node "<absolute-plugin-root>/scripts/op-ledger.mjs" show --since <saved-token> --out <ledger>`
and read its `raw/clippings/...` entries, exactly as written (a name with an em dash
included). The number of `raw/clippings/` entries must equal the number of clippings the
`clipped:` results reported (one per URL or file; `clip-gh` reports a file count, and
`clip-pdf --figures` adds `raw/figures/` entries that are not clippings); if it does not,
stop and find the difference. Never rebuild the set from `git show`, whose default output
quotes and escapes a non-ASCII name. Write one discovery log entry naming the
clipped/declined/failed counts (`log-entry.mjs ... --since <saved-token>`), run `show`
again, and close with:
`node "<absolute-plugin-root>/scripts/op-commit.mjs" --op discover --title "<topic> → N clipped" --since <saved-token> --paths-file <ledger>`.
The `<ledger>` file you wrote outlives the close, so the ingest that follows takes its
clipping set from it.
Without `--paths-file` the close is refused while another operation is open. Verify the commit and push and verify remote publication through the shared
contract (`wiki-sync.mjs --op <saved-token> --paths-file <ledger> --title "<topic>"` closes and pushes in one command). If no writes occurred, report that and do not manufacture a log/commit.
Clippings must not remain dirty while waiting for an ingestion decision.

Then use the existing authorization for this exact source set:
- **Discover-and-ingest already authorized:** read [ingestion](ingest.md) and process the named
  successful clippings immediately. It owns a fresh operation and its own log.
  No second confirmation is needed.
- **Only discovery or capture authorized:** report the captured set and stop; do
  not create derived pages. If ingestion is subsequently requested, use the named
  set in a fresh operation.
- **Ingestion declined:** retain the committed clippings for manual review.

## Guardrails
- The perspective passes never write the vault; the matching clipping helper is the sole writer to its raw artifacts.
- Never edit the **body** of anything under `raw/` — clipped content is immutable
  source-of-truth. Frontmatter is pipeline state and may be updated by wiki-master
  tooling only (never by hand, never the body).
- Prefer primary/authoritative sources over open-publishing platforms.
- Ingestion requires authorization for this scope; existing explicit authorization
  satisfies this ingestion boundary. Do not add another confirmation to an approved discover-and-ingest run.
