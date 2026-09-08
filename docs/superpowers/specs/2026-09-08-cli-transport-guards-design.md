# Obsidian CLI transport safeguards

The user requested this specification and implementation after a desktop error showed `JSON.parse` at `obsidian-1.13.7.asar/main.js:64:136`, inside the CLI socket's request-header handler. The displayed fragment contained a Markdown path and `overwrite`. The failure location is confirmed; oversized requests versus concurrency as the incident's specific trigger is not established. These safeguards reduce those exposures without patching Obsidian or reproducing the crash against the live vault.

## Contract

- Before launching the CLI, validate string arguments and reject NUL/physical CR/LF. Limit the estimated UTF-8 JSON request envelope (`argv`, `tty`, `cwd`, newline) to 2,048 bytes. This is a conservative policy ceiling, not a measured universal Obsidian limit. Count escaped JSON and Unicode bytes, not JavaScript string length. Rejection names the command and size, never echoes note content, and states that nothing was sent. No automatic chunking or write fallback inside the generic executor.
- Ordinary Markdown creation/replacement/appending uses exact-path filesystem editing, including when the CLI works. Preserve operation bracketing, current-content checks, raw immutability, validation, logging and authorized sync. Small typed/app actions may use the guarded CLI. After a previously sent write fails, inspect its target before editing through another channel.
- One OS-managed lock serializes all cooperating callers for the same OS user across vaults, processes, plugin versions and worktrees. Windows uses a named pipe; Linux uses an abstract Unix socket. Other platforms use a deterministic loopback port; an unrelated listener fails closed as contention. No stale lock files or background service. Nothing sends note content through the lock socket.
- Wait up to 10 seconds for the lock by default, then fail without launching the command. Never steal a live lock or bypass it. The CLI has its own finite timeout. Hold the lock until the CLI child closes on success, failure or timeout; release it in cleanup. OS cleanup removes an abandoned socket reservation. No automatic mutation retry. A timed-out command may have executed inside Obsidian even after its redirector exits.
- Synchronous callers use a short-lived Node worker that acquires the same lock and runs the CLI. Async search uses the same transport directly. Preserve the existing synchronous return type and asynchronous search behavior, argument boundaries, bounded output and hidden windows. Test injection remains available; production entry points must all route through the transport.
- Add `scripts/obsidian.mjs` as the supported agent entry point, using the configured vault and passing arguments without a shell. Route skill examples to it. Raw `obsidian` calls and older plugin copies do not participate; state that limitation instead of claiming machine-wide interception.

## Alternatives and tradeoffs

| Approach | Time | Risk | Complexity | Best practice | Maintainability |
|---|---|---|---|---|---|
| Shared OS socket reservation (chosen) | Small Node process startup cost for sync calls; bounded waiting under contention | Unrelated listeners can deny access; forced worker termination cannot prove an already-sent mutation finished | One focused transport plus sync adapter | OS owns mutual exclusion and crash cleanup | No heartbeat, stale-file deletion, new dependency or permanent daemon |
| PID/timestamp lock file | Slightly cheaper startup; stale recovery delays later use | Stealing a stale-looking lock can overlap a live caller; reclaim races | PID reuse, heartbeats and atomic recovery need careful handling | Suitable with a proven lock library | Adds recovery machinery or a dependency to a dependency-free project |
| Documentation-only serialization | Fast now, no runtime waiting | Separate agents can ignore the rule and overlap | Lowest code complexity | Insufficient enforcement for the observed class of error | Relies on every caller remembering the rule |

## Scope and verification

Node.js 20.8 or newer is required for the Linux abstract-socket reservation. A forcibly killed owner releases its OS reservation, but an orphaned CLI child or an app-side mutation may still be running; inspect the target before resuming writes. In one Node process, await async CLI work before entering the synchronous adapter: blocking that process's event loop can prevent its own async gate from releasing until the sync call returns `CLI_BUSY`.

Implement in a new feature worktree; no release, merge or installed-cache edits in this task. Keep vault data migration, Obsidian/plugin upgrades, automatic note rewriting and global interception out of scope.

Tests must reject large/escaped/multibyte/multiline requests before a fake executor runs; accept small spaced arguments; show separate processes and sync/async callers never overlap; show lock-wait timeout never invokes the command; release after command failure/timeout and process termination; preserve search diagnostics. Use fake CLI programs and temporary artifacts, never a large live request. Run existing targeted suites and full tests, distinguishing the known Windows triage startup baseline from regressions. Independently review the transport and run paired skill probes with a frozen rubric hidden from actors. Update the wiki with the actual implemented/unreleased state.

## Evidence

- User-provided screenshot and read-only inspection of the installed 1.13.7 source identify the socket header parser.
- [CLI implementation's incident report](https://github.com/husitao/MCP-ObsidianCli#故障排查) describes oversized/concurrent request exposures; this is corroboration, not proof of this incident's trigger.
- [Long-text issue](https://github.com/kepano/obsidian-skills/issues/136) reports CLI write errors with large note content.
- [Node IPC documentation](https://nodejs.org/api/net.html#identifying-paths-for-ipc-connections) documents Windows pipes and Linux abstract sockets and their cleanup behavior.
