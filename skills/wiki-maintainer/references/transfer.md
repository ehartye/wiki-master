Read directly for this task: [access](access.md), [evidence](evidence.md), [completion](operations.md).
A transfer has one approval, for its reviewed plan. `transfer.mjs` writes one log entry in each vault, so the skill writes no other.

# Copying or moving content between vaults

`transfer.mjs` copies wiki pages and the raw evidence they cite from one registered vault to another, or
moves them. It is the only supported way to put one vault's notes or evidence into another; the
[self-containment rules](evidence.md#self-contained-vaults) still forbid doing it by hand. Use it when the
owner asks to copy, split out or move material into another vault, for example one project's pages into a
dedicated vault.

## What is selected

- **Seeds:** the pages named with `--seeds a.md,b.md` (vault-relative), the pages listed in each
  `--seeds-file <file>`, and every page under each `--seed-folder <folder>`. `--seeds` splits on commas, so
  a page whose name contains a comma goes in a seeds file: a UTF-8 text file outside the vaults, such as a
  temp file, with one vault path per line, taken whole. Blank lines and lines starting with `#` are
  skipped, and CRLF is fine. The script only reads the file. A missing or unreadable file, or one that lists
  no paths, exits 2; a listed path that is not a page is refused like an unknown `--seeds` path. The same
  seeds give the same plan id however they are named. A vault's own root files (`VAULT.md`, `index.md`, `AGENTS.md`), `log/` and
  `_templates/` never transfer.
- **Linked:** pages a selected page links to or cites, up to `--depth` hops from a seed. The default is 1,
  the seeds' direct links; 0 is the seeds only.
- **Cited:** the `wiki/sources/` pages a selected page's `sources:` names, followed until raw, at any depth,
  so every transferred page's provenance resolves in the destination.
- **Evidence:** the raw clippings, attachments and figure renders a selected page cites or embeds.
- **Excluded:** pages matched by `--exclude <pattern>` (repeatable): an exact path, a folder ending in `/`,
  or a glob in which `*` stays inside one path segment and `**` crosses segments. An excluded page is
  outside the selection even when a seed links to it or the seed folder holds it. It is listed in the plan
  with the page that would have brought it in, it stays where it is, and a move never removes it. A pattern
  that matches no page is refused (exit 2), so a typo cannot move a page meant to stay. A `sources:` entry
  naming an excluded page blocks (`provenance-excluded`).
- Nothing else. A link to a page outside the selection becomes plain text, `label (vault <id>: <path>)`,
  never a link to the other vault. A link inside the selection whose bare name would resolve to a different
  page at the destination is given its full path, keeping its displayed text. Links in code stay as written.
  Raw files are copied byte for byte, their own `[[...]]` included.

## Steps

1. **Bind both vaults.** Run `context.mjs --purpose maintenance --select <id> --json` for the source and for
   the destination, read each vault's instructions and descriptor, and confirm both are registered. A vault
   that is not in the registry cannot be named; [wiki-setup routing](../../wiki-setup/references/routing.md)
   registers it. Retain the destination's
   [broken-link count](../../wiki-setup/references/checks.md#purge-broken-link-verification), and the
   source's too for a move.

2. **Plan.**
   `node "<absolute-plugin-root>/scripts/transfer.mjs" --plan --from <source-id> --to <destination-id> --seed-folder <folder> [--seeds <paths>] [--seeds-file <file>] [--depth N] [--mode copy|move]`
   Writes nothing. It lists every file with the reason it was selected and the page that brought it in,
   every link it changes and what the link becomes, the size, and four lists that need a decision:
   - **CONFLICTS:** the destination already has a different file at the path, a path differing only in letter
     case, or a purge in its `.recycle/` that names the file. Refused unless
     `--on-conflict keep-destination`, which leaves the destination's file and transfers the rest.
   - **BLOCKING:** a clipping whose text does not match its `source-hash`, or a `sources:` entry naming a
     page outside the selection. For the second, add the page as a seed (which also brings its direct
     links) or raise the depth. For the first, find out why the text changed; when the owner accepts the
     file as it is, `--allow-hash-mismatch` copies it byte for byte and names it in the plan and both logs.
   - **KEPT** (move only): selected files other than the seeds that a page outside the selection links to
     or cites, such as a concept or source page another project shares, and the evidence a kept page cites.
     They are copied and stay in both vaults. Seeds are always removed.
   - **INBOUND LINKS** (move only): every link from a page staying at the source to a page the move
     removes, with the plain text it becomes, `label (vault <destination>: <path>)`. Apply rewrites them
     before removing anything. A `sources:` entry naming a removed page is BLOCKING (`cites-moved-page`):
     cite another page, or copy instead of moving.

3. **Review, then get one explicit approval.** Read the linked pages, not only their count: a direct link
   from a seed can be another project's page. Strike what does not belong with `--exclude`, by naming the seeds exactly or by
   lowering `--depth`, and plan again. Then present the plan id, the counts by layer and reason, the size,
   the links that become text, the conflicts and their resolution, and for a move what is removed, what is
   kept and which pages there get their links rewritten. Say in the same request that Obsidian Git publishes both vaults on its next run.
   Nothing else asks later.

4. **Apply** with the same options and the reviewed id:
   `node "<absolute-plugin-root>/scripts/transfer.mjs" --apply <same options> --expect <plan-id>`
   Keep any seeds file until the apply is done, unchanged: the apply, and a rerun that finishes it, reads it again.
   It recomputes the plan and refuses if the id differs (something changed since the review: plan again and
   get a new approval). It writes each file through a temporary copy, checks its hash before it lands,
   verifies every transferred file and every clipping's `source-hash` again, then writes the log entries,
   each naming the other vault and the plan id. If it stops partway (exit 1), **run the same apply again**:
   files already there are skipped, and each vault keeps one log entry.

5. **Move only: the removal.** After the copy is verified, the seeds and the other selected files nothing
   outside the selection needs move into the source's `.recycle/` as one purge transaction whose manifest names the transfer.
   First the listed inbound links become plain text; each rewritten page is kept as it was in
   `.recycle/<purge-id>/transfer-originals/`. Then the files move. Each removed clipping's address is declined
   at the source, as a purge does. A file changed since the plan stays where it is and is reported, and so
   does a page changed since the plan, whose links are then not rewritten: repair that page by hand as plain
   text naming the destination vault, never a link. [Validate the rewritten pages](../../wiki-setup/references/validation.md).
   `purge.mjs --restore <purge-id>`, bound to the source vault, undoes the removal; it leaves the rewritten
   links as text and does not touch the destination.

6. **Refresh each written vault** once, with that vault's binding, as [completion](operations.md)
   describes: the destination always, the source after a move. The helper prints both
   commands. Then repeat the broken-link check in each vault and compare with step 1.

7. **Report** the plan id, the counts written, already present, kept and removed, the purge id for a move,
   the link changes, any conflict left as the destination had it, and blockers.

## Afterwards

A copy leaves the project's folder in both vaults, so [wiki-project](../../wiki-project/SKILL.md) asks which
vault to write to until the repository's routing names one. Changing a route is wiki-setup's
[registration](../../wiki-setup/references/routing.md) and needs the owner's acceptance. Each vault keeps its
own declines, triage queue, ledgers and indexes; none of them transfer, and the destination's index is built
by its refresh. Ingest state travels with the files: a clipping keeps its `source-hash` and a source page its
`source-hashes`, so the destination's backlog reads them as the source's did.

## Not supported

Renaming a conflicting file, rewriting Markdown file links or `obsidian://` links, and transferring between
vaults that are not both registered. A vault reached only through a legacy `WIKI_MASTER_VAULT` must be
registered first.
