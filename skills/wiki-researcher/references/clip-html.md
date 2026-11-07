Read [access and host commands](../../wiki-maintainer/references/access.md) before touching the vault. Also read for this task: [completion](../../wiki-maintainer/references/operations.md).
Load the rest only when this run reaches it — [evidence](../../wiki-maintainer/references/evidence.md) before a quote or figure from this capture lands on a wiki page, or when reporting a fidelity limit.
Reuse existing session authorization for the first write.

# Clipping a web page into the wiki

`clip.mjs` is the one route for web pages: JavaScript sites, tabbed pages, pages with a plain-text twin, landing pages and
lists of addresses. Never write a browser script, a download step or a shell loop around it. It is the only writer of web
clippings; a PDF, Word, PowerPoint, spreadsheet, GitHub or Confluence source has its own route from [capture](capture.md).

1. **Preflight:** run `node "<absolute-plugin-root>/scripts/doctor.mjs"` (read-only) and read its `clip` line, then use the direct
   [diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages) for a missing runtime or browser.
2. **Check the address:** `known-urls.mjs --check "<url>"` as in [capture](capture.md#named-sources).
3. **Clip:** `node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --quality=<tier> --topic="<topic>"`, with the run's one topic string. An address that carries a username, password or secret query parameter is refused
   ([below](#addresses-that-carry-a-secret)).
4. **Read the printed result** against the tables below, verify the path it printed, and [finish the capture](capture.md#finish-capture-and-report).

It blocks unreliable domains, skips duplicates, checks the decline log, extracts with Defuddle and writes
`raw/clippings/<slug>.md` with `source`, `created`, `tags: [clippings]`, `quality`, `topic` and `source-hash`.

## Options

| Option | Use |
|---|---|
| `--quality=high\|medium\|low`, `--topic="<t>"` | On every clip of a run; the same topic string each time. |
| `--expand` | Open the page's tabs and collapsed panels in a browser and store all of them. See [tabs](#tabs-and-expansion). |
| `--recapture` | A dated second capture of a URL already clipped. See [recapture](#a-second-capture-of-a-page). |
| `--from-file <path>` | A page a person saved. See [saved pages](#a-page-a-person-saved). |
| `--find-twin` | Print the plain-text twin of a page that clipped with a partial fidelity warning. Writes nothing. |
| `--list <file>`, `--ledger <file>` | Many addresses; a machine-readable result per address. See [lists](#lists-and-the-ledger). |
| `--slug <name>` or `--slug=<name>` | The file name, without `.md`. A taken name is a `clash`: nothing is written and nothing is suffixed. |
| `--decline="<reason>"`, `--override-decline`, `--supersede-decline="<why>"` | Record a rejection; lift a decline the clippers recorded themselves; lift any decline and say why. |

An option `clip.mjs` does not know exits 2 with its usage and clips nothing; `--help` prints the usage.

## The fetch ladder

Each rung runs only when the one before it fails or reads thin (under 100 words). Stop at the first that works.

1. **Served HTML.** Extracted with Defuddle. Tab panels the HTML already holds are kept (see [tabs](#tabs-and-expansion)). A page that keeps
   far less text than it shows is read again (see [shortfall](#an-extraction-that-keeps-far-less-than-the-page-shows)).
2. **Plain-text twin.** When the read is thin or fails, the clipper asks the site for the page as Markdown before it starts a browser.
   See [twins](#plain-text-twins). A landing page is labeled before this rung; see [landing pages](#landing-pages).
3. **Browser render.** `playwright-core` with Chrome or Edge reads the page after its scripts have run. See [the render](#the-browser-render).
4. **`--expand`, on request only.** It goes straight to the browser and skips rungs 1 and 2.

A plain-text capture, a supplied file and a PDF URL whose fetch failed are not rendered. A raw text URL (a checksum manifest, a
pinned source file) is captured whole in a code fence with `extraction: plaintext`, without the thin-content test; its `source` is
the URL you gave, and a binary file or one over 1 MiB is refused and queued as `attention` (see the setup diagnosis). An address ending `.pdf` or with a
`/pdf/` segment whose fetch fails is never rendered: it queues an `attention` row naming `clip-pdf.mjs "<url>"`.

## What a clip result means

`clip.mjs` prints one result per URL:

| Result | Meaning | What you do |
|---|---|---|
| `clipped: raw/clippings/<name>.md` | written | cite that path |
| `duplicate (already clipped)` | this URL, or the twin it was stored from, is already in the vault, also when another session wrote it first | nothing; do not clip it again. For a second, dated copy of a changed page use `--recapture` |
| `unchanged (same text as raw/clippings/<name>.md); nothing written` | `--recapture` found text identical to a capture already held (exit 0) | nothing; the page has not changed |
| `recapture: not clipped yet, clipping it normally: <url>` | `--recapture` on a URL that was not in the vault; the ordinary result follows | read the result that follows |
| `clash: <url>: raw/clippings/<name>.md already exists ...` | every name the URL could have had was taken; **nothing was written** and one `attention` row is queued | follow [clash diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages) or leave the row for maintainer triage |
| `declined`, `blocked`, `thin content`, `possible extraction mismatch`, `login, consent or age-gate page`, `page gone`, `clip failed`, `not clipped` | no successful capture; the line says whether a decline was recorded | use [outcome diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages); report the actual result |

A taken file name is a `clash`, never a `duplicate`: a `duplicate` always means the same URL.

Lines that come with a result and are not outcomes:

| Line | Meaning |
|---|---|
| `note: page has N tab controls this clip did not open; use --recapture --expand` | The served HTML shows N tabs with no panel. See [tabs](#tabs-and-expansion). |
| `note: extraction retry kept (<value>): N of about M visible words` | The first read lost most of the page and a retry recovered it. |
| `note: extracted N of about M visible words` | The first read kept under a fifth of the page and no retry helped. Inspect the clipping; nothing was flagged. |
| `landing page: the document is at <url>; run clip-pdf.mjs "<url>"` | The clipping is a landing page. See [landing pages](#landing-pages). |
| `fidelity warning (queued for triage): ...` | The clip was saved as `fidelity: partial`. |

Every unresolved URL is queued for triage as `failed`, `blocked`, `gone`, `thin`, `wrong-node` or `attention` in
`.wiki-master/triage.jsonl`. Do not rely on your report to carry them: point the user at
[maintainer triage](../../wiki-maintainer/references/triage.md). Queue anything else that needs their judgment with
`recordIssue(vaultPath, { url, kind: 'attention', reason })`.

## The browser render

The render needs `playwright-core` and a Chromium-based browser (Chrome or Edge, or `WIKI_MASTER_BROWSER` naming an executable).
`playwright-core` is the pinned version: the clipper uses a local copy when there is one and otherwise fetches it through `npx` on
first use, so the first render downloads it and needs network and npm. `doctor.mjs` reports two optional rows under `clip`:
`playwright-core` as `local`, `on first use through npx` or missing, and `browser`. A missing optional row does not fail doctor,
and doctor never downloads anything. A rendered clipping's `clipped:` line looks like any other; its frontmatter says `extraction: rendered`. With no browser the result is `unavailable` and `npx` is not tried. An `npx` that cannot
run, for example offline, also reports `unavailable`.

On a thin page, only a browser that read the page can justify a 180-day decline:

| Render result | Clip outcome |
|---|---|
| `ok`, at least 100 words | Clipped with `extraction: rendered` |
| `ok`, still thin, and a made-up address on the same site reads differently | Declined and queued as `thin` or `wrong-node` |
| `ok`, still thin, and the site serves the same text for a made-up address | Queued as `thin` with a reason starting `unverified URL:`; **not** declined. A later successful clip closes the row |
| `unavailable` (no `playwright-core` or browser) | Queued as `thin` or `wrong-node`, not declined |
| `blocked` or `failed` (a timeout is `failed`) | Queued as `thin` or `wrong-node` with the render's reason, not declined. The line ends `triage recorded; not declined — browser render did not read the page (<reason>)` |
| `gone` | Queued as `gone`, not declined |

Text the clipper judges a short real article (an `<article>` or `<main>` of at least 50 words, or three headings over at least
20 words) still clips as a brief article. A failed fetch whose render also fails is printed as `clip failed` or `page gone` and
queued, not declined.

**A generic shell.** When a browser read the page and it is still thin with no sign of a wrong node, the clipper renders one
more address: the page's origin and folder with a made-up last segment (`wiki-master-probe-<8 hex>`), no query. Identical text
means the site serves that shell for any address, so the read says nothing about this URL: the row is `thin` with
`unverified URL:` and no decline is recorded. A different text, a 404 or a failed render of the made-up address means the page
itself is the shell, and it is declined. A `wrong-node` verdict makes no such probe, and neither does an `--expand` read.

## Extraction values and frontmatter

`extraction:` says how the text was obtained. It is a method, not a defect; triage raises nothing for it.

| `extraction:` | Meaning |
|---|---|
| absent (`text`) | Read from the served HTML |
| `rendered` | Read from the page in a browser, including every `--expand` clip |
| `manual` | A person saved the page and supplied it with `--from-file` |
| `plaintext` | A raw text URL, kept whole in a code fence |
| `plaintext-twin` | The page's own Markdown twin, stored as it is (unfenced), with `twin-url` |

Other web frontmatter:

| Field | Meaning |
|---|---|
| `extraction-retry: unwrap-inline` or `remove-images` | The first read lost most of the page; a changed copy of the markup gave it back. A separate key, so `extraction:` keeps its closed set |
| `twin-url` | Where the stored Markdown was served from, when `extraction: plaintext-twin`. `source` stays the page URL |
| `expand-coverage: "tabs=12 panels=12 details=3 tables=4 code=9 truncated=false"` | What an `--expand` read opened and found |
| `landing-page: true`, `document-link` | A short page whose substance is one PDF link; the link is the document's address |
| `supplied-sha256` | SHA-256 of the file a person supplied; `source-hash` hashes the stored text |
| `recapture-of` | Vault path of the newest capture this one follows |
| `fidelity: partial`, `fidelity-checks`, `fidelity-ignored` | The source-to-output check; see [clipping fidelity](../../../docs/clipping-fidelity.md) |

## Tabs and expansion

**In the served HTML.** Every extraction keeps each tab panel that has content as a plain section headed by its tab's label, with
hiding removed and the tab list deleted; identical panels in one group appear once. This covers fetched pages, renders and
`--from-file` HTML. When a panel cannot be tied to a tab it is kept without a heading. A tab whose panel is missing or empty
in the HTML is not stored, and the clip prints `note: page has N tab controls this clip did not open; use --recapture --expand`.
That note counts only what the HTML shows; a page that builds its tabs by script reaches the clipper through the render instead.

**`--expand`** reads the page in a browser and opens its hidden content:

- It opens every `<details>`, clicks each tab, and clicks each `[aria-expanded="false"][aria-controls]` control outside `nav`,
  `header`, `footer` and `form`. Each active panel is copied beside its tab list under the tab's label.
- It sends no request except GET, aborts every top-level navigation, closes any window a click opens and uses no cookies or
  profile. A form or a link-styled tab cannot change the server or leave the page.
- It stops at 200 clicks or 60 seconds. Hitting either, or losing a tab list, sets `fidelity: partial` and `truncated=true`.
- It counts the page's tables and code blocks. If the Markdown holds fewer, the clip is `fidelity: partial` and a `fidelity` row is
  queued. Zero warnings still does not prove every panel was opened.
- It is refused with exit 2 for `--from-file`, a `.pdf` URL and a plain-text URL. In a `--list` run that address is an `error` outcome.
- A page the browser cannot read is queued, never declined, and never replaced by static text. An `--expand` read that is thin is
  queued as `thin`, not declined.
- Refresh an expanded clipping with `clip.mjs "<url>" --recapture --expand`. `apply-reclips` and `refresh-fidelity --apply` leave it alone.

## An extraction that keeps far less than the page shows

When a page shows at least 300 words in its content region and the extraction keeps under a fifth of them, the extractor reads
the original HTML again with a changed copy of its markup: first `unwrap-inline` (an inline wrapper such as a `span` or `label`
around a block or a custom element is replaced by its children), then `remove-images` (every image except equation images). It keeps
the result with the most words if that is at least twice the first read's and more than it, and records `extraction-retry:`.
It covers fetched pages, renders and `--from-file` HTML.

If no retry helps, the clip prints `note: extracted N of about M visible words`. It sets no `fidelity: partial` and queues no row,
because a short article beside a long comment thread trips the same trigger: judge it from the clipping. Existing clippings are
untouched; `--recapture` picks up recovered text.

## Landing pages

A page under 300 words whose content region (outside `nav`, `header` and `footer`) links to exactly one distinct PDF is a landing page: the document is what a reader
wants and the page only announces it. It is written (not declined as thin) with `landing-page: true` and `document-link`, the
clip prints `landing page: the document is at <url>; run clip-pdf.mjs "<url>"`, and one `attention` row is queued on the document's
address. `clip.mjs` never fetches the document itself.

Clip the document yourself with `node "<absolute-plugin-root>/scripts/clip-pdf.mjs" "<url>" --quality=<tier> --topic="<topic>"` (see
[PDF capture](clip-pdf.md)). The row closes when that clip lands or finds the document already in the vault. A landing
clipping is not evidence for the document's contents; [ingestion](ingest.md) uses the document's own clipping. A page with two
PDF links, a page of 300 words or more, an `--expand` read and a link carrying a secret are never landing pages.

## Plain-text twins

Many documentation sites serve a page as Markdown too. When static extraction is thin or fails, the URL is not a text file or a PDF,
and no file was supplied, the clipper probes in order until one qualifies, at most five requests of 10 seconds each:

1. `<base>.md.txt`, then `<base>.md`, where `<base>` is the URL without query, fragment or trailing slash (skipped when the path is empty).
2. A link on the page labeled "View page in Markdown" or "View as Markdown", or typed `text/markdown`.
3. The page's own entry in the origin's `/llms.txt`. The index is read only to find that entry and is never stored.

A twin qualifies when it is `text/plain`, `text/markdown` or `text/x-markdown`, is not an HTML document, has at least 100 words, and its
final address has the page's origin and path. Candidates found in the page are probed on the page's own origin only, and a redirect
to another origin is refused before any request goes there. A page after a failed fetch has no links, so only the suffixes and
`/llms.txt` are tried.

A twin is stored unfenced as `extraction: plaintext-twin`. The title is its first `#` heading, else the page's title, else a name from the
URL. `source` is the page URL and `twin-url` is the twin. A page already clipped is a `duplicate`, and so is a twin already held as any
clipping's `source` or `twin-url`; `known-urls.mjs --check "<twin>"` reports it as clipped. The decline gate runs first, and `--recapture` skips the held-twin check.
`--recapture` refreshes a twin clipping; `apply-reclips` refuses it. A healthy page, a supplied file and an `--expand` run are not probed.

`--find-twin` is for a page that clipped with `fidelity: partial`: it reads the page again, probes, and prints
`twin found (N words; nothing was written): <url>` or `no plain-text twin found`. For a URL with no such clipping it prints
`no probe (...)`. It never writes. Clipping the twin's address directly stores it as its own fenced `plaintext` source. It is refused
with `--from-file` and `--expand`.

## Lists and the ledger

```bash
node "<absolute-plugin-root>/scripts/clip.mjs" --list urls.txt --quality=<tier> --topic="<topic>" --ledger run.jsonl
```

`--list <file>` must be the first argument. The file holds one address per line; blank lines and lines starting `#` are skipped.
The addresses run in order, one at a time, with at least one second between two requests to the same host. The other options apply to
each address. A line that is not an http or https address, or that carries a secret, is an `error` outcome and the run goes on. A
missing extraction runtime stops the run with exit 1. Otherwise the run ends with `list: N URLs: <outcome> <count>, ...` and exits 0,
even after thin or failed outcomes. `--list` with a URL on the command line, `--from-file`, `--slug`, `--decline`, `--override-decline`
or `--supersede-decline` exits 2, so no decline can be lifted in bulk.

`--ledger <file>` appends one JSON line per address, with or without `--list`. Read it instead of parsing printed lines. Every row has
every field; `null` means the field does not apply.

| Field | Holds |
|---|---|
| `url` | The address, without a username or password and with each secret query value replaced by `redacted`; `null` for a line that is not an address |
| `status` | `clipped`, `unchanged`, `duplicate`, `clash`, `declined`, `blocked`, `thin`, `failed` or `error`; `twin`, `no-twin` or `skipped` for `--find-twin` |
| `path` | `raw/clippings/<name>.md` for `clipped`, `unchanged`, `duplicate` (the clipping that holds the address) and `clash` (the file in the way) |
| `sourceHash` | The text's SHA-256 for `clipped` and `unchanged`; the held clipping's for `duplicate` |
| `quality` | The tier for `clipped`; the held clipping's for `duplicate` |
| `topic` | The `--topic` given; the held clipping's for `duplicate` |
| `extraction` | How the text was obtained, as in the table above (the held clipping's line for `duplicate`, `null` when it has none) |
| `fidelity` | `high` or `partial`, for `clipped` only |
| `reason` | Why, for `declined`, `thin`, `failed`, `clash` and `error` |
| `twinUrl` | The twin a `plaintext-twin` clip was stored from; the twin `--find-twin` found |
| `documentLink` | A landing page's PDF address |
| `expandCoverage` | The `--expand` coverage line |
| `unexpandedTabs` | Tabs the HTML showed with no panel, when above 0 |
| `extractionRetry` | The retry that was kept |
| `visibleWords`, `extractedWords` | The page's visible words and the Markdown's, for a read that went through the HTML extractor |

The ledger file must be outside `raw/` and `wiki/` of the vault, judged by where its path lands (links, `..`, letter case and
UNC spellings of those folders included): a path inside them exits 2 before anything is clipped, as does one that cannot be appended
to. A write that fails later is reported once; the run goes on without rows and ends with exit 2.

## A second capture of a page

`clip.mjs "<url>" --recapture` fetches the page and runs the usual checks. If the text is new it writes a second clipping beside
the first and never edits the older one. Its name is the oldest capture's name followed by ` (recaptured YYYY-MM-DD)`, with the same
suffix on its `title`, `recapture-of` naming the newest existing capture, and `created` today. A second recapture on the same day
with different text is ` (recaptured YYYY-MM-DD 2)`, then `3`, on name and title. Text identical to any capture of the URL writes
nothing and prints `unchanged`. `--slug` with `--recapture` is used exactly, with no suffix, and a taken name is a `clash`. Without
the flag the same URL is a `duplicate`.

To refresh a clipping by method: `--recapture --expand` for an expanded one, `--recapture` for a twin, `--from-file <path> --recapture`
for a supplied page, never `apply-reclips`. Never replace a supplied body with a fresh unauthenticated fetch.

## Names

A page's title names its file. A document with no title and no heading is named from its URL path, nearest folder first, so
`.../skills/one/SKILL.md` is `one-SKILL.md` and `.../skills/two/SKILL.md` is `two-SKILL.md`; the bare last segment is used only after the
folders. The frontmatter `title:` stays exactly what the extractor returned, so `title: ""` on such a clipping is not a defect. A new
clipping never ends `.md.md`; an older one may, and its name is still valid. A title another clipping already holds gets the
distinguishing URL part added, for example `Smith v. Jones (93-1260.ZO)`.

## A page a person saved

`clip.mjs "<url>" --from-file <path> --topic="<topic>"` records a page saved from a signed-in browser, with its real URL as `source` and
nothing fetched. This is the route when the browser could not read the page, and for a login, a consent wall or an age check. The
file is `.md`, `.markdown` or `.txt` (the page text) or `.html` or `.htm` (read by the same extractor as a fetched page), at most
1 MiB. The clipping carries `extraction: manual` and `supplied-sha256`; the file's name is not recorded. The thin, interstitial and
decline checks still apply, so inspect the actual result and use [supplied-page diagnosis](../../wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages).
`--from-file` on an existing URL is a duplicate; add `--recapture` for a dated new capture. These interfaces never authorize
inventing a page body. A file clipped by hand outside the pipeline goes through `adopt-clipping.mjs`; see [capture](capture.md#files-a-person-clipped-by-hand).

## Addresses that carry a secret

A username or password in the address, or a query parameter named (compared without case, after decoding) `password`, `passwd`, `pwd`,
`secret`, `client_secret`, `token`, `access_token`, `id_token`, `refresh_token`, `api_key`, `apikey`, `auth`, `authorization`, `sig`,
`signature`, `x-amz-signature`, `x-amz-security-token` or `x-amz-credential`, makes every clipper refuse the address with exit 2.
Nothing is written, queued, declined, ledgered or printed from it, and the message names the kind and the parameter, never the value.
A legitimate public address that uses one of those names is refused too. Save the page from a signed-in browser and clip it with
`--from-file <path>` under the address without the secret. A candidate found in a page (a PDF link, a twin or Markdown link) that
carries one is dropped.

## Guardrails

- **Never edit the body of anything under `raw/`.** Frontmatter is pipeline state, tooling-only.
- `clip.mjs` is the **sole writer** of web clippings; never write one by hand.
- Do not retry blindly and do not fabricate a raw file when a result is a refusal.
- **Fidelity, not truth:** a faithful extraction of a wrong page is still wrong. Verify quotes against the page.

## Completion

Verify the paths the clipper printed and any `note:` or fidelity lines, then
[finish the capture](capture.md#finish-capture-and-report). During discovery, report the
results to the enclosing task, which logs once. Capture-only requests create no derived
source or concept pages.
Capturing evidence does not by itself authorize ingestion; reuse explicit
discover-and-ingest authorization when it is already present.
