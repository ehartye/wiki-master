# Changelog

## 0.4.0 — 2026-07-21

### Ingest-state tracking moves to a content-hash join

The ingest backlog is now computed by matching each clipping's `source-hash`
against the `source-hashes` recorded on `wiki/sources/` pages, instead of testing
whether a `[[wikilink]]` resolves. This fixes two false-positives that inflated the
backlog (172 phantom items on the reference vault, ~0 real):

- **Hash-suffix mismatch** — a summary citing `[[Title]]` never resolved to the
  clipping file `Title-<hash7>.md`. Hash equality is immune to the suffix.
- **Binaries counted as sources** — `.pdf/.xlsx/.zip` originals can never be a
  summary target; only `.md` clippings are now in the backlog universe.

It also delivers **re-ingest-on-change** for free (a re-clipped source gets a new
hash and reappears in the backlog) and adds two health metrics: `missingHash`
(clippings lacking a `source-hash`) and `backfillPending` (migration progress).

New frontmatter: `wiki/sources/` pages carry `source-hashes: [<sha256>, …]`. The
`sources: [[…]]` wikilink is retained for navigation. See
`docs/superpowers/specs/2026-07-21-hash-ingest-state-design.md`.

### Migrating existing vaults — run once per vault

A vault written before this release has source pages without `source-hashes`. A
transitional fallback keeps them credited (nothing regresses), but the backlog will
show phantom items again until the vault is migrated. **Agents: repair the vault by
running the one-time backfill.** From the plugin root:

```
node scripts/backfill-source-hashes.mjs            # dry-run: prints the plan + review queue
node scripts/backfill-source-hashes.mjs --apply    # writes source-hashes into wiki/sources/*.md
```

(The script resolves the vault via `WIKI_MASTER_VAULT`, default `~/.wiki-master-vault`.)

It is **idempotent** (only fills pages still missing the key) and **guesses
nothing**: ambiguous or unresolved citations are reported for human review, never
written. Expected benign residual — citations to binary originals (`unresolved`) and
clippings with no `source-hash` (`nohash`).

- **If your vault is git-synced across machines:** run the backfill on one machine
  and commit the vault. Every other machine is then already repaired — the
  `source-hashes` live in the vault's markdown, not in the plugin — so no per-machine
  action is needed beyond pulling the vault.
- **If machines hold independent (unsynced) vaults:** run it once on each machine.
- **Verify:** a health run should show `backfillPending` approaching 0 and the ingest
  backlog dropping to its true residual.

A follow-up release will remove the transitional link-resolution fallback once
vaults are expected to be migrated (track readiness via `backfillPending`).
