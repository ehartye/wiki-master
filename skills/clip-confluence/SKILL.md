---
name: clip-confluence
description: Clip a Confluence page into the wiki as a Markdown clipping — fetch it via the (separately installed) confluencer plugin's authenticated API and store confluencer's own Markdown, never a PDF export or a re-fetch. Use when a source is a Confluence Cloud page that /wiki-discover's HTML clipper (Defuddle) cannot reach because it requires authentication.
argument-hint: "<confluence-url-or-page-id> [--quality=high|medium|low] [--topic=\"<topic>\"] | --doctor"
---

> **Scripts:** wiki-master's scripts live in the plugin's `scripts/` directory — resolve `../../scripts/clip-confluence.mjs` relative to this skill's own directory (the plugin root is the parent of `skills/`). No plugin-root env var is set under Copilot CLI, so use this relative path, not `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}`.

> **First, context (lazy):** if the `wiki-maintainer` skill isn't already loaded in
> this session, load it — it carries the vault location and the provenance/`raw/`-immutability
> and clipping guardrails these steps assume. Skip the load if you arrived here mid-run
> from a wiki-master skill that already pulled it in.

# Clipping a Confluence page into the wiki

`/wiki-discover`'s clipper (`clip.mjs` → Defuddle) handles public **HTML** pages
only, by an unauthenticated fetch. A Confluence Cloud page is also HTML, but
sits behind Atlassian auth — Defuddle's anonymous request hits the login wall
or an empty SPA shell, reads as thin content, and gets auto-declined. This
skill is the Confluence path. **The canonical stored artifact is the Markdown
the `confluence` skill's `page.mjs` already returns, never a PDF export and
never a second fetch** — that keeps the vault greppable, diffable, and
answerable, and makes `[[note]]` provenance resolve to a real clipping.

**Why not export the page to PDF and run `/clip-pdf` on it instead?** That was
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
to a `/wiki-discover`-style sweep across dozens of pages.

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
portability would be the wrong trade. So this skill treats `confluencer` as an
**optional** runtime dependency and is built to degrade gracefully rather than
fail confusingly when it is absent — see the next section.

## Graceful degradation when confluencer isn't installed

`clip-confluence.mjs` never assumes `confluencer` is present. It searches
every `~/.copilot/installed-plugins/*/confluencer/` install for its `page.mjs`
under that plugin's own `scripts` folder (every Copilot CLI plugin installs
under that root, even though neither plugin knows the
other's exact path at authoring time), or an explicit
`WIKI_MASTER_CONFLUENCER_SCRIPTS` env var override for a dev checkout or
non-standard install.

- **Preflight, any time:** `node ../../scripts/clip-confluence.mjs --doctor`
  reports whether `confluencer` was found, and if so, hands off to **its own**
  `doctor.mjs` for the auth/config/connectivity check — wiki-master has no
  business diagnosing another plugin's credentials, only routing to the tool
  that can.
- **Not found:** the clip attempt prints one clear message (which paths it
  searched, and the env var that can override) and returns
  `{ status: 'confluencer-missing' }` — never a raw `ENOENT`/stack trace, and
  never a fabricated clipping standing in for content nobody actually fetched.
- **Found but failing** (bad page ID, expired token, network): the real
  `page.mjs` stderr is surfaced (first few lines) plus a pointer to run
  confluencer's own `doctor.mjs`.

If it reports missing, either install the `confluencer` plugin, or hand-fetch
the page via the `confluence` skill yourself and clip it through `/clip-docx`
or `/clip-pdf` as a fallback (lower fidelity for tables, per the rejected-PDF
argument above, but better than nothing) — do not hand-write a
`raw/clippings/*.md` file directly; that would bypass dedup, decline-tracking,
and hashing the same way it would for any other source type.

## Steps

1. **Preflight** (once, or whenever a clip fails unexpectedly):
   `node ../../scripts/clip-confluence.mjs --doctor`.
2. **Clip** (this is the only writer to `raw/` for Confluence pages):
   `node ../../scripts/clip-confluence.mjs "<url-or-page-id>" --quality=<tier> --topic="<topic>"`
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
     topic string `/wiki-discover` was given, identical across every clip in
     the run, so `/wiki-triage` can group the run's leftovers together.
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
4. **Hand off to `/wiki-ingest`** exactly as with any other clipping —
   summarize into `wiki/sources/`, cross-reference, index, log. The ingest is
   gated by the user as usual.

## Known limitation: re-clipping an updated page

Confluence pages mutate in place at a stable URL — a page's `Version` can
climb many times in a single day. The dedup gate is keyed on bare URL (same as
every other `clip-*` script), so deliberately re-clipping a page that has been
edited since its last clip reads as `duplicate (already clipped)` and is
silently skipped, exactly as it would for any live web page whose content
changed since its last clip. This is not new to Confluence, but Confluence
pages hit it far more often than the mostly-static sources the dedup layer was
designed around. Not fixed here — flagged for a future version-aware dedup
(key on URL **+ Version**, not URL alone) if re-clipping updated pages becomes
a real workflow.

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
