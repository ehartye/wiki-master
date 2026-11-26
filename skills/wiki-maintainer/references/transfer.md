Read directly for this task: [access](access.md), [evidence](evidence.md), [completion](operations.md).
A transfer has one approval, for its reviewed plan. `transfer.mjs` writes one log entry in each vault, so the skill writes no other.

# Copying or moving content between vaults

`transfer.mjs` copies wiki pages and the raw evidence they cite from one registered vault to another, or
moves them. It is the only supported way to put one vault's notes or evidence into another; the
[self-containment rules](evidence.md#self-contained-vaults) still forbid doing it by hand. Use it when the
owner asks to copy, split out or move material into another vault, for example one project's pages into a
dedicated vault.

## What is selected

- **Seeds:** the pages named with `--seeds a.md,b.md` (vault-relative) and every page under each
  `--seed-folder <folder>`. A vault's own root files (`VAULT.md`, `index.md`, `AGENTS.md`), `log/` and
  `_templates/` never transfer.
- **Linked:** pages a selected page links to or cites, up to `--depth` hops from a seed. The default is 1,
  the seeds' direct links; 0 is the seeds only.
- **Cited:** the `wiki/sources/` pages a selected page's `sources:` names, followed until raw, at any depth,
  so every transferred page's provenance resolves in the destination.
- **Evidence:** the raw clippings, attachments and figure renders a selected page cites or embeds.
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
   `node "<absolute-plugin-root>/scripts/transfer.mjs" --plan --from <source-id> --to <destination-id> --seed-folder <folder> [--seeds <paths>] [--depth N] [--mode copy|move]`
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
   - **COLLATERAL** (move only): pages staying at the source that link to removed pages.

3. **Review, then get one explicit approval.** Read the linked pages, not only their count: a direct link
   from a seed can be another project's page. Strike what does not belong by naming the seeds exactly or
   lowering `--depth`, and plan again. Then present the plan id, the counts by layer and reason, the size,
   the links that become text, the conflicts and their resolution, and for a move what is removed, what is
   kept and the collateral. Say in the same request that Obsidian Git publishes both vaults on its next run.
   Nothing else asks later.

4. **Apply** with the same options and the reviewed id:
   `node "<absolute-plugin-root>/scripts/transfer.mjs" --apply <same options> --expect <plan-id>`
   It recomputes the plan and refuses if the id differs (something changed since the review: plan again and
   get a new approval). It writes each file through a temporary copy, checks its hash before it lands,
   verifies every transferred file and every clipping's `source-hash` again, then writes the log entries,
   each naming the other vault and the plan id. If it stops partway (exit 1), **run the same apply again**:
   files already there are skipped, and each vault keeps one log entry.

5. **Move only: the removal.** After the copy is verified, the seeds and the other selected files nothing
   outside the selection needs move into the source's `.recycle/` as one purge transaction whose manifest names the transfer.
   Each removed clipping's address is declined at the source, as a purge does. A file changed since the plan stays where it is and is reported. Repair the
   collateral pages' hand-written text as plain text naming the destination vault, never a link, and
   [validate those paths](../../wiki-setup/references/validation.md). `purge.mjs --restore <purge-id>`,
   bound to the source vault, undoes the removal; it does not touch the destination.

6. **Refresh each written vault** once, with that vault's binding, as [completion](operations.md)
   describes: the destination always, the source after a move or a collateral repair. The helper prints both
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
