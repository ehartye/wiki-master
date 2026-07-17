# wiki-master

A **Claude Code and GitHub Copilot CLI** plugin that realizes Andrej Karpathy's
[LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
natively on Obsidian: the agent incrementally compiles and maintains a persistent,
densely interlinked markdown wiki over your curated sources.

- The **agent** (Claude Code or GitHub Copilot CLI) is the synthesis engine.
- The **native `obsidian` CLI** does all resolved-semantics work (links, search,
  typed properties, graph health, versioning).
- A small Node helper layer does zero-LLM structural checks.
- One Ollama-backed script does semantic-drift detection.

No MCP server, no daemon, no vector database.

## Requirements

- A host agent: **Claude Code** or **GitHub Copilot CLI** — both load the same
  plugin. Claude Code is not required for Copilot CLI (the plugin runs standalone).
- Obsidian 1.12+ with the official command-line interface enabled
  (Settings → General → Command line interface).
- The vault open in Obsidian (the CLI drives the running app).
- Node.js ≥18 (for the helper scripts).
- Optional: [Ollama](https://ollama.com) with an embedding model
  (`ollama pull nomic-embed-text`), for semantic-drift detection — degrades
  gracefully if absent.

## Install

The plugin ships its operations as **skills**, so both hosts expose them as
`/wiki-*` and run the same `scripts/` (Node). Copilot CLI loads it with no Claude
Code present.

**Claude Code:**
```
/plugin marketplace add ehartye/wiki-master
/plugin install wiki-master
```

**GitHub Copilot CLI:**
```
copilot plugin marketplace add ehartye/wiki-master
copilot plugin install wiki-master@wiki-master-marketplace
```

Or run straight from a local clone on either host — e.g.
`copilot --plugin-dir /path/to/wiki-master`. (The marketplace forms require the
repo's default branch to carry `.github/plugin/marketplace.json` and
`.claude-plugin/marketplace.json`.)

## Quick start

1. `/wiki-init` — scaffolds the vault and prints one-time setup.
2. In Obsidian: **Open folder as vault** → the scaffolded path.
3. Verify: `obsidian vaults` lists the vault.
4. Import `templates/webclipper-template.json` into the Obsidian Web Clipper.
5. Clip web pages (they land in `raw/clippings/`), then `/wiki-ingest` to compile
   them into the wiki. Ask questions with `/wiki-query`.

## Skills

Invoked as `/wiki-*` on both Claude Code and GitHub Copilot CLI.

| Skill | Purpose |
|---|---|
| `/wiki-init` | Scaffold the vault (folders, index/log, schema, Bases dashboard, templates). |
| `/wiki-ingest [source]` | Read a source → summary page + cross-references + index/log. Blank = process new clippings. |
| `/wiki-query <question>` | Answer from the wiki with citations; optionally file the answer back. |
| `/wiki-health` | Fast zero-LLM structural report + 0–100 score. |
| `/wiki-lint` | Periodic deep pass: contradictions, stale claims, missing links, drift. |
| `/wiki-stale` | Freshness buckets from `reviewed`/`updated` + semantic drift. |
| `/wiki-relink` | Add inferred links, materialize frequently-referenced entities, build MOCs. |

## Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `WIKI_MASTER_VAULT` | `~/.wiki-master-vault` | Vault path (also the CLI target and embedding-cache home). |
| `WIKI_MASTER_VAULT_NAME` | vault folder basename | The registered Obsidian vault name the CLI targets. |
| `WIKI_MASTER_EMBED_MODEL` | `nomic-embed-text` | Ollama embedding model for drift. |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama endpoint. |

## Vault layout

```
raw/            immutable sources (never edited)   raw/clippings/  Web Clipper output
wiki/           sources · entities · concepts · syntheses (LLM-owned)
moc/            Maps of Content        index.md    catalog        log.md  history
stale.base      native Bases freshness dashboard   .wiki-master/  embedding cache (git-ignored)
```

Every wiki page carries `sources: [[...]]` provenance back to `raw/` and
`ai-generated: true` — the guardrails against hallucination contamination.

## Development

`npm test` (or `node --test`) runs the unit suite for the deterministic scripts
against a fixture vault — no running Obsidian required. See
`docs/superpowers/specs/` and `docs/superpowers/plans/` for the design and plan.
