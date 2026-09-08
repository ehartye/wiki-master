---
name: wiki-search
description: Use when asked to find wiki pages, locate a passage, or inspect raw evidence with citation-ready paths and lines. Pure retrieval; use wiki-query for a synthesized answer and wiki-discover for new external sources.
argument-hint: "<your search terms> [--include-raw]"
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read directly for this operation: [access](../wiki-maintainer/references/access.md), [evidence](../wiki-maintainer/references/evidence.md).
This entry point is read-only; do not open an operation, write a log, or refresh the index.

# Searching the wiki

This skill is **pure retrieval** — it finds pages and passages, it does not
synthesize an answer or write anything. If you want a cited, narrative
answer to a question (and optionally have it filed back as a new
`wiki/syntheses/` page), use `/wiki-query` instead — that skill calls into
this one as its first step, then adds the parts this one deliberately
leaves out.

## How it works

`node "<absolute-plugin-root>/scripts/search.mjs" "..."` runs a tiered lookup over `wiki/` and `moc/`:
The helper attempts Obsidian keyword lookup with a bounded timeout; a chunk-level semantic index
(built by `index-embed.mjs`, Ollama-backed) fuses in via Reciprocal Rank
Fusion when both a reachable Ollama and a built index are present. Results
print as `path:line` — the line is the passage that actually matched, so
read from there rather than the top of the page.

**A status line always prints to stderr. Read it, and tell the user when it
is not `hybrid`, and inspect channel failures even when it is.** Degradation can
leave plausible results with incomplete coverage; a fatal input/runtime error can
still fail. Report unavailable channels instead of interpreting no hits as no knowledge:
- `(hybrid · N chunks)` — keyword and chunk-level semantic, RRF-fused; channel status alone does not establish relevance.
- `(lexical — <what is off> · run --health)` — Obsidian keyword only. The
  results are still real, but semantic ranking contributed nothing. **Say so
  in your answer** — a user reading a confident result list has no way to
  know the retrieval was degraded.

To diagnose or fix: `node "<absolute-plugin-root>/scripts/search.mjs" --health` for the full
report, `--setup` for the exact remediation commands. The usual causes are
Ollama not running, the embedding model not pulled, or the index not built
(`node "<absolute-plugin-root>/scripts/index-embed.mjs"`). Operational health is not relevance:
validate the returned page, status and supporting passage against the question.

For agent selection, use `--json --limit=10` to get bounded passages and metadata,
including project/type/status, factual review dates, provenance targets and index
freshness. Use `--project=<slug>`, `--type=<type>` or `--status=<state>` when the
question establishes a scope. Do not hide other domains when exploring complementary
ideas. Inspect decision/backlog state inside metadata before describing a proposal
as shipped. Exact titles and equivalent aliases are prioritized; ambiguous names
still require choosing the intended full path.

**`op-commit` attempts an index refresh after every bracketed operation**; read
its notice for backend failures or a partial build. It cannot preempt edits outside
the operation — a hand edit in Obsidian, a `git pull` from
another machine. Hash-keyed vectors alone do not make a stale manifest current.
Search checks candidate file versions and reads passages from the current file;
modified semantic hits are excluded until refreshed and removed hits are dropped.
Read the per-result freshness and diagnostics; a live lexical/identity match can
still have an outdated embedding. `--health` reports changes since refresh.

## Reaching raw/ — the actual fix for "don't grep the vault"

`wiki/` is the browsable, synthesized index; `raw/` is immutable clipped
evidence, deliberately excluded from both the keyword default and the
semantic index (embedding it would roughly triple the index — an explicit,
documented scope decision, not an oversight). That does **not** mean raw/ is
unsearchable, though — Obsidian's own full-text index already covers it
fine. **Pass `--include-raw`** to search both in one call:

```bash
node "<absolute-plugin-root>/scripts/search.mjs" "your terms" --include-raw
```

Raw hits are appended after the normal `wiki/` result list (not blended into
the ranked/fused ordering — raw/ isn't chunked, so there is nothing to fuse
it against), and are self-evident by their `raw/...` path prefix. A
stderr line always discloses how many raw/ hits were found, including
`0` explicitly. Check raw-channel diagnostics too: an unavailable index with
zero returned hits does not establish that raw evidence is absent. **Reach for this before falling back to a
raw shell `grep`** — it's the same underlying index, tool-assisted, and
consistent with how every other lookup in this vault works.

## Jumping from a wiki/ hit to its raw/ evidence

A `wiki/` hit is a synthesized page, not the evidence itself — normally,
reaching the raw clipping it rests on means opening the page and reading its
`sources:` frontmatter by hand. `node "<absolute-plugin-root>/scripts/resolve-evidence.mjs"`
does that walk for you, and is built to take a hit straight from this
skill's own output, piped:

```bash
node "<absolute-plugin-root>/scripts/search.mjs" "your terms" | node "<absolute-plugin-root>/scripts/resolve-evidence.mjs"
```

It also takes explicit paths (`node "<absolute-plugin-root>/scripts/resolve-evidence.mjs"
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

1. Run the search: `node "<absolute-plugin-root>/scripts/search.mjs" "<terms>" [--include-raw]`.
2. Read the stderr status line (and the raw/ hit-count line, if used) before
   trusting the results — disclose any degradation to the user.
3. Read from the matched line (`path:line`) outward, not from the top of
   the page — that is the passage that actually matched.
4. Need the raw source behind a `wiki/` hit? Pipe the default text output into
   `resolve-evidence.mjs` (above) rather than opening the page and tracing
   its `sources:` field by hand. The evidence route follows citations, not
   `Related:`/`## Relationships` navigation or lateral concept links. A route
   establishes provenance, not that the retrieved passage is supported: read
   the source and verify the specific claim before quoting or synthesizing it.
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
