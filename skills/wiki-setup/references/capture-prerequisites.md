# Capture prerequisites and diagnosis

Use only the section for the source being captured. Resolve the installed helper
root and vault through [access](../../wiki-maintainer/references/access.md).
Prerequisite probes and diagnosis do not authorize installs, authentication
changes, captures, re-clips or ingestion. Report what is unavailable and its
effect on coverage; never substitute invented evidence. Before an authorized
capture or repair writes, follow [operations](../../wiki-maintainer/references/operations.md).
The [evidence policy](../../wiki-maintainer/references/evidence.md) owns restrictions,
raw immutability and the obligations for using captured material. For a vault other than the
default, name it on every command below, as in [name the vault](initialization.md#name-the-vault).

## HTML and supplied pages

The public HTML helper is `node "<absolute-plugin-root>/scripts/clip.mjs"`.
It uses the pinned extraction dependencies; a source checkout installs them with
`npm ci`, while installed plugins acquire the pinned versions through npm exec
when local dependencies are absent. Installation is a setup action, not a search
or diagnostic side effect. See the [public extraction contract](../../../docs/clipping-fidelity.md)
for extractor behavior, and [web capture](../../wiki-researcher/references/clip-html.md)
for the authorized write procedure and every mechanism named below.

The helper tries the served HTML first. When that fetch fails or the text is under
100 words it asks the site for the page's Markdown twin (`<page>.md.txt`, `<page>.md`, a
"View page in Markdown" link, then the site's `/llms.txt`), and only then renders the
page in a browser. `--expand` goes straight to the browser. A plain-text capture, a
supplied file and a PDF URL whose fetch failed are not rendered. To check what the
render has:

```sh
node "<absolute-plugin-root>/scripts/doctor.mjs"
```

This only reads, and never downloads. Under `clip` it lists two optional rows, so a
missing one does not fail doctor: read the `clip` line and its `MISSING` entries.

| Row | Reports | If missing |
|---|---|---|
| `playwright-core` | `local`, or `on first use through npx` (npx is on `PATH` and will fetch the pinned version at the first render), or missing | Install npm so `npx` can fetch it; in a source checkout run `npm ci` |
| `browser` | The Chrome or Edge executable found | Install Chrome or Edge, or set `WIKI_MASTER_BROWSER` to a browser executable |

The first render through npx downloads `playwright-core`, so it needs network and npm. A render
that cannot finish through npx, for example offline, is reported as `unavailable` with npm's first
error line; with no browser the result is `unavailable` and npx is not tried. A rendered
clipping shows as `extraction: rendered` in its frontmatter. Its `clipped:` line looks like any other.

On a thin page, only a browser that read the page can justify a 180-day decline:

| Render result | Clip outcome |
|---|---|
| `ok`, at least 100 words | Clipped with `extraction: rendered` |
| `ok`, still thin, and a made-up address on the same site reads differently | Declined and queued as `thin` or `wrong-node` |
| `ok`, still thin, and the site serves the same text for a made-up address | Queued as `thin` with a reason starting `unverified URL:`; not declined |
| `unavailable` (no `playwright-core` or browser) | Queued as `thin` or `wrong-node`, not declined |
| `blocked` or `failed` (a timeout is `failed`) | Queued as `thin` or `wrong-node` with the render's reason, not declined. The line ends `triage recorded; not declined — browser render did not read the page (<reason>)` |
| `gone` | Queued as `gone`, not declined |

Text the helper judges a short real article (an `<article>` or `<main>` of at
least 50 words, or three headings over at least 20 words) still clips as a brief
article. A failed fetch whose render also fails is printed as `clip failed` or
`page gone` and queued, not declined.

Interpret an actual result before choosing a recovery:

| Observation | Diagnosis and next action |
|---|---|
| `thin content` or `possible extraction mismatch` with `decline + triage recorded` | A browser read the page and it is still thin, so later clips skip it for 180 days. A saved page can supply the content: use the capture route's `--from-file` with `--override-decline`. |
| `thin content` or `possible extraction mismatch` with `not declined — browser render unavailable` | Nothing was learned about the page. Run doctor and report what is missing. Once the browser is present a retry can recover it; otherwise use a saved page. |
| `thin content` or `possible extraction mismatch` with `not declined — browser render did not read the page (<reason>)` | The reason is about one attempt. Report it; a retry can still recover the page, or use a saved page. |
| `thin content` with `not declined — unverified URL: the site serves this text for any address` | The site answers every address with this shell, so the read says nothing about this URL and no decline was recorded. Check the address spelling against the site; otherwise use a saved page. A later successful clip closes the row. |
| `thin content` with `not declined — an --expand read` | The browser opened the page and it is still thin. Queued for a person, not declined. |
| `landing page: the document is at <url>; run clip-pdf.mjs "<url>"` | The clipping is a short page that points at one PDF. Clip the document with `clip-pdf.mjs "<url>"` within capture scope; the landing clipping is not evidence for the document's contents. |
| `note: page has N tab controls this clip did not open; use --recapture --expand` | The served HTML shows N tabs with no panel (one tab reads `1 tab control`). A browser is needed: run `--recapture --expand` (doctor first). |
| `note: extracted N of about M visible words` | The first read kept under a fifth of the page and no retry recovered it. It may be harmless (a short article beside a long comment thread). Compare the clipping with the page before relying on it. If it is short, try `clip.mjs "<url>" --recapture --expand`, then `--from-file` with a saved page. `--find-twin` answers `no probe (...)` unless the page's `fidelity` is `partial`. |
| `note: extraction retry kept (<value>): ...` | The first read lost most of the page and a changed copy of the markup recovered it; the clipping carries `extraction-retry`. |
| `refused: the address carries a username or password` or `... a secret in its query (<name>)` | Exit 2 with nothing written or queued. Remove the secret from the address; for a page behind it, save the page and use `--from-file` under the address without the secret. |
| `login, consent or age-gate page` | Queued as `wrong-node`, not declined. A signed-in saved page can supply the actual content; do not call a wall a verdict on the source. |
| `clip failed`, `failed` or `blocked` row (for example 403, network, timeout) | Queued, not declined. Report it; a retry needs capture scope and evidence that retrying is useful. If the line says the browser render is unavailable, run doctor. If the browser could not read the page, use a saved page. |
| `clip failed — this url serves a PDF` | An `attention` row, not declined. Run the [PDF route](../../wiki-researcher/references/clip-pdf.md) on the address: `clip-pdf.mjs "<url>"`. |
| `page gone`, `gone` row | A dead/404/error-page source needs a replacement source or dropped claim; do not label it a retryable `failed` row. |
| `clash` | Nothing was written; an attention row names the occupied path. Read that file's `source:` and choose a distinct `--slug <name>` within capture scope, or leave it for triage. A clash is not a same-URL duplicate; a second same-day recapture is numbered, not a clash. |
| `duplicate` / `unchanged` | No new content was written. A new dated capture of changed HTML uses `--recapture`; this flag does not exist on document, GitHub or Confluence clippers. |
| Partial fidelity warning | Inspect the source items the checker says were lost; a clipping's length does not establish completeness. Its `quality` is credibility, not extraction fidelity. With `expand-coverage`, a count such as `2 of 3 tables reached the text` names what an opened page showed and the text lacks, and `truncated=true` means the click or time limit stopped the expansion. |

A hand-clipped file under `raw/clippings/` goes through `adopt-clipping.mjs` (see the capture route).

For a supplied page, verify it is the intended page before capture. Accepted
extensions are `.md`, `.markdown`, `.txt`, `.html` and `.htm`; an empty path,
missing file, directory or other extension exits 2 before writing or queuing.
Files over 1 MiB, binary/NUL data or sufficiently undecodable text are refused
and queued as attention. Thin supplied pages are queued, never automatically
declined; a short structured page can pass the helper's heading/word exception.
There is no override for the login/consent/age-gate classifier. It cannot judge a
title with no word of at least five letters (such as a bare numeric URL suffix),
so a successful run is not proof that a supplied file is the real page.

An `extraction: manual` clipping is refused by `apply-reclips.mjs`, not counted
as a failed repair. To refresh it, obtain the newly saved page and use the
capture route's `--from-file <path> --recapture`. Never replace its supplied
body with a fresh unauthenticated fetch. `apply-reclips.mjs` refuses a clipping
with `expand-coverage` or `extraction: plaintext-twin` the same way, because its read
would replace text a person or a better route produced: refresh them with
`clip.mjs <url> --recapture --expand` and `clip.mjs <url> --recapture`. A raw text URL is
handled as plaintext; HTML repair does not re-read plaintext clippings. See
[re-clipping](../../../docs/reclipping.md) for the supported repair API.

## PDF

Run the read-only toolchain probe before a PDF capture:

```sh
node "<absolute-plugin-root>/scripts/clip-pdf.mjs" --doctor
```

In the corrected source, doctor separates its legacy dependency-only summary
from exercised rendering capabilities. It creates a small synthetic one-page
PDF in an owned temporary directory and tests the actual OCR raster command
(`pdftoppm -png -r 300`) and figure raster command
(`pdftoppm -r 200 -png -f 1 -l 1 -singlefile`) in separate output directories.
A `passed` raster result requires exit zero and a newly generated PNG with a
valid signature/IHDR header and positive dimensions. This checks the
representative contract, not arbitrary PDFs or a full PNG pixel decode.

Read each outcome: `passed`, `missing`, `unusable`, `timeout`, `invalid-output`
or `not-exercised`. The report includes invocation arguments, exit/signal and
either an established executable identity or an explicit unresolved-identity
limit. A nonzero exit is `unusable` with one exception: Xpdf's `pdftotext`
exits 99 after printing its help or version banner, so `pdftotext -h` and
`pdftotext -v` with exit 99 and an Xpdf banner report `passed; exit=99` with
the note `exit 99 is normal for Xpdf help and version output` (`diagnosePdf` result `outcome:
"passed"` plus `note`). Exit 99 from another flag or tool, or without an Xpdf
banner, stays `unusable`. Version/help results are separate from rendering.
In particular, a successful raster probe does not override the unchanged
runtime OCR version
gate: both `pdftoppm -v` and `tesseract --version` must succeed. Tesseract
availability does not test recognition accuracy; advertised `-table` support
does not verify table rows; figure rasterization does not test automatic figure
selection or page counting.

Doctor bounds each subprocess to five seconds and the combined subprocess time
to thirty seconds, including version/help/resolver and termination helpers. It
reserves half of each probe deadline for termination, so a converter may be
stopped after about 2.5 seconds under the default five-second cap; the cap does
not promise five seconds of converter execution or hard real-time scheduling. It
bounds captured output, stops timed-out converter processes and traceable
descendants, then removes its owned temporary files. This is native-converter
supervision, not OS containment for programs that deliberately daemonize,
detach/reparent children and exit. Unconfirmed termination retains the fixture
and stops later probes; cleanup/termination failures are reported with a nonzero
CLI exit. A completed diagnostic still exits zero when tools or capabilities are
unavailable. It writes no vault content and installs nothing.

The installed 0.89.0 release and earlier versions only probe tool presence;
their “OK” listings do not establish either render contract. These corrected
source instructions do not imply that an installed cache has been updated.

The clipper also reports degraded prerequisites on each capture. Missing `pdftotext`
is fatal. Xpdf is preferred because its `-table` mode preserves reconstructed
row pairings; poppler lacks it. Missing `pdftoppm` or Tesseract prevents OCR of
scanned pages. An `ocr-unavailable` result means the PDF was not read and creates
no decline; a `thin` result means extraction and available OCR could not recover
useful content and records a decline. Do not treat those outcomes alike.

A PDF clipped by address (`clip-pdf.mjs "<url>"`) can also end `download failed: ...`:
the server answered an error status, the response did not start with `%PDF-` (often an HTML
page), no data arrived for 60 seconds, the disk was full, or the fetch itself failed. It
queues a `failed` row and records no decline. A retry needs capture scope; for a document
behind a login, download the file with the user's own credentials and run `clip-pdf.mjs` on it.
An address with a username, password or secret query parameter, or a scheme other than
http or https, exits 2 before anything is written.

Normal clipping invokes tools through Node's `execFileSync`; doctor uses bounded
asynchronous subprocesses. Use the bundled helper
instead of a Bash invocation that may resolve Windows executables incorrectly.
If an installation is authorized, the [Xpdf tools](https://www.xpdfreader.com/download.html)
provide `-table`; OCR needs `pdftoppm` and Tesseract. Do not install them merely
because a diagnostic request found them missing.

For figure capture, `pdftoppm` renders pages; `pdfimages`, `pdftocairo` and
`pdfinfo` support selection/probing. They are found on PATH or in the winget
poppler folder. Missing optional probes produce warnings and `auto` uses the
probes available. A successful text clip does not prove figures were captured.
The [PDF capture procedure](../../wiki-researcher/references/clip-pdf.md) owns
figure selection, caps, sidecars and hash checks.

Choose Xpdf for `pdftotext` while retaining compatible Poppler render/probe tools.
Prepending an entire Xpdf tools directory to PATH can also shadow Poppler's
`pdftoppm` and `pdfimages`. The figure helper requires `pdftoppm -png -singlefile`
and `pdfimages -list`; OCR also requires `pdftoppm -png`. Select only the intended
text converter, then verify the resolved render/probe tools support those flags.
Use the corrected doctor's separate raster outcomes to verify its two render
contracts. With older installed releases, retain a bounded representative render
check rather than relying on an “OK” tool listing. Neither route establishes OCR
accuracy, table fidelity or automatic figure-selection coverage.

### Wrong reading mode or garbled text

Inspect the extraction against the PDF. Reading order suits prose, two-column
papers and body-plus-margin layouts. Aligned table mode suits real tables;
using it on margin annotations can splice unrelated text into a body line.
Conversely, reading order can emit all keys followed by all values, losing row
pairings. Neither mode is correct merely because the output looks like prose.

For a bounded comparison, extract a couple of pages both ways using the resolved
converter through Node (replace the page numbers and converter path):

```sh
node -e "const {execFileSync}=require('node:child_process'); process.stdout.write(execFileSync(process.argv[1], ['-enc','UTF-8','-f','40','-l','41',process.argv[2],'-']));" "<absolute-pdftotext-path>" "<file.pdf>"
node -e "const {execFileSync}=require('node:child_process'); process.stdout.write(execFileSync(process.argv[1], ['-enc','UTF-8','-f','40','-l','41','-table',process.argv[2],'-']));" "<absolute-pdftotext-path>" "<file.pdf>"
```

The existing capture flags are `--mode=auto|reading-order|table`. An override
diverging from the detector warns and records `reading-order-forced` when
applicable. Invalid modes fail; forcing `table` without `-table` support is
refused, never silently downgraded. `--ocr` forces OCR for broken font layers;
`--ocr-lang=<code>` selects its language (default `eng`). Use an authorized
capture/repair route for the write, not a diagnostic run.

Read fidelity markers as limits: `table-flattened` lost the rows and cannot
support pairings; `tabular` reconstructed them; `ocr` has unverified recognized
words/numbers; `degraded` cannot support unverified verbatim spans. Reassessment
cannot prove OCR or table layout from characters and must not clear those floors.
For a read-only legacy inventory:

```sh
node "<absolute-plugin-root>/scripts/refresh-fidelity.mjs" --ocr-floor
node "<absolute-plugin-root>/scripts/refresh-fidelity.mjs" --inventory
```

`--ocr-floor --apply` is an authorized metadata repair, not diagnosis. It adds
the floor to old OCR captures; it does not verify their content. Broken-font
inventory only lists old captures newly detected as suspect. Actual repairs and
derived-claim review belong to [maintainer](../../wiki-maintainer/SKILL.md).

## Word

The [Word route](../../wiki-researcher/references/clip-docx.md) uses
`node "<absolute-plugin-root>/scripts/clip-docx.mjs"`. Probe pandoc with
`pandoc -v` in PowerShell, or invoke its resolved executable through Node on
Windows. A missing converter requires [pandoc installation](https://pandoc.org/installing.html)
within authorized setup scope; stop capture rather than inventing text.

A corrupt or password-protected document fails for manual handling. `thin`
does not distinguish a bad extraction from an intentionally brief worksheet:
open the original and inspect completeness before using the capture route's
`--allow-short`. Its normal floor is 100 words. Never use the override to push
through unreadable content. Pandoc's plain-text output loses table/figure
structure; clean Unicode does not establish faithful structure.

## PowerPoint

The [PowerPoint route](../../wiki-researcher/references/clip-pptx.md) uses
`node "<absolute-plugin-root>/scripts/clip-pptx.mjs"` and bundled Python glue.
Probe the same interpreters in order and stop at the first success:

```sh
python3 -c "import pptx"
python -c "import pptx"
py -c "import pptx"
```

On Windows `python3` may be a failing WindowsApps alias even when another
interpreter has python-pptx. Failure of that first probe alone proves nothing
about the library. If all fail, identify the interpreter that will run the
helper and report `<interpreter> -m pip install python-pptx` as the needed setup
action; installing into another interpreter will not fix it. Pandoc has no
PowerPoint input format; LibreOffice is not this helper's dependency.

Legacy binary `.ppt` is unsupported and must be converted to `.pptx` first.
Empty/corrupt/protected decks need manual handling. Extracted text, tables and
speaker notes omit design, images and rendered charts; inspect those limits
against the deck before describing the capture as complete.

## Spreadsheets

The [spreadsheet route](../../wiki-researcher/references/clip-xlsx.md) uses
`node "<absolute-plugin-root>/scripts/clip-xlsx.mjs"`. Probe both `soffice
--version` and `pandoc -v` through PowerShell or Node on Windows. The helper
invokes bare `soffice` through Node so PATHEXT selects the `.com` console shim;
the `.exe` GUI build can print nothing. Do not route this through Bash.
Missing [LibreOffice](https://www.libreoffice.org/download/) is a fatal setup
defect; a corrupt/protected workbook returns `failed` and permits a batch to
continue. Report which occurred.

Never convert a workbook to PDF to work around missing converters: it can lose
the label/value pairing that is the content. The supported path renders every
sheet as a table, but formulas, merged cells, charts and multi-row headers can
lose meaning. Verify labels remain attached to values against the workbook.
A `thin` result (under 100 words) records a decline. There is no `--allow-short`
flag here; report the limit and seek a supported source/capture decision rather
than claiming the tiny workbook succeeded or retyping its cells into raw.

## GitHub repositories

```sh
node "<absolute-plugin-root>/scripts/clip-gh.mjs" --doctor
```

This checks the `gh` CLI and authentication. Capture uses the existing `gh auth`
session through `gh repo clone`, including private repos already accessible to
that account. Missing access, a bad repository name and network failure are
capture failures, not permission to change credentials or fabricate files.
See the [GitHub route](../../wiki-researcher/references/clip-gh.md) for per-file
and digest capture.

`too-many-files` occurs only with `--force-full`: no content was written.
Within requested capture scope, increase `--max-files` deliberately or remove
`--force-full` to let digest mode bound output. A changed digest grouping can
prune obsolete listings; inspect reported paths and verify listing totals
against the manifest. Do not mistake a listing for captured file contents.
Unsafe or doubled legacy names require the maintainer's
[citation-preserving repair](../../wiki-maintainer/references/maintenance.md),
not a hand rename during diagnosis.

## Confluence

```sh
node "<absolute-plugin-root>/scripts/clip-confluence.mjs" --doctor
```

The optional `confluencer` plugin supplies authenticated `page.mjs`; wiki-master
does not implement another client. Discovery searches Copilot plugin installs
for the external confluencer helper `page.mjs` in that plugin's `scripts` directory. For another host or development checkout,
set `WIKI_MASTER_CONFLUENCER_SCRIPTS` to its absolute scripts directory for the
command's scope and restore the prior value afterwards. The doctor reports
discovery and delegates auth/config/connectivity checks to confluencer's own
`doctor.mjs`; do not print or independently handle its credentials.

`confluencer-missing` reports the paths searched and override, with no clipping.
If found but failing, the helper surfaces the real `page.mjs` stderr and doctor
pointer. Report bad ID/auth/network failures accurately. An anonymous HTML fetch
usually sees a login wall or SPA shell and cannot replace authenticated access.

Within authorized setup scope, install/configure confluencer if desired. A
user-supplied export can instead go through the matching Word or PDF capture
route, with an explicit table-fidelity caveat. Do not hand-write raw Markdown.
PDF export is a double lossy conversion and does not repair server-side Jira
macro errors. The native [Confluence capture route](../../wiki-researcher/references/clip-confluence.md)
retains the page's own URL, version and update metadata.

Confluence's stable URL dedup does not notice a newer page version: a re-clip can
return `duplicate (already clipped)`. No version-aware dedup or `--recapture`
flag is supplied for this helper. Report that limitation; never remove old raw
evidence or invent a flag to bypass it.
