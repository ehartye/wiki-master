Read directly for this operation: [access](access.md).
Select the calling workflow before mutations; CLI syntax alone does not authorize writes.

# Driving the Obsidian CLI

The vault is targeted by name: `obsidian vault=<name> <command> ...`. wiki-master
resolves `<name>` from `WIKI_MASTER_VAULT_NAME` or the vault folder's basename, and
its **filesystem path** from `WIKI_MASTER_VAULT`, defaulting to `~/.wiki-master-vault`
(this convention lives in `scripts/lib/vault.mjs` — the bundled scripts use it, so
`node "<absolute-plugin-root>/scripts/health.mjs"` and friends need no path argument). Start there rather than
searching the disk for the vault.
`file=` resolves by name (like wikilinks); `path=` is an exact vault-relative path.
Invoke commands through `node "<absolute-plugin-root>/scripts/obsidian.mjs" <command> ...`
or the `scripts/lib/vault.mjs` API. Never bypass it with native CLI calls or run
parallel native commands. The shared lock has a bounded wait; busy means not sent.
Oversized or physically multiline requests are rejected before launch. Ordinary
Markdown bodies go through filesystem editing, even when the CLI works. Do not
chunk a rejected note into repeated CLI writes. Inspect the exact target first if
an earlier write's outcome is uncertain. See the directly linked access contract.
The guarded `vault info=path` command can confirm the root
when the app responds; the known configured/default root supports filesystem access
without that probe.

## Access failures and empty results

Use the direct [app-access diagnosis](../../wiki-setup/references/app-access.md) for Windows invocation, lazy canary checks, failure/refusal and uncertain mutations. Do not probe before every action; no app is required for independent filesystem work. Before retrying any timed-out mutation, inspect the actual target.

## Syntax and the live contract
- **Parameters take `=`; flags are bare.** `create name="My Note" content="Hello"`
  vs `create name=Note open overwrite`. `\n` / `\t` for multiline content.
- **`vault=<name>` must be the first parameter**, before the command.
- **`format=` is a parameter, not a flag**, and its default varies per command —
  `search` defaults to `text`, `backlinks`/`tags`/`properties` to `tsv`,
  `base:query` to `json`. Never assume JSON; ask for it.
- **`node "<absolute-plugin-root>/scripts/obsidian.mjs" help` outranks the docs.** Obsidian's own skill says it "is always
  up to date" — so when the published reference and the binary disagree, the
  binary wins. Check `node "<absolute-plugin-root>/scripts/obsidian.mjs" help <command>` before concluding a flag is gone.
- Prior art worth comparing against: kepano (Obsidian's CEO) publishes a
  first-party `obsidian-cli` Agent Skill. Where it and this skill agree — `total`
  for counts, `file=` vs `path=`, vault-first ordering — the agreement is
  independent corroboration, not inheritance.

## Read / search
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" read path=wiki/concepts/alpha.md`
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" search query="tag:clippings neural" path=wiki limit=10 format=json`
- Scope to `path=wiki` by default — `raw/` holds immutable source dumps (one
  clipping can contain a long document) and belongs in results only when asked.
- Probe cost before fetching: `node "<absolute-plugin-root>/scripts/obsidian.mjs" search query="..." total` (a count only).
- **Never default to `search:context`** — it returns every matching line from
  every file, and
  `limit=` bounds files, not lines, so it cannot save you. Escalate to
  `search:context` only with both `path=` and a narrow query.

## Links & graph
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" backlinks file=alpha counts` — who links here
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" links file=alpha` — outgoing links
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" unresolved verbose format=json` — broken links WITH source files.
  The bare form returns targets only; `verbose` is the difference between a
  defect you can act on and a string you can't attribute. Several subcommands
  have lossy defaults with a `verbose` escape — prefer `format=json verbose`.
- For content health use the direct [filesystem checks](../../wiki-setup/references/checks.md#health-and-ingest-backlog), not app `orphans`/`deadends` as repair metrics.

## Typed properties (frontmatter)
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" property:set name=reviewed value=2026-07-15 type=date path=wiki/concepts/alpha.md`
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" property:read name=reviewed path=...`
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" properties path=...` — list a note's properties

## Create / edit / move
- Create, replace or append ordinary Markdown through exact-path filesystem edits
  under the known root, using the shared operation lifecycle. Preserve current
  content and raw evidence. Do not send substantial text through the CLI.
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" move file=foo to=wiki/entities`

## Tags, tasks, templates, bases
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" tags counts` · `node "<absolute-plugin-root>/scripts/obsidian.mjs" tag name=neural verbose`
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" base:query file=stale.base view=all format=json`
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" template:insert name=source-note`

## Escape hatches
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" command id=<id>` — run any Obsidian command (`node "<absolute-plugin-root>/scripts/obsidian.mjs" commands` to list)
- `node "<absolute-plugin-root>/scripts/obsidian.mjs" eval code="<js>"` — arbitrary JS in app context (last resort).
  **This is remote code execution against the vault**, and it sits in the same
  namespace as the read-only subcommands: a blanket `node "<absolute-plugin-root>/scripts/obsidian.mjs" *` permission grant
  covers it. It belongs in its own permission decision, not folded in with
  `search` and `read`. The same applies to `dev:cdp` and `dev:debug`.

If a command fails, report its diagnostic and use
[app failure recovery](../../wiki-setup/references/app-access.md#failure-refusal-and-uncertain-mutation).
Never claim a filesystem fallback performed an app-only action. For content
mutations, retain [operation completion](operations.md) and direct
[scoped validation](../../wiki-setup/references/validation.md); UI-only actions do
not manufacture content operations.
