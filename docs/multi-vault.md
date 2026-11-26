# Project and vault routing

Each vault is self-contained. A machine-local registry supplies a global default;
a repository can independently override its documentation destination and ordered
research list. Configuration selects destinations without moving existing content.
Use [wiki-setup's registration procedure](../skills/wiki-setup/references/routing.md)
to register existing roots or initialize new ones while preserving customized files.

## Configuration

Each registered root has `VAULT.md`, describing only its own scope:

```yaml
---
schema-version: 1
vault-id: general
purpose: General project documentation and research
includes: [Project documentation, Research]
excludes: []
---
```

`purpose` is nonblank, `includes` is a nonempty string list, and `excludes: []`
means no additional exclusions. IDs are case-sensitive lowercase slugs matching
`[a-z][a-z0-9-]*`; they are distinct from native Obsidian names/IDs. The descriptor
contains no other vault IDs, root paths or foreign note pointers. It is structural
configuration, not a knowledge page. `AGENTS.md` and `vault-schema.md` still apply.

The registry defaults to `~/.config/wiki-master/vaults.json`. An explicit absolute
`WIKI_MASTER_CONFIG` names an alternate file; a missing explicit file is an error.
Its paths belong on the machine, never in a project repository:

```json
{
  "version": 1,
  "defaultVault": "general",
  "vaults": [
    {"id": "general", "path": "<absolute-general-root>", "obsidian": "General"},
    {"id": "docs", "path": "<absolute-docs-root>", "obsidian": "Documentation"}
  ]
}
```

Replace placeholders with real absolute roots. Each ID must match its descriptor.
Use distinct Obsidian selectors and verify the native returned path. Duplicate IDs
or selectors, nested/aliased identical roots, unknown keys/versions, malformed
descriptors and unknown references fail with exit 2. Offline roots are reported as
unavailable; a required unavailable write target fails with exit 1. Neither falls back.

Repository-root `.wiki-master.json` is portable and may be tracked or gitignored:

```json
{
  "version": 1,
  "project": "example-project",
  "documentationVault": "docs",
  "researchVaults": ["general"]
}
```

Only `version` is required. Omitted documentation and research settings inherit
independently from the global default: changing documentation does not change
research. An explicit research list must be nonempty and unique. Route overrides
require a registry. Project identity supports one subproject level, such as
`example-project/server`; absent identity falls back to overview `repo:` discovery
inside the documentation vault. Conflicting identity stops for correction.

The current worktree's file wins, including an invalid file (which fails).
An absent file can inherit the primary checkout's file only if Git verifies that
it is ignored there and both checkouts share a canonical common Git directory.
A tracked primary file missing in the worktree is never inherited. The resolver
reports the actual file and inheritance flag; unsupported layouts get diagnostics
and global configuration rather than a guessed primary checkout.

## Resolve before acting

```sh
node "<absolute-plugin-root>/scripts/context.mjs" --purpose documentation --repo "<repository>" --json
node "<absolute-plugin-root>/scripts/context.mjs" --purpose research --repo "<repository>" --json
node "<absolute-plugin-root>/scripts/context.mjs" --purpose research --repo "<repository>" --select general --json
```

The default purpose is documentation. Repository discovery uses
`WIKI_MASTER_PROJECT_ROOT`, then cwd; explicit nonexistent/nonrepository paths fail.
JSON reports configuration origin, project, documentation, ordered research,
selected target, `selectionRequired` and diagnostics. Each target includes ID,
canonical path, native selector, descriptor path and availability. Reads write no
configuration, log or index. Read the selected root's instructions before edits.

`--select` on **context.mjs**, or request-scoped `WIKI_MASTER_VAULT_ID` on helpers,
selects a permitted research destination. Do not append `--select` to clippers or
other helpers that do not advertise it. Documentation cannot be redirected from its
configured route. Maintenance may select one configured vault; it cannot make a
research or documentation helper evade that helper's route. Bind repository,
registry and selected ID for every helper and restore prior environment afterward,
using [access](../skills/wiki-maintainer/references/access.md#request-binding).
Helpers resolve once and bind children; a later configuration mismatch fails.

Without registry or route overrides, legacy `WIKI_MASTER_VAULT`/home behavior
continues, including strict/test guards. A legacy root may lack a descriptor; reads
report it without creating one. In configured mode root/name variables validate
the selected route and conflict rather than override it. Registration must include
the [legacy environment transition](../skills/wiki-setup/references/routing.md#legacy-environment-transition).

## Research requests and lookup

At request start, one research destination selects itself. Several destinations
require exactly one destination question before external discovery, capture or
ingestion, including named URLs and named clippings. A destination already supplied
for this request is the answer. Retain it through the request and discard it before
the next request. There is no persistent research-write preference.

```sh
node "<absolute-plugin-root>/scripts/search.mjs" "retry budgets" --research --json --limit=10
```

This searches every configured research vault independently, even while a write
destination is pending or selected. `--limit` applies per vault; results stay in
configured order and equal relative paths in different groups remain distinct.
Do not infer `--project` for general evidence lookup. Each group has its own
coverage and index/channel diagnostics. Unavailable or completely failed groups
give aggregate exit 1 with successful groups retained; disclosed lexical-only
degradation can still succeed. Missing/stale indexes do not prove missing evidence.
Outside-root aliases are excluded/unsearched content, never evidence of absence;
internal aliases remain supported. Ordinary search without `--research` keeps its
single-vault shape, using selected maintenance context or documentation/default.

## Self-containment and completion

Raw captures, attachments, source summaries and evidence-dependent derived pages
stay together in the selected research vault. Never create foreign-vault wikilinks,
Markdown file links, Obsidian URI links, embeds or `sources:` references. A missing
local citation cannot be satisfied by a similarly named foreign page. Authored
documents may use learned knowledge and ordinary original-source HTTPS citations.
To store supporting evidence in the documentation vault, first include it in the
research list and select it for a separately authorized original-source capture.
Existing notes and evidence move between vaults only by a transfer (below); there is
no other foreign-note copy, migration or capture bypass.

Graphs, catalogs, logs, indexes, caches and validation remain per vault. Exact-path
filesystem authoring resolves its role first and validates a separate ledger in
each written vault. Helpers enforce their own routes and containment, not arbitrary
host shell writes. Complete and report each written vault separately; a capture
with no wiki-page write needs its verification/log but no refresh. Obsidian Git
owns vault Git operations.

## Transferring content between vaults

`transfer.mjs` copies or moves a bounded selection from one registered vault to
another, for example one project's pages and the evidence behind them into a vault of
their own. Both vaults are named by registry ID; a legacy root must be registered first.

```sh
node "<absolute-plugin-root>/scripts/transfer.mjs" --plan --from general --to docs --seed-folder wiki/authored/example-project --seeds moc/example-project.md
node "<absolute-plugin-root>/scripts/transfer.mjs" --apply --from general --to docs --seed-folder wiki/authored/example-project --seeds moc/example-project.md --expect <plan-id>
```

The selection is the seeds, the pages they link to or cite up to `--depth` hops
(default 1, the direct links), the `wiki/sources/` pages their `sources:` names
(followed until raw), and the raw clippings, attachments and figure renders those
pages cite or embed. Nothing outside it is pulled in, and raw pages never extend it
through their own body links. Vault root files, `log/` and `_templates/` never transfer.

- **The plan writes nothing.** It lists every file with its reason and the page that
  selected it, every changed link, the size, conflicts and blockers, and ends with a plan
  id: a digest of the selection, each file's source and output hash, and the decisions.
- **Links stay inside each vault.** A link to a page outside the selection becomes plain
  text, `label (vault <id>: <path>)`; it never becomes a wikilink, file link, URI, embed or
  `sources:` entry naming the other vault. A link whose bare name would land on a different
  page at the destination gets its full path and keeps its displayed text. A `sources:`
  entry that leaves the selection blocks the transfer instead of being rewritten.
- **Provenance is kept.** Raw files are copied byte for byte. A clipping whose stored text
  does not match its `source-hash` blocks the transfer unless `--allow-hash-mismatch` accepts
  copying it as it is, named in the plan and both log entries; every other copied clipping
  is re-hashed at the destination. Frontmatter, `source-hash` and `source-hashes` are not
  changed. Each vault gets one log entry naming the other vault and the plan id.
- **Apply needs the reviewed plan.** `--apply` takes the same options and
  `--expect <plan-id>`, recomputes the plan and refuses a different id. A destination
  file that differs, a path differing only in letter case, or a file a destination purge
  manifest names is a conflict: refused unless `--on-conflict keep-destination` keeps
  the destination's file. Files are written through a temporary copy and checked before
  they land.
- **Resumable.** Rerunning the same apply after an interruption skips the files already
  there and writes the rest, and never writes a second log entry.
- **Move = verified copy, then a purge.** `--mode move` removes at the source, through one
  purge transaction in `.recycle/`, the seeds and every selected file that no page outside
  the selection links to or cites. A shared page stays in both vaults, with the evidence it
  cites, and the plan names what holds it. The
  manifest names the transfer, and each removed clipping's address is declined at the source as a
  purge declines it, so discovery there does not clip it again; an interrupted removal is finished
  by the same apply, and `purge.mjs --restore <purge-id>` undoes it.
- **Inbound links.** The plan lists every link from a page staying at the source to a page
  the move removes. Apply rewrites each one to plain text naming the page's new vault and
  path, `label (vault <destination>: <path>)`, the treatment outbound links get, before
  anything is removed, so no page left there has a dangling link. Each rewritten page is kept
  as it was in `.recycle/<purge-id>/transfer-originals/`; a restore leaves the rewritten text
  in place. A `sources:` entry naming a removed page blocks the move. Raw bodies and `log/`
  entries are never edited.

Obsidian Git owns each vault's Git operations. Declines, triage
queues, ledgers, caches and indexes stay per vault, and each written vault is refreshed
separately. The procedure, with its single approval, is the maintainer's
[transfer reference](../skills/wiki-maintainer/references/transfer.md).

Native prerequisites explicitly target the selected selector and compare the
returned canonical path. Targeting may activate or open a vault. An open nonactive
target can be addressed; a closed target's first path probe can fail while opening
it. Such a failure is reported, without silent retry or default-vault fallback.
Do not promise preservation of focus or treat opening as successful verification.
