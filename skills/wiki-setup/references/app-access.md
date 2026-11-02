# App access and session diagnosis

Use [access](../../wiki-maintainer/references/access.md) for the canonical root,
supported channels and guarded-action policy. The app is needed for app actions;
filesystem reads, checks and ordinary Markdown edits work from the known vault
root. Diagnosis does not authorize a content repair or an app mutation.

## Resolve the requested app surface

1. Resolve `WIKI_MASTER_VAULT` (default `~/.wiki-master-vault`) without scanning
   the user profile. Resolve the app name from `WIKI_MASTER_VAULT_NAME` or the
   vault folder basename. These are distinct values.
2. For an app-only action, use the guarded helper at its installed absolute path:
   `node "<absolute-plugin-root>/scripts/obsidian.mjs" vault info=path` can confirm
   the responding app's vault root. The known filesystem root does not depend
   on this probe. `vaults` lists registered vaults when app registration needs checking.
3. Read `node "<absolute-plugin-root>/scripts/obsidian.mjs" help <command>` when
   a parameter seems unsupported; the live command's help outranks a stale
   syntax description. The [native action reference](../../wiki-maintainer/references/obsidian-cli.md)
   owns supported actions and their authorization workflow.

Node.js 20.8 or newer is required by the guarded transport. App registration is
separate from filesystem initialization: open the intended folder as an
Obsidian vault and verify it through the helper when that setup is requested.
A successful filesystem health report does not prove app access.

## Windows invocation

Never call bare `obsidian` from Git Bash. Obsidian's `.com` terminal redirector
connects stdin/stdout to the GUI app. PowerShell and Node's `execFileSync` use
PATHEXT ordering to select it; Git Bash can select `.exe`, print nothing and
exit 0. Use `node "<absolute-plugin-root>/scripts/obsidian.mjs"` through the
supported host. A GUI process exiting successfully is not a valid empty result.
The guard is part of the supported access path; do not bypass it with a direct
native call even when diagnosing the redirector.

## Empty output: one lazy canary

Do not preflight every ordinary app read. A command returning results has
already established a live backend for that session. Only when an empty result
is about to decide something (such as no backlinks or skipping a page), and
the session has not yet established liveness, run:

```sh
node "<absolute-plugin-root>/scripts/obsidian.mjs" search query="the" total
```

A numeric response establishes liveness; trust that empty and later empties
without repeating the probe. An empty canary is unavailable backend coverage,
not a count of zero. Obsidian provides no documented no-results exit contract.
Do not infer an index rebuild from empty output. A stopped-app failure can
explicitly say the CLI cannot find Obsidian; report the observed failure rather
than promising the command will launch it.

## Failure, refusal and uncertain mutation

Keep the exact diagnostic and distinguish what was sent:

| Result | Next action |
|---|---|
| `CLI_REQUEST`, `CLI_BUSY`, `CLI_LOCK` | Request was not sent. Narrow an oversized read or use the supported filesystem channel. Do not disable the guard or split a note into repeated CLI writes. |
| App unavailable | Report which app-only action could not run. Continue independent filesystem work; do not loop waiting or require an app restart for it. |
| Command timeout or worker failure | A mutation may have run. Read the exact target and reconcile the intended effect before retrying or switching to filesystem editing. An app-only effect cannot be claimed from a filesystem approximation. |
| Process death released the guard | This does not prove its child or submitted app mutation finished. Inspect the uncertain target as above. |

The wrapper never automatically retries. Within one Node process, await
asynchronous CLI work before using the synchronous adapter so the event loop
can release its gate. Existing older callers or direct native commands are not
protected by updating this plugin; the guard is not machine-wide interception.
See the [public transport contract](../../../docs/cli-transport-guards.md) for
the exact enforced request and wait limits. Keep the existing operation and use
[operation recovery](operation-recovery.md) if a requested write was interrupted.

## Triage UI reachability and session recovery

The [triage workflow](../../wiki-maintainer/references/triage.md) owns showing
the queue and applying the user's dispositions. The helper returns a tokenized
`link` and a clean `url`: give the user `link`; opening `url` alone returns 401.
The browser then uses an HttpOnly cookie lasting 30 days. Starting the queue
creates local session state, not tracked content; it does not authorize applying
dispositions.

The per-vault session directory is `.wiki-master/triage-ui/`; rerunning refreshes
the existing server instead of creating another, and it idles out after 30
minutes. For a lost link, reuse the token in `state/token` (gitignored,
machine-local, mode `0600`) and remembered `state/port`; do not rotate them as a
routine fix. The stable port avoids invalidating the host/port cookie scope.
Only for an explicitly requested rotation, remove that exact token file and
rerun the triage helper; all existing cookies then stop working.

Remote triage uses the requested workflow's `--remote` option: it binds every
interface and advertises a reachable address rather than `0.0.0.0`. Uploads
remain on the server's disk. `WM_TRIAGE_URL_HOST` overrides an advertised host
that the user's browser cannot reach; change it only within the setup scope.
Plain LAN transport exposes the token in cleartext; use a trusted tailnet or
HTTPS front when the network is untrusted. Never publish the token into logs,
source files or diagnostic transcripts.
