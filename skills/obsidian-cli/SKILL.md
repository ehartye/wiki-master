---
name: obsidian-cli
description: Reference for driving the native Obsidian command-line interface (v1.12+). Use whenever a wiki-master operation needs to read, search, link, tag, or edit notes in the vault via the `obsidian` CLI.
---

# Driving the Obsidian CLI

The vault is targeted by name: `obsidian vault=<name> <command> ...`. wiki-master
resolves `<name>` from `WIKI_MASTER_VAULT_NAME` or the vault folder's basename.
`file=` resolves by name (like wikilinks); `path=` is an exact vault-relative path.
Prefer the `scripts/lib/vault.mjs` wrapper from Node; use raw commands when acting
directly.

## Read / search
- `obsidian read path=wiki/concepts/alpha.md`
- `obsidian search query="tag:clippings neural" format=json`
- `obsidian search:context query="scaling laws" format=json` — grep-style with lines

## Links & graph (Obsidian's resolved index — do not re-parse)
- `obsidian backlinks file=alpha counts` — who links here
- `obsidian links file=alpha` — outgoing links
- `obsidian orphans` · `obsidian deadends` · `obsidian unresolved` — health signals

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

Always assume Obsidian is running. If a command fails, surface the running-guard
message from `scripts/lib/vault.mjs` (`assertRunning`).
