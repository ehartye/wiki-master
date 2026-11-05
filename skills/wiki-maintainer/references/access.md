# Vault access and host commands

Resolve the plugin root from the installed `SKILL.md` location, not the current
working directory: its containing skill folder's `../../` is the plugin root.
From a file in a skill's `references/` folder, use `../../../` instead.
Resolve and quote absolute helper paths before running commands. Treat
`$ARGUMENTS` as the user's request when the host has not substituted it. A linked
skill or reference can be read directly when the host has no skill loader; shared
policy does not require loading the maintenance-role entry point.
Resolve `WIKI_MASTER_VAULT` (default `~/.wiki-master-vault`; with `WIKI_MASTER_REQUIRE_VAULT=1` set and no vault named, a script stops with exit 2 instead of using the default) and inspect only the expected
vault paths needed by the task. Read local `AGENTS.md` and schema before edits. A known root and
filesystem access are sufficient for the reads and edits below; do not ask the user
to restart Obsidian as a prerequisite for all work. The `refresh-index.mjs` that ends
an authoring task does need Obsidian and Ollama, and [completion](operations.md) says
what to do when it stops.

## Layout and read scope

`raw/clippings/` holds captured evidence; `wiki/{sources,entities,concepts,syntheses,authored}/`
holds maintained pages; `moc/` holds navigational maps; `log/` holds one file per
logged task. Never read, cite or count `.recycle/`; only purge owns it. Reads write no
log and refresh nothing. Before any authorized write, read [completion](operations.md);
before quoting or synthesizing, read [evidence](evidence.md).

Prefer bounded search and relevant MOCs to the generated catalog. Search
diagnostics describe coverage, not relevance: a stale index can omit useful pages.
Read current passages and disclose weak or failed channels. Index freshness is
distinct from factual review dates.

## Choose the supported channel

| Task | Channel and fallback |
|---|---|
| Read a Markdown page or source | CLI `read path=...`, or read its exact path under the known vault root. |
| Search | Prefer `search.mjs` and inspect its diagnostics. If a channel fails, use available results plus bounded filesystem `rg` over `wiki/` and `moc/`; include `raw/clippings/` only for evidence lookup. State missing channels. |
| Health, evidence routes, identity, relationships, drift coverage | Bundled filesystem helpers work without Obsidian. Do not gate them on `assertRunning`. Drift embeddings still require their backend. |
| Factual freshness report | `stale.mjs` may use CLI discovery or scoped filesystem fallback. Preserve missing-review and coverage diagnostics. |
| Ordinary Markdown creation/editing | Use exact-path filesystem edits even when the CLI is healthy, with the same completion, evidence, schema and validation contract. Read current content before editing, and keep your edits to what your task needs. Never pass a whole note body through `content=`. |
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
For unavailable, rejected or uncertain requests, follow the direct
[app diagnosis](../../wiki-setup/references/app-access.md#failure-refusal-and-uncertain-mutation).
A timed-out mutation has an uncertain outcome: inspect the exact target before
retrying or switching channels. Never claim a filesystem fallback executed an
app-only action. No fallback implicitly authorizes a write.

Validate resolved paths stay under the known root. Restrict searches to explicit
content directories; exclude `.recycle/`, dot folders, dependency trees and binary
originals. Do not recursively enumerate the entire user profile or scan a recycled
topic. Raw bodies remain immutable even during fallback. If target content changed
since it was read, reconcile it before writing; do not overwrite concurrent work.

## Shell portability

Examples elsewhere use `node "<absolute-plugin-root>/scripts/health.mjs"` as command
notation. Replace the placeholder with the actual installed absolute path before
execution, and set the vault for the task's scope. Do not execute literal
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

For Windows redirector and empty-output diagnosis, read
[app access](../../wiki-setup/references/app-access.md#windows-invocation) only
when needed. These reporting examples are read-only: no log or refresh is needed to
answer a question.
