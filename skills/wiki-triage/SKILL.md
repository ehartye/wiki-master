---
name: wiki-triage
description: Put links that need a human decision in front of the user — clip failures, fidelity flags, declines nearing expiry, and the ingest backlog — in a browser surface they can disposition. Use whenever a run produces sources the pipeline could not resolve on its own, or when the user asks what needs their attention.
argument-hint: "[blank to show everything, or a kind: failed | thin | fidelity | expiring | backlog]"
---

> **Scripts:** run from the plugin's `scripts/` directory — resolve `../../scripts/triage.mjs`
> relative to this skill's own directory (the plugin root is the parent of `skills/`). No
> plugin-root env var is set under Copilot CLI, so use this relative path, not
> `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

## What this is for
Some links cannot be resolved by the pipeline: a 403, a paywalled SPA, an extraction that
landed on the wrong node, a PDF whose fonts decoded to gibberish. Printing those to the
terminal loses them the moment the scrollback scrolls. **Anything that needs the user's
eyes on a link belongs here**, not in console output.

## Show the queue
```bash
node ../../scripts/triage.mjs
```
Prints one line of JSON: `{"type":"triage-ready","url":"http://localhost:PORT",...}` with
counts. Give the user the URL and a one-line summary of what is waiting — then **end your
turn**. They disposition in the browser; you read the results next turn.

The server reuses one session directory per vault (`.wiki-master/triage-ui/`), so re-running
refreshes the open page rather than starting a second server. It idles out after 30 minutes.

## Read dispositions back
Dispositions append to `<vault>/.wiki-master/triage.jsonl` as
`{"t":"disposition","url":…,"kind":…,"disposition":…}`. Fold the log to get current state:

```js
import { loadIssueLog, openIssues } from '../../scripts/lib/triage.mjs';
const stillOpen = openIssues(loadIssueLog(vaultPath));
```

Then act on what the user chose:

| disposition | what you do |
|---|---|
| `clipped-by-hand` | confirm the clipping exists in `raw/clippings/`; if not, say so |
| `retry` | re-run `clip.mjs` for that URL — a transient failure may have cleared |
| `declined` | `node ../../scripts/clip.mjs "<url>" --decline="<reason>"` |
| `reconsider` | the decline is expiring and they want it re-evaluated — treat as a discovery candidate |
| `keep-declined` | re-record the decline to reset its TTL |
| `acceptable` | fidelity is good enough; no action beyond noting it |
| `reclip` | re-clip via the right path (`clip-pdf` / `clip-docx`) rather than the HTML clipper |
| `quarantine` | do not cite this source; note the restriction on any page that already does |
| `ingest` | run `/wiki-ingest` scoped to that source |
| `ignore` / `skip` | no action; the disposition itself is the record |

## Queue something yourself
When a run surfaces a link only the user can settle, queue it rather than burying it in prose:

```js
import { recordIssue } from '../../scripts/lib/triage.mjs';
recordIssue(vaultPath, { url, kind: 'attention', reason: 'why this needs a human' });
```

Kinds: `failed` · `thin` · `wrong-node` · `blocked` · `fidelity` · `attention`.

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
