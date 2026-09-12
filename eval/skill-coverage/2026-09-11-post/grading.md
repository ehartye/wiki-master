# Post-change verification: conditional reference loading

Each spoke skill previously opened with an unconditional instruction to read three to five
shared references. That defeated the tiering the core already describes ("Load the directly
linked references required by your operation, not every reference for a simple lookup"):
twelve spokes overrode it with a fixed list. This run verifies the fix did not thin behavior.

## Method

The only thing that changed is skill-body preamble text. **The without condition loads no
skill bodies, so it is unaffected by construction** — re-running it would measure nothing.
Both post-change runs are therefore single-condition reports (`--traces`), compared against
the with-condition scores from the same rubrics earlier the same day.

Rather than hand-picking which references to supply, the actors were given the core, the
owning skill body, and read access to every reference, and were told to follow the
preamble's conditions honestly — reading what fires, skipping what does not, and reporting
both. Their routing judgment is itself part of what is under test. Two observers who wrote
neither transcript graded them, each told explicitly to be alert for thinner evidence,
lifecycle or maintenance handling and not to paper over a gap.

| Pair | Pre-change (with) | Post-change (with) | Forbidden actions |
|---|---|---|---|
| Frozen eight | 8/8, 32/32 actions | **8/8, 32/32 actions** | 0 → 0 |
| Coverage five | 5/5, 23/23 actions | **5/5, 23/23 actions** | 0 → 0 |

## Routing behaved as designed

Across thirteen scenarios every unconditional reference was read, one conditional reference
was read because its condition genuinely fired (`maintenance.md` for `relink-scope` —
wrapped links, title-shaped citations and `sources:` ordering are three of that scenario's
four defect classes), and seven conditional reads were skipped. No reference was read "to be
safe", and each skip cited the condition text and named what would make it fire later.

The observers' own words: lifecycle discipline is "explicit in both directions" — operations
opened with token, log and `op-commit --since` where a write occurs, and *deliberately not*
opened in read-only scenarios with a stated reason rather than by omission. Evidence
handling stayed concrete: `resolve-evidence.mjs` actually run, the degraded-capture scope
edge drawn correctly, absence of support explicitly not equated with falsity.

## Disclosed judgment calls

- **Coverage / `purge-orphan-lineage`:** `reconcile-first` appears in the stated continuation
  path, because the run correctly stops at the orphaned-lineage blocker and says it will not
  run `--reconcile` there (it commits). The observer counted it since the continuation names
  the script, its position before `--plan`, and its commit ownership; maximum strictness
  would score that 5/6. The scenario passes either way on the stop being correct.
- **Frozen / `authorized-discovery`:** `validate` rests on clipping-path validation plus
  later changed-path verification, thinner than `offline-author`'s dedicated validation step.
- **Frozen / `uncertain-write`:** `reconcile-operation` is carried by the `op-begin`/dirty-path
  interaction and a four-way branch on what inspection finds, rather than a named procedure.

## Limits

- Single samples in simulation mode; no vault, Git or converter executed.
- **Still not an activation test.** Skills were selected from the catalog by the actor, but
  bodies were reachable on disk rather than loaded by a live skill loader.
- **Per-session savings are smaller than the per-invocation figures suggest.** The frozen-eight
  actor disclosed that `evidence.md` was already in context from an earlier scenario when it
  reached `lookup`, so that skip avoided a re-read, not a first read. The core says to read
  itself once per session; references accumulate the same way. The per-invocation numbers
  describe a cold start, which is the common case for a single request, not an eight-scenario
  session.
- One conditional trigger never fired anywhere in thirteen scenarios (`maintenance.md` for
  `wiki-ingest`, whose backlog-join path needs an empty-argument run). Untriggered is not the
  same as wrongly specified, but it is also not evidence the trigger works.
