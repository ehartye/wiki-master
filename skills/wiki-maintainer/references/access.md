# Vault access and host commands

Resolve the plugin root from the installed `SKILL.md` location, not the current
working directory: its containing skill folder's `../../` is the plugin root.
From a file in a skill's `references/` folder, use `../../../` instead.
Resolve and quote absolute helper paths before running commands. Treat
`$ARGUMENTS` as the user's request when the host has not substituted it. A linked
skill or reference can be read directly when the host has no skill loader; shared
policy does not require loading the maintenance-role entry point.
Resolve `context.mjs --purpose documentation|research|maintenance --json` with the
task's actual purpose (choose one value, not the literal alternatives). Add
`--repo "<repository>"` when supplied; otherwise discovery uses
`WIKI_MASTER_PROJECT_ROOT`, then cwd. Context discovery is read-only and may run
before vault instructions are known. Before the first content helper, read the
resolved root's actual `AGENTS.md`, `VAULT.md` and schema if present. Research lookup
reads each available searched root's instructions. Inspect only expected paths;
never infer instructions from helper output. Without registry or route overrides,
`WIKI_MASTER_VAULT` (otherwise `~/.wiki-master-vault`) retains legacy behavior.
`WIKI_MASTER_REQUIRE_VAULT=1` rejects implicit home fallback; a registry selection
is explicit. Legacy roots without descriptors are reported without creating one.
A known root and
filesystem access are sufficient for the reads and edits below; do not ask the user
to restart Obsidian as a prerequisite for all work. The `refresh-index.mjs` that ends
an authoring task does need Obsidian and Ollama, and [completion](operations.md) says
what to do when it stops.

## Request binding

Read [routing](../../../docs/multi-vault.md) for independent defaults and worktrees.
Configured root/name variables are assertions, not overrides. Conflicts stop before
mutation; use [setup's transition](../../wiki-setup/references/routing.md#legacy-environment-transition)
for stale settings, never silently drop a deliberate conflict.

Resolve the role first. Several research destinations require one question at request
start unless the user already supplied the answer. `--select` belongs to
`context.mjs`; helpers use `WIKI_MASTER_VAULT_ID`. Keep registry, repository and
chosen ID bound for capture, validation, log and refresh. Maintenance selection
cannot redirect a documentation or research helper. Direct filesystem authoring
uses the context's canonical root/project path; helper routing is not an OS sandbox.

PowerShell example after resolving the request (replace all placeholders):

```powershell
$wikiKeys = @('WIKI_MASTER_CONFIG', 'WIKI_MASTER_PROJECT_ROOT', 'WIKI_MASTER_VAULT_ID', 'WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_NAME')
$wikiPrior = @{}
foreach ($wikiKey in $wikiKeys) { $wikiPrior[$wikiKey] = [Environment]::GetEnvironmentVariable($wikiKey, 'Process') }
try {
  $env:WIKI_MASTER_CONFIG = '<absolute-registry-file>'
  $env:WIKI_MASTER_PROJECT_ROOT = '<absolute-repository>'
  $env:WIKI_MASTER_VAULT_ID = '<selected-id>'
  # Use the verified context target, never a guessed root or selector.
  $env:WIKI_MASTER_VAULT = '<selected-canonical-root>'
  $env:WIKI_MASTER_VAULT_NAME = '<selected-native-selector>'
  node '<absolute-plugin-root>/scripts/health.mjs' --json
  if ($LASTEXITCODE -ne 0) { throw 'Wiki health failed' }
} finally {
  foreach ($wikiKey in $wikiKeys) { [Environment]::SetEnvironmentVariable($wikiKey, $wikiPrior[$wikiKey], 'Process') }
}
```

POSIX binds one command only (or use a subshell for the whole request):

```sh
WIKI_MASTER_CONFIG='<absolute-registry-file>' WIKI_MASTER_PROJECT_ROOT='<absolute-repository>' WIKI_MASTER_VAULT_ID='<selected-id>' WIKI_MASTER_VAULT='<selected-canonical-root>' WIKI_MASTER_VAULT_NAME='<selected-native-selector>' node '<absolute-plugin-root>/scripts/health.mjs' --json
```

For authorized work, run the task's actual helper with that same binding. Re-resolve
between invocations; changed configuration must cause a mismatch, not a write to an
old route. Restore prior environment at request end; a previous research choice is
not the next request's answer. Pass repository context again when validating an ID.

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
