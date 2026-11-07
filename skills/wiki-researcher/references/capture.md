Read directly for this task: [access](../../wiki-maintainer/references/access.md), [evidence](../../wiki-maintainer/references/evidence.md), [efficacy](../../wiki-maintainer/references/efficacy.md), [completion](../../wiki-maintainer/references/operations.md).
Reuse existing session authorization for the first write.

# Capture named sources and research selections

A named URL or file request starts here, without broad web discovery or perspective
fan-out. Capture-only work never creates derived source or concept pages. Pick the
route for the source's format, read only that route, then use its actual result and
[finish the capture](#finish-capture-and-report) below.

## Choose the route

| The source is | Read | Helper |
|---|---|---|
| A web page, including a JavaScript site, a tabbed page, a page with a Markdown twin, a list of URLs, or a page a person saved | [web capture](clip-html.md) | `clip.mjs` |
| A PDF file or a PDF URL | [PDF capture](clip-pdf.md) | `clip-pdf.mjs` |
| A Word document | [Word capture](clip-docx.md) | `clip-docx.mjs` |
| A PowerPoint deck | [PowerPoint capture](clip-pptx.md) | `clip-pptx.mjs` |
| A spreadsheet | [spreadsheet capture](clip-xlsx.md) | `clip-xlsx.mjs` |
| A GitHub repository | [GitHub capture](clip-gh.md) | `clip-gh.mjs` |
| A Confluence Cloud page | [Confluence capture](clip-confluence.md) | `clip-confluence.mjs` |
| A file a person already clipped by hand into `raw/clippings/` | [below](#files-a-person-clipped-by-hand) | `adopt-clipping.mjs` |

Run the direct [prerequisites and diagnostics](../../wiki-setup/references/capture-prerequisites.md) for the format when checking tool
availability or handling a failed capture.

## Named sources
When the user names the pages to capture (URLs or saved files), there is nothing to
search for: skip broad research and discovery scoring. Dedup still applies to
the exact pages they named:
- Check them: `node "<absolute-plugin-root>/scripts/known-urls.mjs" --check "<url>" "<url>"`
  (read-only). The lines come back in the order given and carry no
  URL, so match them by position. `new`: clip it. `clipped raw/clippings/<name>.md`: it is
  already in the vault, so say so; if the user wants a second, dated copy of a page that has
  changed, clip it with `--recapture` (see [web capture](clip-html.md#a-second-capture-of-a-page)).
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
  available (see [the browser render](clip-html.md#the-browser-render)), and for a login, a consent
  wall or an age check: the user saves it from a signed-in browser and you supply
  it with `--from-file` (see [saved pages](clip-html.md#a-page-a-person-saved)).

## Capture the selected sources
Do prerequisite and duplicate checks first. When there is nothing to capture or
decline, return without writing a log. Read-only named-URL dedup does not require
broad coverage research.

For each kept candidate:
`node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --quality=<tier> --topic="<topic>"`

For a long list of web addresses, use `clip.mjs --list <file> --ledger <file>` instead of a
loop ([lists](clip-html.md#lists-and-the-ledger)).

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
node "<absolute-plugin-root>/scripts/clip-pdf.mjs"  "<file.pdf or https-url>"  --source="<url>" --quality=<tier> --topic="<topic>"
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

`clip.mjs` blocks unreliable domains, skips dupes, extracts via Defuddle, and writes
`raw/clippings/<slug>.md` with `source`, `created`, `tags:[clippings]`, `quality`,
`topic`, `source-hash`. Read the actual outcome with [what a clip result means](clip-html.md#what-a-clip-result-means):
a thin page declined after a browser read it differs from a failure or a login wall, which are queued rather than judged
as sources. Use [HTML/supplied-page diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages) for thin, wrong-node, transient, clash or supplied-file refusal recovery; do not retry blindly or fabricate a raw file.

`clip-pdf`, `clip-docx`, `clip-pptx` and `clip-xlsx` also take `--title="<text>"`, for a file whose name is not its title (`valve.pdf`), and `--slug=<name>`, which names the clipping file without `.md`; a taken name is a clash and is never suffixed. `clip.mjs` takes `--slug <name>` or `--slug=<name>` ([names](clip-html.md#names)).

An option a clipper does not know exits 2 with its usage and clips nothing; `--help` prints the usage and clips nothing.

**Every unresolved link is queued for triage automatically.** `clip.mjs` records
`failed`, `blocked`, `gone`, `thin`, `wrong-node` and `attention` outcomes to `.wiki-master/triage.jsonl`, so a
link that needs a human survives the terminal scrollback. Do not rely on your
completion report to carry them — point the user at [maintainer triage](../../wiki-maintainer/references/triage.md), where they can
disposition each one (retry, decline, clipped-by-hand). Queue anything else that
needs their judgement yourself with `recordIssue(vaultPath, { url, kind:
'attention', reason })`.

## Files a person clipped by hand
A file saved into `raw/clippings/` with a browser clipper has no `source-hash`, `quality` or `topic`, so health flags it and it cannot be ingested. Bring the exact files into the pipeline with `adopt-clipping.mjs`:

```bash
node "<absolute-plugin-root>/scripts/adopt-clipping.mjs" "raw/clippings/<name>.md" ... --quality=<tier> --topic="<topic>"          # dry run
node "<absolute-plugin-root>/scripts/adopt-clipping.mjs" "raw/clippings/<name>.md" ... --quality=<tier> --topic="<topic>" --apply
```

- It stamps the `source-hash` a clipper would have written for the same text and fills `quality` and `topic` when the file has none. Only the frontmatter changes; the body stays byte-identical and a second run changes nothing.
- It refuses with exit 2, before writing anything: a path outside `raw/clippings/`, a file that starts with a byte-order mark, a file with no frontmatter or no `source:` line, and a file with no quality when `--quality` is not given.
- A value the file already holds that differs from the one given is reported as a conflict and left alone.
- The dry run is the default; `--apply` is a write, so it needs the same scope as a capture.
- `repair-missing-hash.mjs` is the sweep: it stamps `source-hash` on every unhashed clipping in the vault, takes no file list and fills no `quality` or `topic`. Use `adopt-clipping.mjs` for named files, and the sweep only when repairing the whole vault is in scope.
- A clipping saved with CRLF line breaks is stamped with the hash of its CRLF body, so a `--recapture` of identical text with LF breaks is not reported `unchanged` and writes a dated second capture.

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
