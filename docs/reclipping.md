# Re-clipping layout-flagged evidence

`apply-reclips.mjs` previews work by default. With no selector it replays pending re-clip/upload dispositions. An explicit request is honored even when a character-only check looks clean. `--include-tabular` also selects captures marked `fidelity: tabular`, `extraction: table-aware` or `extraction: table-flattened`, recursively under `raw/clippings/`.

```sh
node scripts/apply-reclips.mjs --include-tabular
node scripts/apply-reclips.mjs --apply --targets-file targets.json --owned-paths-file owned.json --on-failure quarantine
```

`targets.json` is an exact array of vault-relative clipping paths. `owned.json` is the enclosing operation's exact ownership ledger, including affected summaries/citing pages. The helper refuses out-of-scope paths and reports concurrent edits. It returns changed paths for inspection before the operation commit. Open a scoped vault operation before applying, preserve other writers' files, validate the evidence and derived claims, log, commit and sync using the normal operation contract. The helper does not commit or push.

PDF repairs use the shared `planExtraction` policy and preserve its mode/fidelity floor. `--mode auto|reading-order|table` applies to the selected batch; use a one-item target file when selecting a mode for a particular layout. Do not force reading-order globally merely to clear table warnings. It can flatten genuine tables. `--source-file original.pdf` requires exactly one selected clipping; uploaded originals or unambiguous `--from directory` matches otherwise take precedence over fetching the source URL. Fetches have a timeout/size bound and must return PDF bytes; an HTML landing page cannot masquerade as the original.

Repaired bodies keep the original metadata (including topic, author, creation date, tags and figure references); only extraction, fidelity and content hash are replaced. Matching summary hashes follow the new hash without advancing factual review dates. Hash propagation is bookkeeping, not validation of old summary claims or retained figures: inspect them against the repaired evidence before citing.

A clean reading-order result closes the repair request. A reconstructed true table keeps `fidelity: tabular` and returns `needsReview`; verify row pairings against the original before marking it acceptable. A character check alone cannot certify layout. OCR retains an OCR caution rather than silently becoming high fidelity.

By default failed repairs reopen fidelity review. With explicit `--on-failure quarantine`, an unavailable original or still-unacceptable extraction instead retains the previous raw body and writes `citation-status: quarantined` plus a reason. Directly matched citing pages receive a do-not-cite restriction. The operator must also review indirect citations and unsupported derived claims; matching a path/hash is not a full semantic dependency analysis. The tracked raw marker suppresses the evidence from fidelity, failure and ingest-backlog triage rows, even on another machine with stale local issue history. The local log records dispositions as well. Quarantine is a citation restriction, not successful repair or deletion.

If a returned table cannot be verified after inspection, quarantine that exact target without re-extracting:

```sh
node scripts/apply-reclips.mjs --apply --targets-file one-target.json --owned-paths-file owned.json --quarantine-reason "Row pairings remain unverifiable"
```

This does not erase historical evidence. A later verified replacement needs an explicit decision to remove the quarantine marker and revisit affected citations. Quarantined captures are excluded from automatic selection. Report repaired, verified, quarantined, conflicted and remaining counts separately; never count quarantine as ingestion.
