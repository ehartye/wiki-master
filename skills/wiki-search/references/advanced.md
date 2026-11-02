# Advanced retrieval and evidence routes

Use the [simple search workflow](../SKILL.md#simple-search) for root resolution,
bounded lookup and passage reading. This reference adds retrieval choices; every
step is read-only. Diagnostics and repair recipes live in
[search diagnostics](../../wiki-setup/references/search-diagnostics.md).

## Scope and disambiguation

Use `--json --limit=10` for bounded passages and metadata: project/type/status,
factual review dates, provenance targets and index freshness. Add
`--project=<slug>`, `--type=<type>` or `--status=<state>` only when the question
establishes scope. Page status (`draft`/`maintained`) is not a backlog lifecycle;
use [backlog listing](../../wiki-project/references/backlog.md#list-by-lifecycle)
for planned or startable work.

Exact titles and equivalent aliases are prioritized. Open all plausible full
paths when a title is ambiguous; compare the scope, context and requested project.
An alias names an equivalent concept, not any similarly worded topic. When a
question needs several terms, run a small set of complementary bounded queries
and report their coverage. Do not hide complementary domains with an arbitrary
filter. Check decision/backlog metadata before calling a proposal shipped.

## Explicit raw lookup

`wiki/` is the synthesized index; immutable `raw/` evidence is excluded from the
keyword default and semantic index. Request raw lookup explicitly:

```sh
node "<absolute-plugin-root>/scripts/search.mjs" "useful terms" --include-raw --json --limit=10
```

Raw hits are appended after normal wiki results rather than blended into the
fused ranking. Report the actual raw hit count, including zero, **only if the raw
scan succeeded**. A `raw/ clippings NOT searched` diagnostic or failed raw channel
means missing coverage, never zero evidence. Use the supported helper before a
bounded filesystem fallback. Exclude `.recycle/`, hidden folders and binary originals.

Read the actual raw passage and its fidelity/restriction metadata before quoting
or using it as support. A raw hit is unvetted evidence; a route to it is not proof
of the claim. Apply the direct [evidence policy](../../wiki-maintainer/references/evidence.md),
including quarantined/retired restrictions and Reddit/Medium separation.

## Follow provenance

Resolve a returned wiki citation to its raw evidence:

```sh
node "<absolute-plugin-root>/scripts/resolve-evidence.mjs" "wiki/sources/Example.md:23"
```

The helper strips a `:line` suffix; an explicit raw path is already evidence.
It also accepts search output on stdin:

```sh
node "<absolute-plugin-root>/scripts/search.mjs" "useful terms" | node "<absolute-plugin-root>/scripts/resolve-evidence.mjs"
```

Open the returned paths and verify the exact supporting text. `unreachable`
means the citation trail does not reach raw evidence, not permission to invent a
source. `declared-no-provenance` distinguishes original authored pages declaring
`sources: []` from broken derived provenance. Retain unresolved citations in the
coverage report. Original project facts may be grounded in verified behavior;
do not demand a fabricated clipping for first-party documentation.

## Read the result honestly

Inspect stderr plus JSON `channels`, `diagnostics`, `indexFreshness` and
`semanticGate`. Hybrid is a channel state, not a relevance guarantee. Lexical
results are real without semantic ranking; a failed primary wiki scan means
incomplete coverage even if MOCs or semantic results answer. Candidate validation
can be bounded, so disclose relevant candidate-limit notices. Open current files:
modified semantic hits are excluded until refreshed and removed hits are dropped;
live lexical/identity matches can still have outdated embeddings.

For an answer spanning sources, load [cited answers](answers.md) directly. For a
requested diagnosis load [search diagnostics](../../wiki-setup/references/search-diagnostics.md).
Neither path authorizes backend installs or index rebuilds.
