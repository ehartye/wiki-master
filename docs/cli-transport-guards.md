# Obsidian CLI transport safeguards

The CLI socket header parser in the installed Obsidian 1.13.7 produced a main-process JSON error. The exact trigger remains unproven. These guards limit oversized requests and overlapping calls; they do not repair Obsidian's parser.

## Supported access

Run app commands through the bundled proxy, using its actual absolute path:

```powershell
node 'C:/absolute/plugin/scripts/obsidian.mjs' search 'query=offline mode' path=wiki limit=10 format=json
```

The proxy resolves `WIKI_MASTER_VAULT` and `WIKI_MASTER_VAULT_NAME` through the existing vault wrapper. JavaScript callers use `obsidian()` from `scripts/lib/vault.mjs`; async search uses `guardedExecFile()` from `scripts/lib/cli-transport.mjs`. Arguments go directly to the executable without a shell. Node.js 20.8 or newer is required.

Create, replace and append ordinary Markdown through exact-path filesystem edits even when the app responds. Read current content first, preserve user changes, bracket writes with the operation helpers, validate and complete the usual catalog/log/commit/sync lifecycle. Do not split a rejected note into repeated CLI writes. Small typed-property and app actions may use the proxy.

## Enforced boundaries

- Reject physical CR/LF, NUL and estimated JSON request envelopes over 2,048 UTF-8 bytes before launch. The estimate includes arguments, JSON escaping, working directory and a newline. This conservative policy is not a measured Obsidian wire limit. Diagnostics identify the command and size without echoing the input body.
- Serialize cooperating callers for the same OS user across processes, vaults, plugin versions and worktrees. Windows uses a named pipe; Linux uses an abstract socket; other platforms reserve a deterministic loopback port. An unrelated listener fails closed. No lock file, permanent service or stale-lock stealing is involved.
- Wait at most 10 seconds for the gate by default, separately from the CLI's default 10-second execution timeout. Hold the gate until the child closes, including on failure or timeout. No command is automatically retried.

`CLI_REQUEST`, `CLI_BUSY` and `CLI_LOCK` mean the request was not sent. Use supported filesystem reads when the app channel is unavailable. A command timeout or worker failure can leave a mutation's outcome unknown: inspect the exact target and reconcile the existing operation before continuing.

## Limits and activation

Raw `obsidian` commands and older plugin copies bypass this guard. Updating every cooperating caller is necessary; this is not machine-wide interception. Killing a guard owner frees the OS reservation but cannot prove an orphaned CLI child or app-side mutation has finished. Within one Node process, await asynchronous CLI work before calling the synchronous adapter so its event loop can release its gate.

Available in wiki-master 0.37.0. Update installed plugin copies and start a new agent session to activate the guard through installed skills. Earlier copies remain unguarded. No vault migration is required.

The [design](superpowers/specs/2026-09-08-cli-transport-guards-design.md) records evidence and alternatives. The [implementation plan](superpowers/plans/2026-09-08-cli-transport-guards.md) records verification. Transport tests use fake child processes and temporary artifacts, never oversized requests against a live vault. Paired skill probes in `eval/cli-safeguards/` measure simulated intended actions, not executed production reliability.
