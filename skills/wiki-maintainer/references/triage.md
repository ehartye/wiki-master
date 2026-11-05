Read [access and host commands](access.md) before touching the vault. Also read for this task: [maintenance](maintenance.md).
Load the rest only when this run reaches it — [completion](operations.md) only when you apply reclips or otherwise write; presenting the queue creates only machine-local session state, not vault content.

## What this is for
Some links cannot be resolved by the pipeline: a 403, a paywalled SPA, an extraction that
landed on the wrong node, a PDF whose fonts decoded to gibberish. Printing those to the
terminal loses them the moment the scrollback scrolls. **Anything that needs the user's
eyes on a link belongs here**, not in console output.

## Show the queue
```bash
node "<absolute-plugin-root>/scripts/triage.mjs"
```
Prints one line of JSON: `{"type":"triage-ready","link":"http://localhost:PORT/?t=…","url":…}`
with counts. **Give the user `link`, not `url`.** Every route is behind a session token, and
`link` carries it — opening it once is the entire login, after which the browser holds an
HttpOnly cookie for 30 days. `url` is the clean form, for liveness checks and logs; on its
own it renders a 401. Hand over the link with a one-line summary of what is waiting, then
**end your turn**. They disposition in the browser; you read the results next turn.

### Triaging from another machine

When the user requests remote access, run:

```sh
node "<absolute-plugin-root>/scripts/triage.mjs" --remote
```

Return its token-bearing `link`. Uploads land on the server's disk, where
`apply-reclips` reads them. Setup owns [session/reachability recovery](../../wiki-setup/references/app-access.md#triage-ui-reachability-and-session-recovery), including binding, remembered port/token, lost links, rotation and network diagnostics. Do not rotate a session merely because its link was lost.

### Grouping by research topic
Rows are grouped by **kind** (kind decides which actions a row offers) and filtered by
**research topic** — the argument the user gave researcher discovery. A topic bar above the
groups scopes the whole queue to one run, because that is how these decisions are actually
made: "deal with what this topic research left behind", not "deal with all fidelity flags".

Topic comes from `topic:` in a clipping's frontmatter, or from the triage log for issues
that never became a file. **It is only ever recorded going forward** — clippings made
before this existed, and any clip made outside a research run, group under
**Unattributed**. Say so if the user asks why a group is large; do not present
Unattributed as a defect to fix.

When you summarize the queue for the user, lead with the topic breakdown when there is
more than one — it is the shape they will act on.

## Read dispositions back
Dispositions append to `<vault>/.wiki-master/triage.jsonl` as
`{"t":"disposition","url":…,"kind":…,"disposition":…}`. Fold the log to get current state:

```js
import { pathToFileURL } from 'node:url';
const { loadIssueLog, openIssues } = await import(pathToFileURL('<absolute-plugin-root>/scripts/lib/triage.mjs').href);
const stillOpen = openIssues(loadIssueLog(vaultPath));
```

Then act on what the user chose. Starting the UI alone needs no log or refresh.
Applying a disposition that changes vault content or pipeline state finishes through
[completion](operations.md). Handoffs such as ingest finish through their own procedure.

The dispositions a row offers depend on its kind. Clip failures (`failed`, `gone`,
`thin`, `wrong-node`, `blocked`) and `attention` rows offer `downloaded`,
`clipped-manually`, `retry`, `declined` and `ignore`. Fidelity rows offer
`acceptable`, `reclip`, `downloaded` and `quarantine`; an expiring decline offers
`keep-declined` and `reconsider`; the backlog offers `ingest` and `ignore`:

| disposition | what you do |
|---|---|
| `clipped-manually` (shown as "clipped by hand") | confirm a clipping for that URL exists in `raw/clippings/`; if not, say so |
| `downloaded` | the user saved the source file themselves ("browse — clip this file"): `apply-reclips.mjs` re-clips an existing clipping from it; for a URL with no clipping yet, run the matching document clipper on the saved file with `--source="<url>"` and the run's `--topic`. A URL still in the decline log is skipped; add `--override-decline` when the decline is an automatic thin or wrong-node one (the clipper lifts it only after the clipping is written), or `--supersede-decline="<why>"` for any other. For a web page the user saved from a signed-in browser (a login, consent or age-gate row), supply it with `node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --from-file <path> --topic="<topic>"`; `node "<absolute-plugin-root>/scripts/decline.mjs" supersede "<url>" --reason "<why>"` ends a decline without clipping. `apply-reclips.mjs` does not re-clip a clipping with `extraction: manual` (it lists it as refused, not as a failure): to refresh a supplied page, run `clip.mjs "<url>" --from-file <path> --recapture` |
| `retry` | re-run `clip.mjs` for that URL — a transient failure may have cleared |
| `declined` | `node "<absolute-plugin-root>/scripts/clip.mjs" "<url>" --decline="<reason>"` |
| `reconsider` | the decline is expiring and they want it re-evaluated — treat as a discovery candidate |
| `keep-declined` | re-record the decline to reset its TTL |
| `acceptable` | fidelity is good enough; no action beyond noting it |
| `reclip` | re-clip with the clipper that matches the file (`clip-pdf`, `clip-docx` or `clip-xlsx`) rather than the HTML clipper |
| `quarantine` | do not cite this source; note the restriction on any page that already does |
| `ingest` | follow [researcher ingestion](../../wiki-researcher/references/ingest.md) scoped to that source |
| `ignore` / `skip` | no action; the disposition itself is the record |

## Queue something yourself
When a run surfaces a link only the user can settle, queue it rather than burying it in prose:

```js
import { pathToFileURL } from 'node:url';
const { recordIssue } = await import(pathToFileURL('<absolute-plugin-root>/scripts/lib/triage.mjs').href);
recordIssue(vaultPath, { url, kind: 'attention', reason: 'why this needs a human', topic });
```

Pass `topic` whenever the item came out of a research run — it is what puts the row in
that run's group instead of Unattributed. Omit it when there is no run behind the item;
an invented topic is worse than none, because it files the row under a heading the user
has already worked through.

Kinds: `failed` · `gone` · `thin` · `wrong-node` · `blocked` · `fidelity` · `attention`.

`failed` and `gone` ask opposite things of the user: `failed` means *try this again, by
hand or from a signed-in browser*; `gone` means *stop trying — the page is a 404, or
redirects onto an error page, so find another source or drop the claim*. Never file a
dead link as `failed`; a row nobody can action is a row that stays in the queue forever.

## Guardrails
- **The log is append-only.** Never rewrite `triage.jsonl` — dispositions are appended and
  state is folded at read time. Two sessions share one vault routinely, and a
  read-modify-write on a shared file loses the other session's entries silently.
- **A recurrence reopens an issue.** A failure seen again after disposition is news, not
  history — do not suppress it.
- **Transient failures are not declines.** A 403 is a fact about one fetch; a decline is a
  judgment. Queuing a transient failure as a decline buries a recoverable source under a
  180-day TTL.
- **Report counts honestly.** The backlog group is capped for display and says so. Never
  present a truncated list as the whole set.
