---
name: obsidian-cli
description: Reference for driving the native Obsidian command-line interface (v1.12+). Use whenever a wiki-master operation needs to read, search, link, tag, or edit notes in the vault via the `obsidian` CLI.
---

# Driving the Obsidian CLI

The vault is targeted by name: `obsidian vault=<name> <command> ...`. wiki-master
resolves `<name>` from `WIKI_MASTER_VAULT_NAME` or the vault folder's basename.
`file=` resolves by name (like wikilinks); `path=` is an exact vault-relative path.
Prefer the `scripts/lib/vault.mjs` wrapper from Node; use raw commands when acting
directly. `obsidian vault info=path` prints the vault's filesystem root — get it
once so `Read`/`Grep` can work on real paths.

## Windows invocation — REQUIRED
**Never run `obsidian` from the Bash tool.** Git Bash skips Windows `PATHEXT`
resolution: bare `obsidian` finds the 210MB GUI `Obsidian.exe` instead of the
`Obsidian.com` console shim, prints nothing, and exits 0 — a silent failure that
reads as "no results". Use the **PowerShell tool** (resolves the shim correctly)
or Node's `execFileSync` via `vault.mjs` (also correct).

## Empty is not an answer
The CLI exits 0 whether it found results or never ran at all, so exit status
alone cannot tell those apart. Probe once per session:
`obsidian search query="the" total` — a live backend prints a number. Once it
does, the backend is proven for the session: use the CLI normally, and read a
later empty result as "the vault has nothing" without re-justifying it. Only an
empty *canary* means the backend is dead.

## Read / search
- `obsidian read path=wiki/concepts/alpha.md`
- `obsidian search query="tag:clippings neural" path=wiki limit=10 format=json`
- Scope to `path=wiki` by default — `raw/` holds immutable source dumps (one
  clipping can be a 219k-word thesis) and belongs in results only when asked.
- Probe cost before fetching: `obsidian search query="..." total` (bytes: ~4).
- **Never default to `search:context`** — it returns every matching line from
  every file (measured 1.5MB where `search limit=10` returned 497 bytes), and
  `limit=` bounds files, not lines, so it cannot save you. Escalate to
  `search:context` only with both `path=` and a narrow query.

## Links & graph
- `obsidian backlinks file=alpha counts` — who links here
- `obsidian links file=alpha` — outgoing links
- `obsidian unresolved verbose format=json` — broken links WITH source files.
  The bare form returns targets only; `verbose` is the difference between a
  defect you can act on and a string you can't attribute. Several subcommands
  have lossy defaults with a `verbose` escape — prefer `format=json verbose`.
- **Health metrics come from `scripts/health.mjs`, not from `orphans` /
  `deadends`.** The CLI computes those verdicts with structural files' links
  (index.md links everything, so nothing ever looks orphaned) and offers no
  source-side exclusion. health.mjs builds the graph from the filesystem.

## Typed properties (frontmatter)
- `obsidian property:set name=reviewed value=2026-07-15 type=date path=wiki/concepts/alpha.md`
- `obsidian property:read name=reviewed path=...`
- `obsidian properties path=...` — list a note's properties

## Create / edit / move
- `obsidian create path=wiki/sources/foo.md content="..."`
- `obsidian append path=... content="..."`
- `obsidian move file=foo to=wiki/entities`

## Tags, tasks, templates, bases
- `obsidian tags counts` · `obsidian tag name=neural verbose`
- `obsidian base:query file=stale.base view=all format=json`
- `obsidian template:insert name=source-note`

## Escape hatches
- `obsidian command id=<id>` — run any Obsidian command (`obsidian commands` to list)
- `obsidian eval code="<js>"` — arbitrary JS in app context (last resort)

If a command fails, surface the running-guard message from
`scripts/lib/vault.mjs` (`assertRunning`) — it fails loudly, so a command that
returns is a command that ran.
