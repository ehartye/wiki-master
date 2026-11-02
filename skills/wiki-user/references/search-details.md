# Search diagnostics and evidence routes

Use [search](search.md) for the ordinary read-only procedure. Load this reference
only when the detailed diagnostics or evidence route contracts are needed.

## How it works

`node "<absolute-plugin-root>/scripts/search.mjs" "..."` runs a tiered lookup over `wiki/` and `moc/`:
The helper scans the Markdown files for keyword matches (exact phrase first, then all query terms, then partial matches) and needs no running app; a chunk-level semantic index
(built by `index-embed.mjs`, Ollama-backed) fuses in via Reciprocal Rank
Fusion when both a reachable Ollama and a built index are present. Results
print as `path:line` — the line is the passage that actually matched, so
read from there rather than the top of the page.

**A status line always prints to stderr. Read it, and tell the user when it
is not `hybrid`, and inspect channel failures even when it is.** Degradation can
leave plausible results with incomplete coverage; a fatal input/runtime error can
still fail. Report unavailable channels instead of interpreting no hits as no knowledge:
- `(hybrid · N chunks)` — keyword and chunk-level semantic, RRF-fused; channel status alone does not establish relevance. When the keyword scan finds the query exactly (1 to 3 pages hold the whole query as written, or a query of at most 5 terms has 1 to 3 pages holding every term in one paragraph), the semantic list stops voting in the final order, so an identifier or phrase is not displaced by topical neighbours; `--json` reports that as `semanticGate: { reason, pages }` (`null` when it did not apply). The tier is unchanged: semantic still admits candidates.
- `(lexical — <what is off> · run --health)` — keyword only. The
  results are still real, but semantic ranking contributed nothing. **Say so
  in your answer** — a user reading a confident result list has no way to
  know the retrieval was degraded.
- `(<tier> — keyword request failed (wiki) · run --health)` — a keyword scope failed. A failed `wiki/`
  scope (the primary one) drops the tier below `hybrid` even if `moc/` answered, so results come from the other
  channels only; **say so**. In `--json` output `channels` states each channel: `keyword.{wiki,moc,raw}` is `ok` or
  `failed`, `semantic` is `ok`, `failed`, `ollama-unavailable` or `index-unavailable`, and `identity` is `ok` or
  `incomplete`. A `raw/ clippings NOT searched` line means the raw scan failed: no raw hit is then not evidence of absence.

To diagnose: `node "<absolute-plugin-root>/scripts/search.mjs" --health` for the full
report, `--setup` to display the exact remediation commands. Do not execute repairs during a read-only lookup. The usual causes are
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

To list backlog items by their lifecycle, do not search for `status:`: that finds the
page status (`draft` or `maintained`). Run
`node "<absolute-plugin-root>/scripts/backlog-list.mjs" --project <slug> --backlog-status planned`
(also `--startable` and `--json`); [authoring](authoring.md) describes it.

**`op-commit` attempts an index refresh after every bracketed operation**; read
its notice for backend failures or a partial build. It cannot preempt edits outside
the operation — a hand edit in Obsidian, a `git pull` from
another machine. Hash-keyed vectors alone do not make a stale manifest current.
Search checks candidate file versions and reads passages from the current file;
modified semantic hits are excluded until refreshed and removed hits are dropped.
Read the per-result freshness and diagnostics; a live lexical/identity match can
still have an outdated embedding. `--health` reports changes since refresh.

## Explicit raw lookup

`wiki/` is the browsable, synthesized index; `raw/` is immutable clipped
evidence, deliberately excluded from both the keyword default and the
semantic index. The keyword scan can include raw evidence explicitly. **Pass `--include-raw`** to search both in one call:

```bash
node "<absolute-plugin-root>/scripts/search.mjs" "your terms" --include-raw
```

Raw hits are appended after the normal `wiki/` result list (not blended into
the ranked/fused ordering — raw/ isn't chunked, so there is nothing to fuse
it against), and are self-evident by their `raw/...` path prefix. A
stderr line always discloses how many raw/ hits were found, including
`0` explicitly. Check raw-channel diagnostics too: an unavailable index with
zero returned hits does not establish that raw evidence is absent. **Reach for this before falling back to a
raw shell `rg`** — it uses the supported keyword scan and reports its coverage.

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

