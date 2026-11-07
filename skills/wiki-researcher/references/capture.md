Read directly for this task: [access](../../wiki-maintainer/references/access.md), [evidence](../../wiki-maintainer/references/evidence.md), [efficacy](../../wiki-maintainer/references/efficacy.md), [completion](../../wiki-maintainer/references/operations.md).
Reuse existing session authorization for the first write.

# Capture named sources and research selections

A named URL or file request starts here, without broad web discovery or perspective
fan-out. Capture-only work never creates derived source or concept pages. For a
format-specific source, read its route before capture: [PDF](clip-pdf.md),
[Word](clip-docx.md), [PowerPoint](clip-pptx.md), [spreadsheet](clip-xlsx.md),
[GitHub repository](clip-gh.md), or [Confluence](clip-confluence.md).
Only read the matching route, then use its actual result and
[finish the capture](#finish-capture-and-report) below. The HTML mechanics below apply to ordinary web pages and supplied pages.
Run their direct [prerequisites and diagnostics](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages) when checking extraction availability or handling a failed capture.

## Named sources
When the user names the pages to capture (URLs or saved files), there is nothing to
search for: skip broad research and discovery scoring. Dedup still applies to
the exact pages they named:
- Check them: `node "<absolute-plugin-root>/scripts/known-urls.mjs" --check "<url>" "<url>"`
  (read-only). The lines come back in the order given and carry no
  URL, so match them by position. `new`: clip it. `clipped raw/clippings/<name>.md`: it is
  already in the vault, so say so; if the user wants a second, dated copy of a page that has
  changed, clip it with `--recapture` (see the result table below).
  `declined: <reason>`: leave it, unless the user says the decline no longer holds; then
  `node "<absolute-plugin-root>/scripts/decline.mjs" supersede "<url>" --reason "<why>"`, or
  `--supersede-decline="<why>"` on the clip.
- Clip the new ones using the capture procedure below, with `--topic="<topic>"` (the topic as the user gave it)
  and `--quality=<tier>` on every clip.
- A page the user rejects is recorded, not forgotten:
  `node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --decline="<one-line reason>"`.
- [Finish the capture](#finish-capture-and-report) below. Ingest only when the exact source set
  is already authorized; a capture-only request ends after the verified capture is logged.
- A saved page is the route when the browser could not read the page or is not
  available (see **What the render decides** below), and for a login, a consent
  wall or an age check: the user saves it from a signed-in browser and you supply
  it with `--from-file` (below).

## Capture the selected sources
Do prerequisite and duplicate checks first. When there is nothing to capture or
decline, return without writing a log. Read-only named-URL dedup does not require
broad coverage research.

For each kept candidate:
`node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --quality=<tier> --topic="<topic>"`

**Pass `--topic` on every clip in the run, and use the same string for all of
them** — it is what lets maintainer triage group this run's leftovers together
later. Use the topic as the user gave it ($ARGUMENTS); do not re-word it per
source, or one run becomes several groups. The flag feeds both places a topic
can land: the clipping's frontmatter when the clip succeeds, and the triage log
when it fails, so you never have to know which happened.

**"Every clip" includes the non-HTML ones.** A candidate that is a PDF, a Word
file, a PowerPoint deck or a spreadsheet does not go through `clip.mjs` — it goes through
`clip-pdf.mjs`, `clip-docx.mjs`, `clip-pptx.mjs` or `clip-xlsx.mjs` (see [PDF capture](clip-pdf.md),
[Word capture](clip-docx.md), [PowerPoint capture](clip-pptx.md) and
[spreadsheet capture](clip-xlsx.md)), and **every one of those takes `--topic` too**:

```bash
node "<absolute-plugin-root>/scripts/clip-pdf.mjs"  "<file.pdf>"  --source="<url>" --quality=<tier> --topic="<topic>"
node "<absolute-plugin-root>/scripts/clip-docx.mjs" "<file.docx>" --source="<url>" --quality=<tier> --topic="<topic>"
node "<absolute-plugin-root>/scripts/clip-pptx.mjs" "<file.pptx>" --source="<url>" --quality=<tier> --topic="<topic>"
node "<absolute-plugin-root>/scripts/clip-xlsx.mjs" "<file.xlsx>" --source="<url>" --quality=<tier> --topic="<topic>"
# clip-pdf also renders figure files (--figures)
```

**A Confluence Cloud URL is HTML but also does not go through `clip.mjs`** — it
requires authentication `clip.mjs` does not have, so it reads
as thin content and can be declined. Route it to [Confluence capture](clip-confluence.md) instead
(only applies if the `confluencer` plugin is installed — an optional runtime
dependency this one clipper alone takes on; see that reference for why):

```bash
node "<absolute-plugin-root>/scripts/clip-confluence.mjs" "<confluence-url-or-page-id>" --quality=<tier> --topic="<topic>"
```

Binary capture routes need the same topic string as HTML routes. Topic is
recorded going forward only; missing attribution leaves the resulting rows under
Unattributed. For a one-off named source outside a research run, omit the topic
rather than inventing one.

It blocks unreliable domains, skips dupes, extracts via Defuddle, and writes
`raw/clippings/<slug>.md` with `source`, `created`, `tags:[clippings]`, `quality`,
`topic`, `source-hash`. Read the actual outcome: a thin page declined after a browser read it
differs from a failure or a login wall, which are queued rather than judged
as sources. Use [HTML/supplied-page diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages) for thin, wrong-node, transient, clash or supplied-file refusal recovery; do not retry blindly or fabricate a raw file.

**When a browser renders the page.** `clip.mjs` tries the served HTML first. It renders the page in a browser when that fetch fails or the text is under 100 words. A plain-text capture, a supplied file and a PDF URL whose fetch failed are not rendered. The render needs `playwright-core` and Chrome or Edge; `node "<absolute-plugin-root>/scripts/doctor.mjs"` reports both as optional under `clip`, so a missing browser does not fail it. A rendered clipping shows as `extraction: rendered` in its frontmatter. Its `clipped:` line looks like any other.

**What the render decides.** On a thin page, only a browser that read the page can justify a 180-day decline:

| Render result | Clip outcome |
|---|---|
| `ok`, at least 100 words | Clipped with `extraction: rendered` |
| `ok`, still thin | Declined and queued as `thin` or `wrong-node` |
| `unavailable` (no `playwright-core` or browser) | Queued as `thin` or `wrong-node`, not declined |
| `blocked` or `failed` (a timeout is `failed`) | Queued as `thin` or `wrong-node` with the render's reason, not declined. The line ends `triage recorded; not declined — browser render did not read the page (<reason>)` |
| `gone` | Queued as `gone`, not declined |

Text the clipper judges a short real article (an `<article>` or `<main>` of at least 50 words, or three headings over at least 20 words) still clips as a brief article. A failed fetch whose render also fails is printed as `clip failed` or `page gone` and queued, not declined.

**A thin documentation page: two things to try by hand.** `clip.mjs` tries neither on its own.

1. Clip the page's text twin. Some documentation sites serve one at `<url>.md.txt` or `<url>.md` (drop a trailing `/` first). Run `clip.mjs` on that URL; a 200 answer with a text content type becomes a plain-text capture, described below. Its `source` is the twin's URL, so the page's own triage row and decline stay as they are. Any other answer takes the ordinary route under the twin's URL and can leave its own row or decline; report it.
2. Render the page yourself, with a browser tool your host provides, save the result as `.html`, and record it with `clip.mjs "<url>" --from-file <path>`. The clipping's `source` is the page's URL and it carries `extraction: manual`, as described under **A page a person saved**.

A raw text URL (for example a checksum manifest or pinned source file) is captured whole in a code fence with `extraction: plaintext`, without the ordinary thin-content test. Its `source` is the URL you gave. Binary/oversized refusal diagnosis remains in the directly linked setup procedure.

**What a clip result means.** `clip.mjs` prints one result per URL:

| Result | Meaning | What you do |
|---|---|---|
| `clipped: raw/clippings/<name>.md` | written | cite that path |
| `duplicate (already clipped)` | this URL is already in the vault, also when another session wrote it first | nothing; do not clip it again. To keep a second, dated copy of a page that has changed, run the clip again with `--recapture` |
| `unchanged (same text as raw/clippings/<name>.md); nothing written` | `--recapture` found the page's text identical to a capture already held (exit 0) | nothing; the page has not changed |
| `recapture: not clipped yet, clipping it normally: <url>` | `--recapture` on a URL that was not in the vault; the line is followed by the ordinary result | read the result that follows |
| `clash: <url>: raw/clippings/<name>.md already exists ...` | the URL is new but every name it could have had was taken; **nothing was written** and one `attention` row is queued in triage | follow [clash diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages) or leave the row for maintainer triage |
| `declined`, `blocked`, `thin content`, `possible extraction mismatch`, `login, consent or age-gate page`, `page gone`, `clip failed`, `not clipped` | no successful capture; the line says whether a decline was recorded | use [outcome diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages); report the actual result |

A taken file name is a `clash`, never a `duplicate`: a `duplicate` always means the same URL.

**A second capture of a page already clipped.** `clip.mjs "<url>" --recapture` fetches the page and runs the usual checks. If the text is new it writes a second clipping beside the first, named as the oldest capture's own name followed by ` (recaptured YYYY-MM-DD)`, with the same suffix on its `title`, `recapture-of` naming the newest existing capture, and `created` today; the older clipping is never edited. A second recapture on the same day with different text is a `clash`. `--slug=<name>` with `--recapture` is used exactly, with no suffix. Without the flag the same URL is a `duplicate`.

**A page a person saved.** `clip.mjs "<url>" --from-file <path> --topic="<topic>"` records a page saved from a signed-in browser, with its real URL as `source` and nothing fetched. The file is `.md`, `.markdown` or `.txt` (the page text) or `.html` or `.htm` (read by the same extractor as a fetched page), at most 1 MiB. The clipping carries `extraction: manual` and `supplied-sha256`, the SHA-256 of the file's bytes; the file's name is not recorded. The ordinary thin, interstitial and decline checks still apply; inspect the actual result and [supplied-page diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages). `--from-file` on an existing URL is a duplicate; adding `--recapture` requests a dated new capture. Refresh an `extraction: manual` clipping through this same supplied-file route, not `apply-reclips`. These interfaces do not authorize inventing the page body.

**Names.** A page's title names its file. A document with no title and no heading is named from its URL path, nearest folder first, so `.../skills/one/SKILL.md` is `one-SKILL.md` and `.../skills/two/SKILL.md` is `two-SKILL.md`; the bare last segment is used only after the folders. The frontmatter `title:` stays exactly what the extractor returned, so `title: ""` on such a clipping is not a defect. A new clipping never ends `.md.md`; an older one may, and its name is still valid. A title another clipping already holds gets the distinguishing URL part added, for example `Smith v. Jones (93-1260.ZO)`. `--slug=<name>` chooses the file name without `.md`; a taken name is a clash and is never suffixed. `clip-pdf`, `clip-docx`, `clip-pptx` and `clip-xlsx` also take `--title="<text>"`, for a file whose name is not its title (`valve.pdf`), and `--slug=<name>`.

An option a clipper does not know exits 2 with its usage and clips nothing; `--help` prints the usage and clips nothing.

**Every unresolved link is queued for triage automatically.** `clip.mjs` records
`failed`, `blocked`, `gone`, `thin`, `wrong-node` and `attention` outcomes to `.wiki-master/triage.jsonl`, so a
link that needs a human survives the terminal scrollback. Do not rely on your
completion report to carry them — point the user at [maintainer triage](../../wiki-maintainer/references/triage.md), where they can
disposition each one (retry, decline, clipped-by-hand). Queue anything else that
needs their judgement yourself with `recordIssue(vaultPath, { url, kind:
'attention', reason })`.

## Finish capture and report
Show the ranked list (title, url, quality, why), which clips succeeded, and which
were skipped (blocked, duplicate, thin, failed). If issues were queued, mention
maintainer triage and report their counts.

**The clipping set is what the clippers printed,** exactly as printed (a name with an em
dash included): keep those paths for an ingest that follows. Each `clipped:` result names
one clipping, except that `clip-gh` reports a file count and a folder, so list that folder.
`clip-pdf --figures` also writes `raw/figures/` files, which are not clippings. Verify the
paths and their fidelity.

**Log once, before any decision pause.** Pipe one entry naming the clipped/declined/failed
counts to `node "<absolute-plugin-root>/scripts/log-entry.mjs" --op discover --title "<topic> → N clipped"`.
If nothing was written, report that and do not manufacture a log.

**A capture that wrote no wiki page ends there and needs no refresh.** Clippings and log
entries enter neither the catalogs nor the search index, so `refresh-index.mjs` has nothing
to do for them. If the task also wrote wiki pages, [validate them](../../wiki-setup/references/validation.md)
before the log entry and run `refresh-index.mjs` after it, as
[completion](../../wiki-maintainer/references/operations.md) describes. Report that the work
is on disk and that Obsidian Git publishes it on its next run.

Then use the existing authorization for this exact source set:
- **Discover-and-ingest already authorized:** read [ingestion](ingest.md) and process the named
  successful clippings immediately. It writes its own log entry and ends with the refresh.
  No second confirmation is needed.
- **Only discovery or capture authorized:** report the captured set and stop; do
  not create derived pages. If ingestion is subsequently requested, use the named set.
- **Ingestion declined:** retain the clippings for manual review.

## Guardrails
- The perspective passes never write the vault; the matching clipping helper is the sole writer to its raw artifacts.
- Never edit the **body** of anything under `raw/` — clipped content is immutable
  source-of-truth. Frontmatter is pipeline state and may be updated by wiki-master
  tooling only (never by hand, never the body).
- Prefer primary/authoritative sources over open platforms where anyone can post.
- Ingestion requires authorization for this scope; existing explicit authorization
  satisfies this ingestion boundary. Do not add another confirmation to an approved discover-and-ingest run.
