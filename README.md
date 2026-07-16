# wiki-master

A Claude Code plugin that realizes Andrej Karpathy's
[LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
natively on Obsidian: Claude incrementally compiles and maintains a persistent,
densely interlinked markdown wiki over your curated sources.

- **Claude** is the synthesis engine.
- The **native `obsidian` CLI** does all resolved-semantics work (links, search,
  typed properties, graph health, versioning).
- A small Node helper layer does zero-LLM structural checks.
- One Ollama-backed script does semantic-drift detection.

No MCP server, no daemon, no vector database.

> Status: design approved — see
> [`docs/superpowers/specs/2026-07-15-wiki-master-design.md`](docs/superpowers/specs/2026-07-15-wiki-master-design.md).
> Implementation not yet started.

## Requirements

- Obsidian 1.12+ with the official command-line interface enabled
  (Settings → General → Command line interface).
- The vault open in Obsidian (the CLI drives the running app).
- Node.js (for the helper scripts).
- Optional: [Ollama](https://ollama.com) with an embedding model, for
  semantic-drift detection (degrades gracefully if absent).

## Vault location

Defaults to `~/.wiki-master-vault`, overridable via the `WIKI_MASTER_VAULT`
environment variable.
