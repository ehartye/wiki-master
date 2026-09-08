# Evidence and editorial policy

## Non-negotiable guardrails
1. **`raw/` bodies are immutable.** Read raw sources; never edit their content —
   it is the evidence every wiki page cites. Frontmatter is pipeline state and
   may be updated by wiki-master tooling only.
2. **Provenance on every claim.** Each wiki page you write carries `sources: ["[[...]]"]`
   linking back to the `raw/` notes it derives from, plus `ai-generated: true`.
   **Exception: `wiki/authored/`** — original content with no `raw/` counterpart
   (advisory documentation, policy, house style) declares this explicitly via
   `sources: []`, never by omission. `ai-generated` still records actual
   authorship (`true` if you drafted it, `false` if the human did) — the
   disclosure is about provenance, not about who wrote the words.
3. **Cite when you answer.** Query answers reference the pages/sources they rest on.
4. **Flag, don't invent.** If sources contradict or are silent, say so — never
   paper over a gap with plausible text.
5. **Clippings win.** Briefs, discovery summaries, corrections files, and your
   own memory of a source are *claims, not authority*: verify every quote,
   figure, and attribution against the clipping in `raw/` before it lands on a
   page, and when they disagree the clipping prevails — including when the
   instruction is the user's. Every layer between the source and the page is a
   lossy compressor whose errors read exactly like facts; authority flows
   outward from the one artifact that cannot drift.
   Scope edges, which matter as much as the rule:
   - It guarantees **fidelity, not truth** — a faithful clipping of a wrong page
     is still wrong; quality tiers and cross-clipping corroboration handle
     credibility.
   - A **degraded capture** (bad OCR, partial extraction) wins as evidence of
     what the vault *holds*, not of what the author typed — don't trust it at
     character level.
   - A clipping's **silence proves "not supported here," never "false"** —
     record unsourced claims as unsourced (visibly, on the page) rather than
     asserting or deleting them. The vault cannot cite what it does not hold.

## Style: viewpoints whole, conclusions after, breadcrumbs always
Narrative is licensed; dismissal is not. Three house rules govern every page:

1. **Opposing viewpoints appear in their entirety** — in their own strongest
   terms, attributed to their holders — before any conclusion engages them.
   A viewpoint the page ends up arguing against gets the same care as one it
   endorses; weight follows the evidence the vault holds, and no viewpoint is
   waved off by tone (loaded verbs, scare quotes, "supposedly"). When sources
   conflict, keep the claims separate and attributed — never resolve them into
   one synthesized voice that erases the disagreement.
2. **Viewpoints first, conclusions after — and conclusions declare themselves.**
   Every analytic sentence is one of: *inherited* (a source says it — cite it),
   *extended* (built on a source — cite it, mark what's added), or *original*
   (the wiki's own inference — say so explicitly, never state it in the
   page's neutral voice). Joining source A to source B to imply C is an
   *original* claim even when A and B are both cited.
3. **The breadcrumb trail is non-negotiable.** Every viewpoint and every
   conclusion must be walkable back to `raw/`: `sources:` frontmatter, inline
   `[[wikilinks]]` to the source pages, and quotes verified per guardrail #5.
   A conclusion whose trail dead-ends is a defect, however good it reads.

Per-type licenses (neutrality is a property of a page type, not of the vault):
- `raw/` — fidelity only; the evidence layer (guardrail #1, #5).
- `wiki/entities/` — **describe and only describe.** Convert opinions to
  attributed facts about who holds them; convert evaluations to the measurable
  facts beneath them. When tempted to interpret, link to a concept or
  synthesis instead.
- `wiki/concepts/` — claims with grounding. Assertive titles are allowed; the
  title's pressure is the point, and the body must support the claim under
  rules 1–3.
- `wiki/syntheses/` — the licensed narrative layer: weigh, judge, conclude —
  bounded by rules 1–3, and labeled as the wiki's synthesis.
- `wiki/authored/` — the vault's own first-party voice: advisory documentation,
  policy, house style, or other original work with no `raw/` evidence behind it
  by design. Same full narrative license as syntheses; state recommendations
  directly. Rule 3 (breadcrumb to `raw/`) does not apply — there is deliberately
  nothing to trail, declared via `sources: []` rather than left silent.

Clippings carry `quality: high|medium|low`, an AI credibility rating. Treat low-quality sources with extra skepticism during ingestion; lint may flag claims supported only by low-quality provenance. Capture fidelity and source credibility are separate judgments.
