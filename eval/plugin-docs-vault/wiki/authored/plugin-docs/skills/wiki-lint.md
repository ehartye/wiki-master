---
type: authored
status: maintained
sources: []
ai-generated: true
project: plugin-docs
kind: reference
---

Read [the shared core](../wiki-maintainer/SKILL.md) once per session.
Read [access and host commands](../wiki-maintainer/references/access.md) before touching the vault. Also read for this operation: [evidence](../wiki-maintainer/references/evidence.md), [efficacy](../wiki-maintainer/references/efficacy.md), [operations](../wiki-maintainer/references/operations.md).
Load the rest only when this run reaches it — [maintenance](../wiki-maintainer/references/maintenance.md) when a structural repair, migration or backfill is actually indicated.
Before the first authorized write, follow the shared operations completion contract; reuse existing session authorization.

1. Run `/wiki-health` first: `node "<absolute-plugin-root>/scripts/health.mjs"`. Stop for an empty
   wiki. A clean graph does not skip semantic review: sample changed or high-use
   pages for stale claims, contradictory evidence and missing useful connections.
   Route structural integrity findings to [wiki-repair](../wiki-repair/SKILL.md)
   within the authorized scope; keep unresolved navigation outside defect counts.
   Keep the sample bounded and report its size. Open an operation only before
   making edits:
   `node "<absolute-plugin-root>/scripts/op-begin.mjs" --op lint` — records what was already
   uncommitted, so step 6 commits your fixes and not the user's in-progress work.
2. Run `node "<absolute-plugin-root>/scripts/drift.mjs" --coverage`, then a bounded embedding check:
   `node "<absolute-plugin-root>/scripts/drift.mjs" --limit=10`. Read eligible/evaluated/failed/skipped
   counts. Zero evaluated is not a clean result; report missing evidence or backend
   failures. Similarity is a topical diagnostic, never proof of claim correctness.
3. Run the content lint: `node "<absolute-plugin-root>/scripts/lint.mjs"` (warn-only,
   never scored; `--json` for the full list, `--tier=convention|gapped|unverified`,
   `--page=<substr>`, `--full` for untruncated quotes). It sorts each quote the
   verbatim check cannot place into a tier and leads with the counts. How quotation
   marks pair (curly marks nest, straight marks alternate) and which spans the style
   flags skip are in `<absolute-plugin-root>/README.md`, section "Content lint":
   - **convention** — the evidence has the same words in the same order; markup,
     punctuation or extraction spacing differ. Counted, not listed; leave it unless
     the count jumps.
   - **gapped** — every quoted word is in the evidence in order, with extra evidence
     words between them, which are listed. A header, timestamp or citation is
     extraction noise. A dropped clause or two joined sentences is a silent omission:
     restore the words or add an ellipsis. Read each inserted run.
   - **unverified** — a word is changed, added, reordered or negated (so is a dropped
     negation or operator), or the page's evidence trail does not hold the text.
     `--near` prints, for unverified quotes of six or more words that align with a
     raw clipping at 0.85 or better, a word diff (`[-word-]` the page added,
     `{+word+}` only the clipping has): read those first. Each is a quotation with a
     small difference; a corrected typo is benign, a changed meaning is not. A quote
     it does not list is usually the page's own wording, but a low score is no proof.
     Adjudicate a bounded sample and report its size: real drift gets fixed against
     the clipping (guardrail #5); the wiki's own wording, mention quotes and
     retracted claims are conventions to ignore; claims the vault genuinely doesn't
     hold get marked unsourced on the page. Confirm the trail itself resolves (an
     ambiguous or misrouted citation) before editing a quote. Two-column captures
     with interleaved text land here too.
   Scope the run to the work: `--updated-since=<YYYY-MM-DD>` for the pages edited
   since a date, `--paths-file=<ledger>` for the pages a task wrote (both may be
   given). The graph is still built whole, so a scoped run saves the quote checks,
   not the first twenty seconds. Record what you read, so the next run does not
   list it again: `lint.mjs --ids` shows each finding's id, then
   `node "<absolute-plugin-root>/scripts/lint-disposition.mjs" record --ids=<id>,<id>
   --disposition=own-wording|mention|title|markup|accepted --reviewer=<name>
   (--page=<path> | --paths-file=<ledger> | --whole-vault)`. Use `fixed` only for a
   quote you corrected (a finding still present after `fixed` is listed again). The
   verdicts are lines in `lint-dispositions.jsonl` at the vault root; add that file
   to the operation's ledger. A changed quote or a replaced clipping is a new
   finding and needs a new reading. `--include-reviewed` lists the reviewed ones.
   Style flags per the v0.2.2 licenses are pointers for review, not violations.
4. Read the flagged pages (orphans, hub-stubs, drifted). Look for: contradictions
   between pages, claims superseded by newer sources, concepts referenced but
   unwritten, and missing cross-references.
5. Apply only safe, unambiguous fixes; present the rest as a proposed change list
   for the user to approve when not already authorized. Set `updated` on edited
   pages; stamp `reviewed` only where claims were actually verified against their
   evidence or current project behavior. Mechanical links, aliases and formatting
   preserve prior `reviewed` dates. Record what was checked and what remains
   uncertain. If no edits are applied, return the report without a log or operation.
   For applied fixes, validate links and refresh affected catalogs; write the log entry:
   `node "<absolute-plugin-root>/scripts/log-entry.mjs" --op lint --title "<summary>"` (details on stdin).
6. Close the operation:
   `node "<absolute-plugin-root>/scripts/op-commit.mjs" --op lint --title "<summary>" --since <saved-token>`
   A lint that applied fixes and did not commit them leaves the vault changed with
   no record — the failure `/wiki-purge` was built to end. The helper does not push; push and verify remote publication through the shared contract.
