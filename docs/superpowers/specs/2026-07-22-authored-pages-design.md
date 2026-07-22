# `wiki/authored/` — original, no-provenance pages — Design Spec

**Date:** 2026-07-22
**Status:** Implemented (v0.6.0)
**Author:** Design conversation with @Eric-Hartye_HON

---

## 1. Summary

Add a fifth wiki page category, `wiki/authored/` (`type: authored`), for content the vault holds
as a **primary artifact in its own right** — advisory documentation, policy, house style, or any
other original work written directly into the wiki — rather than as a summary or analysis derived
from a captured `raw/` source.

The user's ask, restated: "I want to author original documents into the wiki without them having
to have a provenance... a living document... I need advisory documentation... without them tracing
back to something in raw."

## 2. What already existed (no new mechanism required)

The vault already has a way for a page to **disclose** that it rests on no external artifact:
`sources: []` (an explicit empty list, distinct from omitting the key). `graph.mjs` treats this as
`declaresNoSources`, and both `provenanceGaps` (source pages) and `unreachableProvenance` (every
other wiki page) already exclude declaring pages from the score, reporting them instead as
informational `declaredNoProvenance` — "visible, but not a defect" (`graph.mjs:296-301`).

Verified directly (scratch vault, not committed): a `sources: []` page under any `wiki/` subfolder,
including a brand-new one, is *already* excluded from `provenanceGaps`/`unreachableProvenance` and
appears only in `declaredNoProvenance`. **No change to the scoring engine was needed for the
no-provenance requirement itself** — `needsTrail`/`isSourcePage`/`isEvidencePath` key off path
prefixes and `declaresNoSources`, never off a fixed folder allowlist.

What was missing was **ergonomics and a first-class identity**: a page type is currently an
easy-to-miss edge case of an existing field (nothing prompts an author to set `sources: []`
deliberately), has no dedicated catalog section, and — critically — a real gap: `checkQuotes`
(quote-lint) does not consult `declaresNoSources` at all, so any ≥5-word quotation on a
declared-no-provenance page is flagged as unverifiable against zero evidence, 100% false-positive
by construction. Confirmed live:

```
sources: []            body: quoting "a regulation phrase that runs five or more words long"
→ checkQuotes finding: { page, quote, checked: 0 }   // false positive
```

## 3. Decision: folder/type name

| Option | Pro | Con |
|---|---|---|
| `advisory` | Matches the user's own example verbatim; immediately legible | Narrower than the actual ask — "original documents" in general, of which advisory docs are one instance |
| **`authored` (chosen)** | Generic: covers advisory docs, policy, style guides, or any other primary work written directly into the vault, under one mechanism | Slightly more abstract; requires the "what goes here" explanation to do a bit more work |

**Chosen: `authored`.** Confirmed with the user.

## 4. Decision: provenance mechanism

**Reuse `sources: []`** (no new frontmatter concept). It is already implemented, already tested, and
its semantics ("an internally-derived page... stating it has no external artifact",
`graph.mjs:117-121`) match exactly. Authored pages simply adopt an existing disclosure as a
by-convention default, the same way `wiki/sources/` pages adopt `source-hashes`. Introducing a
second "no provenance" flag would fork one concept into two spellings for no benefit.

## 5. Decision: style/tone license

| Option | Behavior |
|---|---|
| Restrained (`wiki/concepts/` license) | Flags `editorializing`, `weasel` — wrong fit: advisory content is *supposed* to be directive ("must", "should", "do X") |
| **Permissive, like `wiki/syntheses/` (chosen)** | `[]` — no style flags. Authored pages are the vault's own first-party voice, same license as syntheses' "weigh, judge, conclude" |

**Chosen: permissive (`[]`)**, added to `lint.mjs`'s `LICENSE` map alongside syntheses. (Before this
change, an unlisted directory received zero style checking by default — same net effect, but
implicit; making it an explicit map entry documents the decision instead of leaving it an accident
of the LICENSE map only covering four directories.)

## 6. Changes

### 6.1 Schema / scaffold
- `scripts/init.mjs`: add `wiki/authored` to `DIRS` so `/wiki-init` scaffolds it.
- `templates/_templates/authored-note.md`: new starter template — `type: authored`, `sources: []`
  pre-filled (the deliberate default), no "Key claims" heading (that heading implies claims
  extracted from a source; authored pages assert their own).
- `templates/vault-schema.md`: layout line gains `wiki/sources|entities|concepts|syntheses|authored`;
  a short note under Rules that authored pages are the disclosed exception to "every wiki page cites
  its raw/ provenance."
- `skills/wiki-maintainer/SKILL.md`: vault contract folder list and `type` enum both gain `authored`;
  guardrail #2 gets a one-line carve-out; per-type license list gains `wiki/authored/`; a short
  "Authored pages" note clarifies when to use the category and that `ai-generated` still records
  actual authorship (`true` for agent-drafted, `false` for human-written) independent of the
  provenance disclosure.
- `README.md`: vault layout diagram and the provenance sentence both note the exception.

### 6.2 Catalog
- `scripts/index-gen.mjs`: `SECTIONS` gains `['authored', '## Authored']` (placed after Syntheses —
  both are primary-voice content, as opposed to the derived source/entity/concept tiers).

### 6.3 Lint (bug fix, tightly coupled to this change)
- `scripts/lint.mjs`:
  - `checkQuotes` skips any page with `declaresNoSources` — verification is inapplicable by the
    page's own declaration, not merely unproven. Without this, the first authored page to quote
    anything (e.g. citing a line from a regulation inline, as commentary rather than as a claim
    resting on it) lights up `/wiki-lint` with unfixable false positives.
  - `LICENSE` map gains `'wiki/authored/': []`.

### 6.4 No change needed
- `scripts/lib/graph.mjs`: provenance scoring, `isContent`, `isEvidencePath`, catalog inclusion via
  `isContent` — all already folder-prefix-generic or declaration-driven. Verified by test (§7).

## 7. Test plan

1. **Provenance (regression/contract, `reachability.test.mjs`):** a `wiki/authored/*.md` page
   declaring `sources: []` is reported in `declaredNoProvenance`, absent from
   `unreachableProvenance` — generalizing the existing "any wiki page" test to prove the contract
   isn't folder-allowlisted.
2. **Quote false-positive fix (`lint.test.mjs`):** a fixture page under a declared-no-provenance
   folder with a genuine ≥5-word quotation produces **no** `checkQuotes` finding.
3. **Style license (`lint.test.mjs`):** `wiki/authored/` prose using editorializing/weasel/puffery
   language produces **no** `checkStyle` finding (permissive license applied).
4. **Catalog (`index-gen.test.mjs`):** a `type: authored` page renders under `## Authored`.
5. **Scaffold (`init.test.mjs`):** `scaffold()` creates `wiki/authored`.

## 8. Out of scope

- Any notion of page "versioning" or per-page changelog — "living document" here means: it lives
  under `wiki/` (the mutable tier) rather than `raw/` (the frozen tier), same as every other wiki
  page; no new mutability mechanism is introduced because none was missing.
- Enforcing that authored pages set `sources: []` (vs. leaving the key absent, which would correctly
  surface them as `unreachableProvenance`). This is deliberate: forgetting the disclosure should
  still be caught by the existing check, the same forcing function every other wiki page gets.
