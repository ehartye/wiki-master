---
name: wiki-triage
description: Put links that need a human decision in front of the user — clip failures, fidelity flags, declines nearing expiry, and the ingest backlog — in a browser surface they can disposition. Use whenever a run produces sources the pipeline could not resolve on its own, or when the user asks what needs their attention.
argument-hint: "[blank to show everything, or a kind: failed | thin | fidelity | expiring | backlog]"
---

> **Host portability (Claude Code, Copilot CLI, Codex):** Resolve bundled
> `scripts/` and `templates/` paths from this skill's installed directory:
> `../../` is the plugin root. Use quoted absolute paths when running helpers;
> do not resolve them from the current workspace or depend on plugin-root shell
> variables. For sibling skills, read `../<skill-name>/SKILL.md` if the host has
> no skill-loading tool. References such as `/wiki-health` mean that skill's
> workflow; in Codex, select the skill or ask for it by name. Treat `$ARGUMENTS`
> as the user's request when the host does not substitute it.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location, the provenance/`raw/`-immutability
> guardrails, and the shared metrics (the ingest backlog is one) these steps assume.
> Skip the load if you arrived here mid-run from a wiki-master skill that already pulled it in.

## What this is for
Some links cannot be resolved by the pipeline: a 403, a paywalled SPA, an extraction that
landed on the wrong node, a PDF whose fonts decoded to gibberish. Printing those to the
terminal loses them the moment the scrollback scrolls. **Anything that needs the user's
eyes on a link belongs here**, not in console output.

## Show the queue
```bash
node ../../scripts/triage.mjs
```
Prints one line of JSON: `{"type":"triage-ready","link":"http://localhost:PORT/?t=…","url":…}`
with counts. **Give the user `link`, not `url`.** Every route is behind a session token, and
`link` carries it — opening it once is the entire login, after which the browser holds an
HttpOnly cookie for 30 days. `url` is the clean form, for liveness checks and logs; on its
own it renders a 401. Hand over the link with a one-line summary of what is waiting, then
**end your turn**. They disposition in the browser; you read the results next turn.

The server reuses one session directory per vault (`.wiki-master/triage-ui/`), so re-running
refreshes the open page rather than starting a second server. It idles out after 30 minutes.

### Triaging from another machine
```bash
node ../../scripts/triage.mjs --remote
```
Default is loopback-only. `--remote` binds every interface and advertises a reachable
address instead of `0.0.0.0`, which no browser will open. Everything else is unchanged:
the same link, the same token, and uploads still land on the **server's** disk, which is
where `apply-reclips` will look for them.

- **The token is re-printable, never memorized.** It lives in
  `.wiki-master/triage-ui/state/token` (gitignored, machine-local, `0600`) and is stable
  across restarts. If the user loses the link, read the file and rebuild it — do not
  regenerate it, or you invalidate the link they already have.
- **To rotate:** delete that file and re-run. Every existing session cookie stops working.
- **The port is remembered too** (`state/port`), because the cookie is scoped to
  `host:port` — a new port would silently force a fresh login every run.
- **Over a plain LAN the token crosses the wire in cleartext.** On a tailnet (WireGuard)
  or behind an HTTPS front that is fine; on an untrusted network, say so rather than
  assuming the user has thought about it.
- `WM_TRIAGE_URL_HOST` overrides the advertised hostname when the derived IP is not the
  one the user reaches the machine on.

### Grouping by research topic
Rows are grouped by **kind** (kind decides which actions a row offers) and filtered by
**research topic** — the argument the user gave `/wiki-discover`. A topic bar above the
groups scopes the whole queue to one run, because that is how these decisions are actually
made: "deal with what the BPD sweep left behind", not "deal with all fidelity flags".

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
