# Design — Modernize wiki-master + GitHub Copilot CLI support

**Date:** 2026-07-17
**Branch:** `feat/copilot-cli-support`
**Status:** proposed — awaiting review

## Goal

Make wiki-master a **single plugin installable in both Claude Code and GitHub Copilot CLI**, and retire the legacy `commands/` tier in the same pass. Grounded in the wiki's own ingested cluster — see `[[Copilot CLI Adopts the Claude Code Plugin Format]]` — GitHub Copilot CLI adopted Claude Code's plugin/skill format closely enough that dual-target is a thin compatibility layer, not a rewrite.

## Background: the format is (nearly) shared

Copilot CLI plugins are a directory with a root `plugin.json` bundling `skills/`, `agents/`, `hooks`, and `mcpServers`; skills are `skills/NAME/SKILL.md` with `name`/`description` frontmatter, invoked `/name`. Copilot even reads `.claude/skills` and documents `copilot plugin marketplace add anthropics/claude-code`. The deltas that constitute this work:

| Concern | Claude Code (today) | Copilot CLI | Action |
|---|---|---|---|
| Manifest | `.claude-plugin/plugin.json` | root `plugin.json` | Add root manifest; keep Claude one |
| Marketplace | `.claude-plugin/marketplace.json` | `.github/plugin/marketplace.json` | Add Copilot marketplace; keep Claude one |
| User entry-points | `commands/*.md` (8) | `skills/NAME/SKILL.md` | **Migrate commands → skills** |
| Script path | `${CLAUDE_PLUGIN_ROOT}/scripts/*` | *no env var exists* | **Skill-relative `../../scripts/*` (verified)** |
| Hooks | `hooks/hooks.json` (disabled) | `hooks.json` (camelCase, split bash/powershell) | None active → **skip** |
| MCP | none | `.mcp.json` (optional) | **Out of scope** |

**Primary machine is Copilot-only** (work computer); the personal machine has both. So Copilot must run standalone with no Claude Code present — this is the binding constraint. Copilot is the primary validated host (validated locally via `copilot --plugin-dir ./ -p "..." --allow-all-tools`).

## Design

### 1. commands/ → skills/ (the core change)
Convert all 8 command files to user-invocable skills, then delete `commands/`:

`wiki-discover, wiki-health, wiki-ingest, wiki-init, wiki-lint, wiki-query, wiki-relink, wiki-stale`

Each `commands/<name>.md` (frontmatter `description` + `argument-hint`, body delegating to a capability skill) becomes `skills/<name>/SKILL.md` with frontmatter:
```yaml
name: <name>            # required by both hosts; kebab-case
description: <existing description>   # verbatim from the command
```
Body: the existing command body, preserved **except** the script-path change below. These stay **thin entry-points** that load the three capability skills (`wiki-maintainer`, `wiki-discoverer`, `obsidian-cli`), which are unchanged apart from the same path change and the discovery fan-out note. Result: 8 entry-point skills + 3 capability skills, one source of truth, both hosts expose `/wiki-*`.

Notes:
- `argument-hint` / `$ARGUMENTS`: keep as-is; verified on Claude Code, **flagged for the Copilot load-test** (the reference doesn't document `$ARGUMENTS` handling).
- No name collisions (`wiki-discover` entry-point vs `wiki-discoverer` capability are distinct).

### 1a. Script-path resolution — host-neutral, empirically verified
Three local probes against Copilot CLI 1.0.71 (`copilot --plugin-dir ./probe -p ... --allow-all-tools`) established:
- Copilot exposes **no** `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` shell env var, and does **not** substitute `${PLUGIN_ROOT}` in skill bodies.
- The agent **reliably knows its skill's own base directory**, and can run a shared script at `../../scripts/<x>.mjs` resolved relative to that directory (proven: it located and ran a plugin-root `scripts/hello.mjs` from `skills/runner/`).

**Decision:** replace every `node ${CLAUDE_PLUGIN_ROOT}/scripts/<x>.mjs` with prose instructing the agent to run `node <plugin-root>/scripts/<x>.mjs`, where the plugin root is the parent of the `skills/` directory this skill lives in (i.e. `../../scripts/<x>.mjs` relative to the skill). No env var on either host; works with Claude Code absent. Occurrences: all 8 entry-points + `wiki-discoverer` (the `clip.mjs` calls).

### 1b. Discovery fan-out — host-neutral
`wiki-discover` / `wiki-discoverer` currently say "launch 5 perspective subagents in parallel (one message, Agent tool)" — a Claude-Code primitive. Rewrite host-neutrally: "run the 5 perspective passes — in parallel if your host supports agent fan-out (Claude Code's Agent tool; Copilot custom agents), otherwise sequentially." Discovery then works on a Copilot-only machine, degrading to sequential rather than breaking.

### 2. Root `plugin.json` (Copilot), beside the Claude manifest
```json
{
  "name": "wiki-master",
  "description": "...(from existing)...",
  "version": "<bumped>",
  "author": { "name": "ehartye", "email": "eric@hartye.com" },
  "license": "MIT",
  "repository": "https://github.com/ehartye/wiki-master",
  "keywords": ["obsidian", "wiki", "knowledge-base"],
  "skills": ["skills/"]
}
```
`.claude-plugin/plugin.json` stays as-is (Claude Code reads it there; the two do not collide).

### 3. `.github/plugin/marketplace.json` (Copilot), beside the Claude marketplace
Mirror of `.claude-plugin/marketplace.json`: `name`, `owner`, `metadata`, and a `plugins:[{ name, description, version, source: "./" }]` entry. Enables `copilot plugin marketplace add ehartye/wiki-master`.

### 4. Version, README, changelog
Bump `plugin.json` (both) + `package.json` in lockstep (the existing drift-guard test enforces this). README: add a Copilot CLI install section. Note the migration in the changelog/log.

## Risks & open questions

1. ~~**Script-path variable.**~~ **RESOLVED** empirically (§1a): no env var exists under Copilot; skill-relative `../../scripts/*.mjs` works on both hosts. This was the main risk.
2. **`$ARGUMENTS` in Copilot skills** — undocumented; confirm via load-test whether `/wiki-ingest <path>` passes the arg. Fallback: skills already handle the empty-argument case, and the arg can be given in the natural-language prompt.
3. **`commands` field discrepancy** — the Copilot *reference* lists a `commands` path field though the how-to omits it. Irrelevant to this design (we're removing commands regardless), noted for accuracy.
4. **Prerequisites on the target machine** — Copilot must have `node` and the `obsidian` CLI on PATH (both present on this dev machine; confirm on the work computer). Independent of Claude Code.

## Acceptance criteria

1. **Real Copilot CLI load-test:** `copilot plugin install ./` (or via the marketplace) → `copilot plugin list` shows wiki-master → `/skills list` shows the 8 `wiki-*` skills → at least one deterministic op runs end-to-end (`/wiki-health`, and a script-backed op to prove path resolution).
2. **Claude Code unbroken:** the plugin still loads; `/wiki-*` still work.
3. **Tests green:** existing `npm test` (61+ tests incl. drift-guard) passes; add a structural test asserting the root `plugin.json` and `.github/plugin/marketplace.json` are valid and version-aligned.
4. **No `commands/`** directory remains; every former command exists as a skill.

## Out of scope

- MCP server exposing wiki ops (optional; defer — the plugin *is* the integration now).
- A client-side VS Code Copilot extension (single-host, separate TS codebase).
- Copilot **cloud agent** support (ephemeral CI sandbox has no local Obsidian vault).
- Copilot-format hooks (no active hook ships today).
