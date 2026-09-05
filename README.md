# wiki-master

A **Claude Code, GitHub Copilot CLI, and Codex** plugin that realizes Andrej Karpathy's
[LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
natively on Obsidian: the agent incrementally compiles and maintains a persistent,
densely interlinked markdown wiki over your curated sources.

- The **agent** (Claude Code, GitHub Copilot CLI, or Codex) is the synthesis engine.
- The **native `obsidian` CLI** does all resolved-semantics work (links, search,
  typed properties, graph health, versioning).
- A small Node helper layer does zero-LLM structural checks.
- One Ollama-backed script does semantic-drift detection.

No MCP server, no daemon, no vector database. Semantic search is a chunk-level index
built from your own Ollama instance: ~5,500 chunks over ~1,800 pages, brute-force cosine
in single-digit milliseconds. A vector database solves a problem this scale does not have.

## Requirements

- A host agent: **Claude Code**, **GitHub Copilot CLI**, or **Codex** with plugin support.
  Each host loads the same skills and runs the bundled helpers independently.
- Obsidian 1.12+ with the official command-line interface enabled
  (Settings → General → Command line interface).
- The vault open in Obsidian (the CLI drives the running app).
- Node.js ≥18 (for the helper scripts).
- Optional: [Ollama](https://ollama.com) with an embedding model
  (`ollama pull nomic-embed-text`), for semantic-drift detection — degrades
  gracefully if absent.
- Optional: `npm i -g playwright-core`, plus Chrome or Edge, for the
  browser-render clip rung — clipping JavaScript-rendered pages that serve no
  article text to a plain fetch. Degrades gracefully if absent; without it those
  pages are queued for triage exactly as before. Set `WIKI_MASTER_BROWSER` to
  point at a specific browser executable.

## Install

The plugin ships its operations as **skills** and shares the same `scripts/`
(Node) across all three hosts. Claude Code and Copilot CLI expose `/wiki-*`;
in Codex, select a skill or ask for it by name (for example, “use wiki-health”).

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

**Codex:**

The Codex manifest is `.codex-plugin/plugin.json`. See [Codex setup](docs/codex.md)
for personal marketplace installation and host-specific usage. Keep the entire
plugin folder together: the skills use the sibling `scripts/` and `templates/`.

## Quick start

1. `/wiki-init` — scaffolds the vault and prints one-time setup.
2. In Obsidian: **Open folder as vault** → the scaffolded path.
3. Verify: `obsidian vaults` lists the vault.
4. Import `templates/webclipper-template.json` into the Obsidian Web Clipper.
5. Clip web pages (they land in `raw/clippings/`), then `/wiki-ingest` to compile
   them into the wiki. Ask questions with `/wiki-query`, or just search with `/wiki-search`.

## Skills

Invoked as `/wiki-*` on Claude Code and GitHub Copilot CLI. In Codex, select
the matching skill or ask for it by name; the slash notation below identifies
the same workflows.

| Skill | Purpose |
|---|---|
| `/wiki-init` | Scaffold the vault (folders, index/log, schema, Bases dashboard, templates). |
| `/wiki-ingest [source]` | Read a source → summary page + cross-references + index/log. Blank = process new clippings. |
| `/wiki-search <terms> [--include-raw]` | Pure retrieval — matching `wiki/` pages (optionally `raw/` clippings too) as citation-ready `path:line` results. Chunk-level semantic + keyword, RRF-fused. No synthesis, no writes. |
| `/wiki-query <question>` | Ask a question, get a synthesized answer with citations; optionally file it back as a new page. Calls `/wiki-search` as its first step. |
| `/wiki-health` | Fast zero-LLM structural report + 0–100 score. |
| `/wiki-lint` | Periodic deep pass: contradictions, stale claims, missing links, drift. |
| `/wiki-stale` | Freshness buckets from `reviewed`/`updated` + semantic drift. |
| `/wiki-relink` | Add inferred links, materialize frequently-referenced entities, build MOCs. |
| `/wiki-author [what]` | Author original `wiki/authored/` content (docs, guides, ADRs, backlog items) — canonical per-kind placement, no re-deriving convention per project. |
| `/wiki-purge <topic> [--seeds a.md,b.md]` | Remove a topic for good — pages, evidence and source URLs move to a git-tracked `.recycle/` bin and the removal is committed so it reaches every machine. `--reconcile` re-bins anything that comes back; `--restore <id>` undoes it. |

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
wiki/           sources · entities · concepts · syntheses · authored (LLM-owned)
moc/            Maps of Content        index.md    catalog        log.md  history
stale.base      native Bases freshness dashboard   .wiki-master/  search index + caches (git-ignored)
.recycle/       purged topics, one folder + manifest.json per purge (git-tracked, never auto-emptied)
```

`.recycle/` is dot-prefixed on purpose: `graph.mjs` skips dot entries during its
walk, every other reader filters on an anchored `wiki/` prefix, and Obsidian's own
indexer ignores dot-folders — so purged content is invisible to every search, metric
and graph without a single reader needing to know it exists. It is git-tracked, so a
purge reaches your other machines instead of evaporating on the next sync.

Every wiki page carries `sources: [[...]]` provenance back to `raw/` and
`ai-generated: true` — the guardrails against hallucination contamination.
`wiki/authored/` is the disclosed exception: original content with no `raw/`
counterpart (advisory documentation, policy, house style) declares it via
`sources: []` instead. Pages belonging to a multi-doc project can carry
`project`/`kind` so they group under a generated `moc/<project>.md` hub instead
of one flat, ungrouped catalog.

## Development

`npm test` (or `node --test`) runs the unit suite for the deterministic scripts
against a fixture vault — no running Obsidian required. See
`docs/superpowers/specs/` and `docs/superpowers/plans/` for the design and plan.
