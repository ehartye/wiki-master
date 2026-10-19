# Vault access and host commands

Resolve the plugin root from the installed `SKILL.md` location, not the current
working directory: its containing skill folder's `../../` is the plugin root.
Resolve `WIKI_MASTER_VAULT` (default `~/.wiki-master-vault`) and verify the expected
vault layout. Read local `AGENTS.md` and schema before edits. A known root and
filesystem access are sufficient for the supported operations below; do not ask
the user to restart Obsidian as a prerequisite for all work.

## Choose the supported channel

| Operation | Channel and fallback |
|---|---|
| Read a Markdown page or source | CLI `read path=...`, or read its exact path under the known vault root. |
| Search | Prefer `search.mjs` and inspect its diagnostics. If a channel fails, use available results plus bounded filesystem `rg` over `wiki/` and `moc/`; include `raw/clippings/` only for evidence lookup. State missing channels. |
| Health, evidence routes, identity, relationships, drift coverage | Bundled filesystem helpers work without Obsidian. Do not gate them on `assertRunning`. Drift embeddings still require their backend. |
| Factual freshness report | `stale.mjs` may use CLI discovery or scoped filesystem fallback. Preserve missing-review and coverage diagnostics. |
| Ordinary Markdown creation/editing | Use exact-path filesystem edits even when the CLI is healthy, with the same operation, evidence, schema and validation contract. Read current content before editing; preserve unrelated changes. Never pass a whole note body through `content=`. |
| Small typed property or app actions | Use the guarded CLI entry point below; filesystem property edits remain available with schema validation. |
| Opening a note in the UI, executing an Obsidian/plugin command, app state, live Bases queries | Requires working Obsidian CLI. Report the specific unavailable action; continue independent file work. Do not pretend a filesystem approximation executed an app action. |

For CLI calls use `node "<absolute-plugin-root>/scripts/obsidian.mjs" <command> ...`
or the bundled `scripts/lib/vault.mjs` API. These share an OS-managed lock across
agent processes, vaults and plugin copies for the same user. Do not launch native
`obsidian` directly or bypass a busy guard; other tools' raw calls are not protected.
The guard waits up to 10 seconds for a turn, then fails without sending a request.
Command execution has its own 10-second default timeout. Each request is limited
to a conservative 2,048-byte UTF-8 JSON envelope and rejects physical CR/LF/NUL.
This policy is not Obsidian's documented maximum. If rejected before sending,
use filesystem Markdown editing or narrow the read query; do not split a note
into many CLI writes or disable the guard. No fallback performs writes implicitly.
After an unavailable CLI or timeout, choose the supported fallback once; never
loop waiting for the app. **A timed-out mutation has an uncertain outcome.** Read
the exact target and check the intended effect before retrying or switching to
filesystem writes. An exit or timeout alone does not establish that nothing ran.
OS cleanup releases a lock after process death, but cannot prove a surviving CLI
child or an already-submitted Obsidian mutation finished. Inspect uncertain targets.

Validate resolved paths stay under the known root. Restrict searches to explicit
content directories; exclude `.recycle/`, dot folders, dependency trees and binary
originals. Do not recursively enumerate the entire user profile or scan a recycled
topic. Raw bodies remain immutable even during fallback. If target content changed
since it was read, reconcile it before writing; do not overwrite concurrent work.

## Shell portability

Examples elsewhere use `node "<absolute-plugin-root>/scripts/health.mjs"` as command
notation. Replace the placeholder with the actual installed absolute path before
execution, and set the vault for the operation's scope. Do not execute literal
angle-bracket placeholders or assume a relative `scripts/` path means the plugin.

PowerShell (restore any prior environment value):

```powershell
$wikiPriorVault = $env:WIKI_MASTER_VAULT
try {
  $env:WIKI_MASTER_VAULT = 'C:/absolute/path/to/vault'
  node 'C:/absolute/installed/plugin/scripts/health.mjs'
  if ($LASTEXITCODE -ne 0) { throw 'Wiki health failed' }
} finally {
  $env:WIKI_MASTER_VAULT = $wikiPriorVault
}
```

POSIX shell (one command's environment only):

```sh
WIKI_MASTER_VAULT='/absolute/path/to/vault' node '/absolute/installed/plugin/scripts/health.mjs'
```

On Windows, use PowerShell or the Node wrapper for Obsidian; Git Bash can select
the GUI executable instead of `Obsidian.com` and return misleading empty output.
These reporting examples are read-only: do not open an operation or rebuild the
index merely to answer a question.
