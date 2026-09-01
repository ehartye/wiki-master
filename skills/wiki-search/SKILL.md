---
name: wiki-search
description: Search the wiki (and optionally raw/ clippings) and return matching pages with citation-ready paths and line numbers — pure retrieval, no synthesis. Use whenever you need to find what pages exist on a topic, locate a passage to quote, or check raw/ evidence directly, without necessarily writing an answer back.
argument-hint: "<your search terms> [--include-raw]"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/<name>.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location and guardrails these
> steps assume. Skip the load if you arrived here mid-run from a wiki-master
> skill that already pulled it in.

# Searching the wiki

This skill is **pure retrieval** — it finds pages and passages, it does not
synthesize an answer or write anything. If you want a cited, narrative
answer to a question (and optionally have it filed back as a new
`wiki/syntheses/` page), use `/wiki-query` instead — that skill calls into
this one as its first step, then adds the parts this one deliberately
leaves out.

## How it works

`node ../../scripts/search.mjs "..."` runs a tiered lookup over `wiki/`:
Obsidian's own keyword index always runs, and a chunk-level semantic index
(built by `index-embed.mjs`, Ollama-backed) fuses in via Reciprocal Rank
Fusion when both a reachable Ollama and a built index are present. Results
print as `path:line` — the line is the passage that actually matched, so
read from there rather than the top of the page.

**A status line always prints to stderr. Read it, and tell the user when it
is not `hybrid`.** Search never fails loudly; it degrades to a working but
weaker answer, which is why the disclosure exists:
- `(hybrid · N chunks)` — keyword and chunk-level semantic, RRF-fused. Full
  strength.
- `(lexical — <what is off> · run --health)` — Obsidian keyword only. The
  results are still real, but semantic ranking contributed nothing. **Say so
  in your answer** — a user reading a confident result list has no way to
  know the retrieval was degraded.

To diagnose or fix: `node ../../scripts/search.mjs --health` for the full
report, `--setup` for the exact remediation commands. The usual causes are
Ollama not running, the embedding model not pulled, or the index not built
(`node ../../scripts/index-embed.mjs`).

**`op-commit` refreshes the index after every bracketed operation**, so
anything written through an operation is already searchable. What it cannot
see is an edit made outside one — a hand edit in Obsidian, a `git pull` from
another machine. The index is chunk-content-hash keyed, so it can be
incomplete but never wrong: a stale index misses recent edits rather than
serving outdated text. `--health` reports how many files have changed since
the last refresh.

## Reaching raw/ — the actual fix for "don't grep the vault"

`wiki/` is the browsable, synthesized index; `raw/` is immutable clipped
evidence, deliberately excluded from both the keyword default and the
semantic index (embedding it would roughly triple the index — an explicit,
documented scope decision, not an oversight). That does **not** mean raw/ is
unsearchable, though — Obsidian's own full-text index already covers it
fine. **Pass `--include-raw`** to search both in one call:

```bash
node ../../scripts/search.mjs "your terms" --include-raw
```

Raw hits are appended after the normal `wiki/` result list (not blended into
the ranked/fused ordering — raw/ isn't chunked, so there is nothing to fuse
it against), and are always self-evident by their `raw/...` path prefix. A
stderr line always discloses how many raw/ hits were found, including
`0` explicitly — so you can tell "raw/ was checked and came up empty" apart
from "raw/ was never checked." **Reach for this before falling back to a
raw shell `grep`** — it's the same underlying index, tool-assisted, and
consistent with how every other lookup in this vault works.

## Jumping from a wiki/ hit to its raw/ evidence

A `wiki/` hit is a synthesized page, not the evidence itself — normally,
reaching the raw clipping it rests on means opening the page and reading its
`sources:` frontmatter by hand. `node ../../scripts/resolve-evidence.mjs`
does that walk for you, and is built to take a hit straight from this
skill's own output, piped:

```bash
node ../../scripts/search.mjs "your terms" | node ../../scripts/resolve-evidence.mjs
```

It also takes explicit paths (`node ../../scripts/resolve-evidence.mjs
"wiki/sources/Foo.md:23"` — the `:line` search.mjs prints is stripped
automatically), and a `raw/...` path passed straight through is reported as
already being the evidence, not re-resolved. It never guesses: a page whose
citation trail doesn't actually reach `raw/` is reported as `unreachable`
(a real gap — matches `health.mjs`'s `provenanceGaps`/`unreachableProvenance`
vocabulary) rather than silently omitted or invented, and a page that
legitimately has no provenance (`wiki/authored/`'s `sources: []`) is
reported as `declared-no-provenance`, distinctly — a deliberate disclosure,
not a defect.

## Steps

1. Run the search: `node ../../scripts/search.mjs "<terms>" [--include-raw]`.
2. Read the stderr status line (and the raw/ hit-count line, if used) before
   trusting the results — disclose any degradation to the user.
3. Read from the matched line (`path:line`) outward, not from the top of
   the page — that is the passage that actually matched.
4. Need the raw source behind a `wiki/` hit? Pipe it into
   `resolve-evidence.mjs` (above) rather than opening the page and tracing
   its `sources:` field by hand.
5. Return the matching paths/lines to whatever asked for them. If what's
   actually needed is a synthesized, cited answer (and possibly a new page
   filed back), hand off to `/wiki-query` rather than writing that
   synthesis here.

## Guardrails

- **This skill never writes anything.** No new pages, no index regeneration,
  no log entries — that is `/wiki-query`'s job once an answer exists. If you
  find yourself about to synthesize prose or file a page from here, stop and
  use `/wiki-query` instead.
- **A raw/ hit is unvetted evidence, not a citable fact.** It is exactly
  what a `clip-*` script captured, unreviewed — treat it the same way
  `wiki-maintainer`'s "clippings win" guardrail already treats every other
  raw clipping: fidelity to the source, not truth about the world.
