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
**Never run `obsidian` from the Bash tool.** The two binaries are Obsidian's own
design, and the official docs explain why: "Windows uses a terminal redirector
that connects Obsidian to stdin/stdout properly. This is necessary because
Obsidian normally runs as a GUI app which is incompatible with terminal outputs
on Windows. When you install Obsidian 1.12.7+ the `Obsidian.com` terminal
redirector will be added in the folder where you installed the `Obsidian.exe`
file."

Windows `PATHEXT` orders `.com` before `.exe`, so PowerShell and Node's
`execFileSync` select the redirector. **Git Bash does not apply `PATHEXT`**, so a
bare `obsidian` there finds the GUI binary, which prints nothing and exits 0 —
measured as 2 bytes of stdout against the redirector's real answer. Use the
**PowerShell tool** or `vault.mjs`. A `PreToolUse` hook enforces this; the rule is
mechanical, so it needs no restating elsewhere.

## Empty is not an answer
Obsidian publishes no exit-code contract and does not document how a command
signals "no results" — neither the official reference nor kepano's first-party
skill says. That gap, not tool unreliability, is why a probe is worth running.

Probe once per session: `obsidian search query="the" total` — a live backend
prints a number. Once it does, the backend is proven for the session: use the CLI
normally, and read a later empty result as "the vault has nothing" without
re-justifying it. Only an empty *canary* means the backend is dead.

Two failure modes people assume and neither holds: **the app not running cannot
produce a silent empty** — per the official docs, "If Obsidian is not running,
the first command you run launches Obsidian" — and index-rebuild has never been
observed to. Do not cite either as a reason to distrust a result.

## Syntax and the live contract
- **Parameters take `=`; flags are bare.** `create name="My Note" content="Hello"`
  vs `create name=Note open overwrite`. `\n` / `\t` for multiline content.
- **`vault=<name>` must be the first parameter**, before the command.
- **`format=` is a parameter, not a flag**, and its default varies per command —
  `search` defaults to `text`, `backlinks`/`tags`/`properties` to `tsv`,
  `base:query` to `json`. Never assume JSON; ask for it.
- **`obsidian help` outranks the docs.** Obsidian's own skill says it "is always
  up to date" — so when the published reference and the binary disagree, the
  binary wins. Check `obsidian help <command>` before concluding a flag is gone.
- Prior art worth comparing against: kepano (Obsidian's CEO) publishes a
  first-party `obsidian-cli` Agent Skill. Where it and this skill agree — `total`
  for counts, `file=` vs `path=`, vault-first ordering — the agreement is
  independent corroboration, not inheritance.

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
- `obsidian eval code="<js>"` — arbitrary JS in app context (last resort).
  **This is remote code execution against the vault**, and it sits in the same
  namespace as the read-only subcommands: a blanket `obsidian *` permission grant
  covers it. It belongs in its own permission decision, not folded in with
  `search` and `read`. The same applies to `dev:cdp` and `dev:debug`.

If a command fails, surface the running-guard message from
`scripts/lib/vault.mjs` (`assertRunning`) — it fails loudly, so a command that
returns is a command that ran.
