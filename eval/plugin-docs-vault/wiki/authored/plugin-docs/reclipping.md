---
type: authored
status: maintained
sources: []
ai-generated: true
project: plugin-docs
kind: reference
---

# Re-clipping layout-flagged evidence

`apply-reclips.mjs` previews work by default. With no selector it replays pending re-clip/upload dispositions. An explicit request is honored even when a character-only check looks clean. `--include-tabular` also selects captures marked `fidelity: tabular`, `extraction: table-aware` or `extraction: table-flattened`, recursively under `raw/clippings/`.

```sh
node scripts/apply-reclips.mjs --include-tabular
node scripts/apply-reclips.mjs --apply --targets-file targets.json --owned-paths-file owned.json --on-failure quarantine
```

`targets.json` is an exact array of vault-relative clipping paths. `owned.json` is the enclosing operation's exact ownership ledger, including affected summaries/citing pages. The helper refuses out-of-scope paths and reports concurrent edits. Cooperating apply sessions reserve an OS gate per vault before asynchronous fetching; the reservation is released on exit rather than leaving a stale lock file. An interrupted update retains a machine-local transaction under `.wiki-master/reclip-transactions/`; rerunning the same target resumes its saved hash transition without extracting again. Recovery rechecks newly added dependencies and refuses an incomplete ownership ledger. Do not commit or sync partial/conflicted updates until that transaction finishes. It returns changed paths for inspection before the operation commit. Open a scoped vault operation before applying, preserve other writers' files, validate the evidence and derived claims, log, commit and sync using the normal operation contract. The helper does not commit or push.

PDF repairs use the shared `planExtraction` policy and preserve its mode/fidelity floor. `--mode auto|reading-order|table` applies to the selected batch; use a one-item target file when selecting a mode for a particular layout. Do not force reading-order globally merely to clear table warnings. It can flatten genuine tables. `--source-file original.pdf` requires exactly one selected clipping; uploaded originals or unambiguous `--from directory` matches otherwise take precedence over fetching the source URL. Fetches have a timeout/size bound and must return PDF bytes; an HTML landing page cannot masquerade as the original.

Repaired bodies keep the original metadata (including topic, author, creation date, tags and figure references); only extraction, fidelity and content hash are replaced. Matching summary hashes follow the new hash without advancing factual review dates. Hash propagation is bookkeeping, not validation of old summary claims or retained figures: inspect them against the repaired evidence before citing.

A clean reading-order result closes the repair-related issue kinds; unrelated attention decisions are preserved. A reconstructed true table keeps `fidelity: tabular` and returns `needsReview`; verify row pairings against the original before marking it acceptable. A character check alone cannot certify layout. A clean OCR recovery likewise enters review with its OCR caution intact, rather than being discarded or silently becoming high fidelity.

By default failed repairs reopen fidelity review. With explicit `--on-failure quarantine`, an unavailable original or still-unacceptable extraction instead retains the previous raw body and writes `citation-status: quarantined` plus a reason. Citing pages resolved by the existing path/alias identity resolver, or matched through source hashes, receive a do-not-cite restriction before the raw quarantine marker is finalized. The operator must also review indirect citations and unsupported derived claims; matching a path/hash is not a full semantic dependency analysis. The tracked raw marker suppresses the evidence from fidelity, failure and ingest-backlog triage rows, even on another machine with stale local issue history. The local log records dispositions as well. Quarantine is a citation restriction, not successful repair or deletion.

If a returned table cannot be verified after inspection, quarantine that exact target without re-extracting:

```sh
node scripts/apply-reclips.mjs --apply --targets-file one-target.json --owned-paths-file owned.json --quarantine-reason "Row pairings remain unverifiable"
```

This does not erase historical evidence. A later verified replacement needs an explicit decision to remove the quarantine marker and revisit affected citations. Quarantined captures are excluded from automatic selection. Report repaired, verified, quarantined, conflicted and remaining counts separately; never count quarantine as ingestion.

## Web pages

A clipping made by `clip.mjs` takes the same transaction (ledger, dry run, journal, quarantine, hash propagation) through a different reader. It is recognised by an http(s) source that does not look like a PDF and has no PDF extraction mark (`extraction` absent or `rendered`). The page is fetched again through the clipper's own ladder, a static read and then a browser render when the text is thin, without the clipper's side effects: no decline and no triage row. `--kind auto|pdf|html` overrides the routing; use it for a PDF served from an address that does not say so, or to read a page the router took for a PDF. A PDF address given `--kind html` is refused.

```sh
node scripts/apply-reclips.mjs --targets-file one-page.json            # dry run
node scripts/apply-reclips.mjs --apply --targets-file one-page.json --owned-paths-file owned.json
```

What differs from a PDF repair:

- **A page can have changed since it was clipped, and summaries quote the old text.** The new text must still hold at least 80% of the old, counted in eight-word windows after the lint's normalisation (case and markup do not count). Below that the page is not replaced, the failure reopens fidelity review, and the message says how much was kept. A rewrite you want is a new clip, not a repair. The 80% was set on 42 real pages: 37 kept at least 90%, two kept 88 and 89%, and three kept 65 to 74%.
- **The same body again is `unchanged`.** Nothing is rewritten and no row is opened or closed.
- **A read that still has fidelity warnings replaces the body and goes to review**, as a reconstructed table does: verify against the page before marking it acceptable.
- **The glyph checks that read a PDF text layer are not applied to a page**; URLs and query strings would trip them.
- **Only `source-hash`, `fidelity`, `extraction`, `fidelity-checks` and `fidelity-ignored` change**; the title, source, author, dates, tags, quality and topic are kept.
- **A page that needs a browser fails without one**; the report names the reason and nothing changes.
- **The old body is not kept beside the new one.** The vault's git history holds it, and summary hashes follow the new hash as for a PDF, without advancing factual review dates. Check the summaries' quotes against the new text before citing.
