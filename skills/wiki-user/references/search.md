# Find pages and passages

Resolve the plugin root from this skill's installed `SKILL.md`: two parents above
its containing folder. From this reference file, it is three parents above its
containing folder. Use quoted absolute helper paths, never workspace-relative
`scripts/` paths. The vault is `WIKI_MASTER_VAULT`, default `~/.wiki-master-vault`;
start at that known root and read applicable vault instructions. A configured
`WIKI_MASTER_REQUIRE_VAULT=1` requires an explicit vault. Do not scan the user
profile or require a running Obsidian app.

1. Run a bounded search, replacing the path placeholder with the installed root:

   ```sh
   node "<absolute-plugin-root>/scripts/search.mjs" "search terms" --json --limit=10
   ```

   The default scopes are `wiki/` and `moc/`. Add `--include-raw` explicitly for
   evidence lookup; raw is excluded by default. Use `--project=<slug>`,
   `--type=<type>` or `--status=<state>` only when the request establishes scope.
   For a different vault, set `WIKI_MASTER_VAULT` for the command's scope and
   restore its prior value afterward; [access](../../wiki-maintainer/references/access.md#shell-portability)
   has shell-specific examples if needed.
2. Read stderr status and JSON `channels`, `diagnostics` and freshness metadata.
   Disclose non-`hybrid` search and failed channels even in a hybrid run. Lexical
   results are real, but semantic ranking contributed nothing. A failed primary
   `wiki/` scan means incomplete coverage; a failed raw scan means **not searched**,
   not zero evidence. Report the raw hit count when requested, including zero.
   Missing or stale indexes and zero hits never establish that the vault knows
   nothing. `search.mjs --health` reports coverage without repairing it.
3. Open the returned exact path at the matched line and read the surrounding
   passage. Exact titles and equivalent aliases are prioritized; disambiguate
   similarly named pages by full path and context. Inspect page status, review
   dates and decision/backlog state before describing a proposal as shipped.
   Healthy channels establish neither relevance nor factual support.
4. Return citation-ready paths and lines. For the raw source behind a wiki page,
   run `node "<absolute-plugin-root>/scripts/resolve-evidence.mjs" "wiki/sources/Example.md:23"`.
   A citation route is not proof of a claim: before quoting or synthesizing, read
   [evidence](../../wiki-maintainer/references/evidence.md) and verify the source.
   For a narrative answer use [query](query.md).

If a channel fails, use available results and bounded filesystem `rg` over `wiki/`
and `moc/`; include `raw/clippings/` only for evidence lookup and disclose missing
coverage. Never read, cite or count `.recycle/`. Exclude dot folders, dependencies
and binary originals. Resolve paths within the known vault root.

This mode never writes content, opens operations, logs, commits or refreshes
indexes. Read [search details](search-details.md) only for ranking diagnostics,
evidence-route output, backlog listing or remediation guidance. Reporting a
degraded channel does not authorize running its repair commands.
