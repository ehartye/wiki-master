Read [access and host commands](../../wiki-maintainer/references/access.md) before touching the vault. Also read for this task: [completion](../../wiki-maintainer/references/operations.md).
Load the rest only when this run reaches it — [evidence](../../wiki-maintainer/references/evidence.md) before a quote or figure from this capture lands on a wiki page, or when reporting a fidelity limit.
Reuse existing session authorization for the first write.

# Clipping a Confluence page into the wiki

The HTML clipper (`clip.mjs` → Defuddle) handles public **HTML** pages
only, by an unauthenticated fetch. A Confluence Cloud page is also HTML, but
sits behind Atlassian auth — Defuddle's anonymous request hits the login wall
or an empty SPA shell, reads as thin content, and can be declined. This
skill is the Confluence path. **The canonical stored artifact is the Markdown
the `confluence` skill's `page.mjs` already returns, never a PDF export and
never a second fetch** — that keeps the vault greppable, diffable, and
answerable, and makes `[[note]]` provenance resolve to a real clipping.

**Why not export the page to PDF and run PDF capture on it instead?** That was
considered and rejected: it is a double lossy conversion (Confluence storage
format → PDF render → `pdftotext` extraction) instead of the one clean hop
`page.mjs` already does to Markdown, `clip-pdf.mjs`'s own code documents that
table extraction can "mispair rows beyond recovery" while looking perfectly
clean character-wise, and Confluence validation/compliance corpora are
dominated by exactly that shape of content (approval blocks, signature tables,
requirement-to-test traceability matrices). It also does not fix live Jira
macros that already fail to render for `page.mjs` ("Data cannot be retrieved
due to an unexpected error") — that is a server-side macro-render failure,
likely reproduced in PDF export too, minus the helpful fallback JQL link
`page.mjs` gives you. And it stays fully manual per page, which does not scale
to a researcher discovery-style sweep across dozens of pages.

## How it works

`clip-confluence.mjs` does **not** implement its own Confluence client. It
shells out to the **separately installed** `confluencer` plugin's own
`page.mjs` (the same script the `confluence` skill uses), parses the
provenance header `page.mjs` always prints (`# Title` / `Space: X · Page ID: Y
· Version: Z · Updated: <iso>` / `URL: <url>` / `---` / body), and writes
`raw/clippings/<slug>.md` with the standard clipping frontmatter (`source`,
`created`, `tags:[clippings]`, `quality`, `source-hash`) — the Confluence-
specific detail (space, page ID, version, updated timestamp) stays in the
clipping's body exactly as `page.mjs` formatted it, rather than growing the
shared frontmatter schema for one source type. It skips duplicates and prior
declines, and records a decline for a **thin** extraction (a parent/index page
with no body prose) so it is not retried blindly.

**Deliberate exception to wiki-master's usual portability rule.** Every other
`clip-*` skill (pdf, docx, xlsx, pptx) is self-contained — none of them
runtime-depend on another installed Copilot plugin, specifically so wiki-master
behaves the same whether or not some other plugin happens to be present. This
skill breaks that rule on purpose: Confluence access is a whole configured,
authenticated Atlassian integration (base URL, account email, API token,
connectivity), not a generic stateless library like `pandoc` or `python-pptx`,
and re-implementing an Atlassian API client inside wiki-master to preserve
portability would be the wrong trade. So this capture route treats `confluencer` as an
**optional** runtime dependency and is built to degrade gracefully rather than
fail confusingly when it is absent — use the direct setup procedure below.

## Optional integration

Use the direct [Confluence prerequisite and failure procedure](../../wiki-setup/references/capture-prerequisites.md#confluence) for dependency discovery, authentication checks, unavailable-service handling and version/dedup limitations. Missing access is not evidence and does not authorize a fabricated clipping.

## Steps

1. **Preflight:** run the direct [prerequisite and diagnostic procedure](../../wiki-setup/references/capture-prerequisites.md#confluence) for this format. Missing tools or access never authorize invented evidence or automatic installation.
2. **Clip** (this is the only writer to `raw/` for Confluence pages):
   `node "<absolute-plugin-root>/scripts/clip-confluence.mjs" "<url-or-page-id>" --quality=<tier> --topic="<topic>"`
   - Accepts anything `page.mjs` itself accepts as a positional argument: a
     canonical URL, a tiny link (`/wiki/x/…`), a legacy `viewpage.action` URL,
     or a bare numeric page ID. If you only have an exact title + space, first
     resolve it via the `confluence` skill (`page.mjs --title "..." --space
     ...` or `search.mjs`), then pass the resulting URL/ID here.
   - No `--source=` flag (unlike `clip-pdf`/`clip-docx`) — the canonical URL
     always comes from `page.mjs`'s own metadata, which is the authoritative
     citation per the `confluence` skill's own rule ("always cite the title,
     URL, and version").
   - **`--topic` whenever this clip belongs to a research run** — pass the
     topic string researcher discovery was given, identical across every clip in
     the run, so maintainer triage can group the run's leftovers together.
     **Topic is recorded going forward only and no tool can retro-fit it**, so
     a clip made without it is an *Unattributed* triage row permanently. Omit
     it only when there is no research run behind the clip; never invent one.
   - A `thin` result means the page has no readable body (a parent/index page
     with only child links) — a decline is recorded; this is not a failure.
   - A `failed` result means `page.mjs` itself errored (bad id/auth/network) —
     report it for manual handling; do not invent the text.
3. **Verify** the clipping landed: read `raw/clippings/<slug>.md` and
   sanity-check the body against what `page.mjs` would show you directly via
   the `confluence` skill.
4. **Only when ingestion is authorized, follow [ingestion](ingest.md)** for this exact clipping —
   summarize into `wiki/sources/`, cross-reference, index, log. Ingestion requires authorization for this scope; reuse explicit session authorization.

For an updated page at an already captured URL, inspect the [version/dedup limitation](../../wiki-setup/references/capture-prerequisites.md#confluence); a duplicate result does not establish that the live page is unchanged.

## Guardrails

- **Never edit the body of anything under `raw/`** — clipped content is
  immutable source-of-truth (guardrail #1). Frontmatter is pipeline state,
  tooling-only.
- `clip-confluence.mjs` is the **sole writer** to `raw/` for Confluence pages —
  the model never writes the clipping by hand (that would bypass dedup,
  decline, and hashing).
- **Fidelity, not truth**: a faithful clip of a wrong or outdated page is still
  wrong — confirm you clipped the page you meant, and note the `Version` you
  clipped when citing it, since the live page may have moved on.

## Completion

Verify the paths the clipper printed and its extraction diagnostics, then
[finish the capture](capture.md#finish-capture-and-report). During discovery, report the
results to the enclosing task, which logs once. Capture-only requests create no derived
source or concept pages.
Capturing evidence does not by itself authorize ingestion; reuse explicit
discover-and-ingest authorization when it is already present.
