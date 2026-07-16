# wiki-master — Design Spec

**Date:** 2026-07-15
**Status:** Approved design → ready for implementation planning
**Author:** Design conversation (brainstorming skill)

---

## 1. Summary

`wiki-master` is a Claude Code plugin that realizes Andrej Karpathy's
["LLM Wiki" pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
natively on top of Obsidian. The LLM (Claude) incrementally **compiles and
maintains** a persistent, densely interlinked markdown wiki that sits between the
user and their raw sources — instead of re-deriving answers from raw chunks on
every query (RAG). "Obsidian is the IDE; the LLM is the programmer; the wiki is
the codebase."

**Division of labor:** the human curates sources, directs exploration, and asks
questions; the plugin (Claude) does all summarizing, cross-referencing, filing,
and consistency bookkeeping.

**Architecture in one line:** Claude is the synthesis engine; the **native
`obsidian` CLI** does all resolved-semantics work (links, search, typed
properties, graph health, versioning); a small unit-tested Node helper layer does
zero-LLM structural checks; one Ollama-backed script does semantic-drift
detection. **No MCP server, no daemon, no vector DB.**

### Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Vault sharing model | One machine for now; designed so git/sync can be added later |
| Interface | Native `obsidian` CLI-primary, app assumed running |
| Vault origin | Fresh vault built for this |
| v1 scope | Full Karpathy loop: ingest + query + lint/health + staleness + graph |
| Packaging | **Approach C**: skills + slash commands + native-CLI helpers (spine) **plus** one small embedding-backed helper for semantic drift |
| Embeddings | Local via Ollama, graceful degradation if unavailable |
| Vault location | `~/.wiki-master-vault`, **overridable via `WIKI_MASTER_VAULT` env var** |

---

## 2. Background & guardrails (from research)

The pattern has three well-documented failure modes; each maps to a guardrail
that is load-bearing in this design:

1. **Hallucination contamination** — LLM-authored pages get read back as input,
   blurring "what the source said" vs. "what a past LLM thought it said."
   → **Guardrail:** every synthesized page carries `sources: [[...]]` provenance
   links back to `raw/`, and `ai-generated: true`. `raw/` is immutable.
2. **Error propagation** across linked pages.
   → **Guardrail:** provenance + citations on query answers; lint checks for
   contradictions and stale claims.
3. **"Maintenance is a wash"** (cost ≈ time saved).
   → **Guardrail:** cheap deterministic `health` checks carry the load every
   session; expensive semantic `lint` runs only periodically.

Reference implementations studied: `SamurAIGPT/llm-wiki-agent` (maintenance
pipeline, health/lint cost split, self-heal entities), `Epistates/turbovault`
(structured link modeling, bounded health score, safety envelope),
`raphasouthall/neurostack` (embedding drift, staleness signals, AI-write
quarantine).

---

## 3. Native Obsidian CLI as the substrate

The installed official Obsidian CLI (v1.12+, requires the app running) provides
almost the entire structural-maintenance layer natively. This satisfies the
"use native Obsidian as humanly possible" mandate: the plugin is an orchestration
+ synthesis layer, **not** a reimplementation.

| Need | Native CLI command(s) |
|---|---|
| Structural graph health | `orphans`, `deadends`, `unresolved`, `backlinks`, `links` |
| Search | `search`, `search:context` (`format=json`) |
| Typed frontmatter | `property:set`/`read`/`remove`, `properties` |
| Tags | `tags`, `tag` |
| Create / edit / move files | `create`, `append`, `prepend`, `move`, `rename`, `delete` |
| Staleness dashboard | `bases`, `base:query` (native Obsidian Bases) |
| Versioning / rollback | `history`, `diff`, `sync:*` (File Recovery) |
| Templates | `templates`, `template:insert`, `template:read` |
| Run any command / JS API | `command`, `commands`, `eval` |
| Word/heading metrics | `wordcount`, `outline`, `file`, `files` |

**Only non-native work:** Claude's synthesis, and Ollama-based embedding drift.

CLI calls target the vault by its registered **name** (`vault=<name>`); helper
scripts that read files directly use the resolved **path**. Both are held in
config (see §8).

---

## 4. Plugin repository structure

Repo: `C:\Users\ehart\repos\wiki-master`, registered in the
`hartye-claude-plugins` marketplace. The vault is **separate** (env-resolved
path).

```
wiki-master/
  .claude-plugin/plugin.json      # manifest
  commands/                       # slash commands (thin; delegate to skill + scripts)
    wiki-init.md   wiki-ingest.md   wiki-query.md
    wiki-health.md wiki-lint.md     wiki-stale.md   wiki-relink.md
  skills/
    wiki-maintainer/SKILL.md      # THE discipline: conventions, workflows, guardrails
    obsidian-cli/SKILL.md         # native-CLI reference (adapted from kepano's official skill)
  scripts/                        # Node .mjs, deterministic, unit-tested
    lib/vault.mjs                 # resolve path+name, spawn CLI, JSON-parse
    lib/embed.mjs                 # single Ollama choke-point
    health.mjs   stale.mjs   drift.mjs
  templates/                      # vault scaffold shipped by /wiki-init
    vault-schema.md  webclipper-template.json  stale.base  _templates/
  hooks/hooks.json                # optional SessionStart health nudge (SHIPPED DISABLED)
  test/                           # node --test against a fixture vault
  docs/superpowers/specs/         # this design doc + plan
  README.md  .gitignore
```

**Component boundaries:**
- *Commands* are thin — they parse args, invoke the `wiki-maintainer` skill for
  discipline, and call scripts for deterministic work.
- *`wiki-maintainer` skill* is the heart: folder/frontmatter conventions, the
  ingest/query/lint/relink workflows, and the guardrails (immutable raw,
  provenance, cite-to-source).
- *`obsidian-cli` skill* is a reference so command/skill files stay thin.
- *Scripts* are pure, testable, zero-LLM (except `embed.mjs` which calls Ollama).

---

## 5. The vault contract (scaffolded by `/wiki-init`)

```
$WIKI_MASTER_VAULT/                (default ~/.wiki-master-vault)
  vault-schema.md                  # the "schema" layer — conventions the maintainer follows
  index.md                         # catalog: every page + one-line summary, by category
  log.md                           # append-only: "## [YYYY-MM-DD] <op> | <title>"
  raw/                             # IMMUTABLE sources — AI reads, never edits
    clippings/                     # Web Clipper lands here
  wiki/
    sources/                       # one summary page per raw source
    entities/                      # people, orgs, tools, datasets
    concepts/                      # ideas, methods, topics
    syntheses/                     # cross-cutting synthesis pages
  moc/                             # Maps of Content (navigational hubs)
  _templates/                      # native Obsidian Templates
  stale.base                       # native Obsidian Base — staleness dashboard
  .wiki-master/                    # git-ignored: embedding cache, hashes, state
```

### Frontmatter contract (typed via `property:set`)

**Raw / clippings** (matches the Web Clipper default template; ingest augments):
```yaml
title: <text>
source: <url>            # origin URL — the provenance anchor
author: [<list>]
published: <date>        # original publish date
created: <date>          # clip/import date
tags: [clippings]
source-hash: <sha256>    # added on ingest; re-ingest only when this changes
```

**Wiki pages:**
```yaml
type: source | entity | concept | synthesis
created: <date>
updated: <date>
reviewed: <date>         # stamped whenever maintenance touches the page
status: stub | draft | maintained
sources: [[...]]         # provenance links back to raw/ — REQUIRED on claim pages
ai-generated: true
```

### Conventions
- Relationships are native `[[wikilinks]]` (`[[Note]]`, `[[Note|alias]]`,
  `[[Note#Heading]]`, `[[Note#^block]]`).
- `![[embeds]]` are for transclusion only and are **never** counted as
  relationship edges (mirrors turbovault's embed-exclusion).
- Clip flow: **Web Clipper → `raw/clippings/` → `/wiki-ingest` → `wiki/…` +
  `index.md` + `log.md`.**
- `/wiki-init` ships `templates/webclipper-template.json` for the user to import
  into the Obsidian Web Clipper so inbound clips match this contract.

---

## 6. Operations

| Command | What it does | Native CLI leaned on | LLM? |
|---|---|---|---|
| `/wiki-init` | Scaffold vault, print vault-registration step, install clipper template + Base + Obsidian templates | `create`, `vaults`, `templates` | no |
| `/wiki-ingest [path\|url\|clipping]` | Read source → write `wiki/sources/<slug>.md` summary, update relevant entities/concepts, `index.md`, `log.md`; propose + apply `[[links]]`; stamp `source-hash` | `read`, `create`, `append`, `property:set`, `links`, `backlinks`, `search` | yes |
| `/wiki-query <question>` | Search relevant pages → synthesize answer **with citations**; offer to file the answer back as a new page | `search:context` (json), `read`, `backlinks` | yes |
| `/wiki-health` | Zero-LLM structural report + bounded 0–100 score. Fast, every session | `orphans`, `deadends`, `unresolved`, `backlinks counts`, `wordcount` | no |
| `/wiki-lint` | Runs `health` first, then semantic pass: contradictions, stale claims, missing concept pages, missing cross-refs, **drift** | above + `search`, `read` + `drift.mjs` | yes |
| `/wiki-stale` | Freshness report from `reviewed`/`updated` dates + drift | `base:query`, `properties`, `property:read` | no* |
| `/wiki-relink` | Apply inferred `[[links]]`; materialize entities referenced ≥3× but unwritten; build/refresh MOCs | `search`, `links`, `unresolved`, `create`, `append` | yes |

\* `/wiki-stale` is deterministic except it surfaces drift results produced by the
Ollama helper.

### Health score (deterministic, `health.mjs`)
Bounded 0–100. Penalties computed independently then summed and capped (avoids
saturation, per turbovault): broken links (`unresolved`), orphans, dead-ends, and
**hub-stubs** (pages with backlink count > μ+2σ but `wordcount` below a floor —
over-connected but thin). Emits a report + fix suggestions.

### Cost discipline (per llm-wiki-agent)
`health` (zero-LLM) runs every session and gates the expensive work — "run
health first; linting an empty file wastes tokens." `lint` runs periodically
(e.g., every ~10–15 ingests or on demand).

---

## 7. Embedding / drift component (the "hybrid" bit)

Minimal, isolated, on-demand. `scripts/drift.mjs`, called only by `/wiki-lint`
and `/wiki-stale`:

1. For each `synthesis`/`concept` page, embed the page body **and** the current
   content of the `raw/` sources it links via `sources: [[...]]`, using Ollama
   through the single choke-point `lib/embed.mjs`.
2. Compare to the last cached vector (hash-keyed cache in `.wiki-master/`;
   re-embed only changed pages/sources).
3. Flag pages whose cosine similarity to their sources dropped below a threshold:
   "may no longer reflect its sources — re-review."

- **No vector DB** — brute-force cosine at personal scale (~hundreds of pages).
- **Graceful degradation:** if Ollama is unavailable, `lint`/`stale` run every
  other check and print "drift skipped (embedder unavailable)."
- Embedder is behind one function so a hosted backend can replace it later
  (out of scope for v1).

---

## 8. Safety, config, testing

### Rollback / safety
- **Native File Recovery** (`history`, `diff`) is the v1 rollback net.
- `git init` on the vault is a documented one-liner for later (user chose "one
  machine, git later"). The vault ships a `.wiki-master/` git-ignore-ready dir.
- `raw/` immutability + provenance are the anti-contamination guardrails (§2).

### Config / env
- `WIKI_MASTER_VAULT` overrides the vault path; default `~/.wiki-master-vault`.
- `lib/vault.mjs` resolves both the **path** (for direct file reads / embedding
  cache) and the registered **vault name** (for `obsidian vault=<name> …`).
- **One-time manual setup:** open the scaffolded folder as a vault in Obsidian
  (programmatic vault registration isn't exposed by the CLI). `/wiki-init` prints
  this step and verifies via `obsidian vaults`.

### Testing (TDD)
- Deterministic scripts (`health.mjs`, `stale.mjs`, `drift.mjs`, `lib/*`) get
  `node --test` unit tests against a committed **fixture vault** with known
  orphans/dead-ends/stale-dates/link structure — clear I/O, so test-first.
- CLI-dependent paths tested against a throwaway registered vault or with the CLI
  boundary mocked.
- Commands/skills get a smoke checklist run against the fixture vault.
- Success criteria per operation are concrete (e.g., "health on the fixture
  reports exactly the 3 seeded orphans and score N").

---

## 9. Out of scope for v1 (future)

- Multi-user concurrency / conflict handling.
- Automated Obsidian Sync or git commit/rollback flows.
- Hosted-embedding backend (Voyage/OpenAI) — the embedder interface allows it,
  but only Ollama ships.
- The optional SessionStart health-nudge hook ships **disabled** in
  `hooks/hooks.json`.

---

## 10. Open questions / risks

- **CLI vault registration** can't be fully automated → one-time manual "open as
  vault" step. Acceptable for personal single-machine use.
- **Ollama dependency** for drift is optional-by-degradation, so a missing
  embedder never blocks maintenance.
- **Token cost** of `lint` is the main ongoing cost; mitigated by the
  health-first gate and periodic (not per-session) linting.
