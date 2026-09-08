A. Use `wiki-author` with `wiki-maintainer`. Tell the user: “I’m using the wiki authoring workflow to update the existing Atlas guide, verify the change, and publish it.”

- Target `C:/vault`, not `C:/work/widget`; resolve helpers from `C:/plugins/wiki-master/scripts/`.
- Follow the vault’s specific main-branch workflow. Preserve the existing guide’s filename, `sources: []`, and `reviewed: 2026-08-01`. Set `updated` for the edit; record that the offline section alone was checked against code. Do not imply the whole guide received a fresh factual review.
- The supplied maintainer skill says, “Use the `obsidian-cli` skill for all vault access”; author specifies writing through `obsidian create`. A five-second CLI timeout therefore blocks the supplied workflow despite working filesystem access. I would report that conflict instead of silently using an undocumented fallback.
- Once access is resolved, the intended PowerShell sequence is `$env:WIKI_MASTER_VAULT = 'C:/vault'`; `$wikiOperationToken = node 'C:/plugins/wiki-master/scripts/op-begin.mjs' --op relink`; edit the existing guide; regenerate the affected project hub if applicable; write one `log-entry.mjs --op relink` entry; verify the diff and links; then `op-commit.mjs --op relink --title 'Explain Atlas offline mode' --since $wikiOperationToken`.
- “Publish” already authorizes pushing, so do not seek another push approval. After committing, push the vault’s configured upstream and verify remote synchronization. That confirms publication, not that the laptop has pulled.

**Actual stop condition under supplied facts:** CLI access remains unavailable; no completed edit or publication claim. Explain that the blocker comes from the explicit access restriction in [wiki-maintainer/SKILL.md](C:/Users/ehart/repos/wiki-master/skills/wiki-maintainer/SKILL.md), rather than filesystem failure or missing publication permission.

B. Use `wiki-search`, not `wiki-query`.

- Run the installed absolute helper: `node '<plugin-root>/scripts/search.mjs' 'if-then planning' --include-raw --json --limit=10`.
- Read retrieval diagnostics; disclose lexical-only retrieval if reported. Inspect the canonical **Implementation Intentions** hit, its **If-then planning** alias, and matched passages.
- Resolve its evidence using `resolve-evidence.mjs` with the actual returned full path; inspect the clipping before quoting evidence.
- Return actual matching page paths, line numbers, and short passages. Identify the alias relationship without creating a second concept.

Tell the user which pages and passages matched and whether retrieval was degraded. **Stop when retrieval is delivered.** No synthesis page, filing offer, discovery, ingest, log, operation bracket, or writes.

C. Use `wiki-stale` with the maintainer efficacy contract.

- Run absolute-path `stale.mjs`, `drift.mjs --coverage`, and `drift.mjs --limit=10`.
- Report dated-but-stale pages separately from the **12 of 40 concepts lacking review dates**. Do not infer that the remaining 28 are current without inspecting their review dates and claims.
- Report the supplied drift outcome precisely: **0 evaluated, 10 failed; embedder unavailable**. Report skipped and document/chunk coverage only if provided; do not invent them.
- Manually inspect a bounded sample of changed or frequently used recommendations against their evidence, prioritizing volatile claims. Yesterday’s edits do not count as factual verification.

Tell the user: “Structural health is 100, but that does not establish whether the recommendations are current. Thirty percent of concepts lack a review date. The drift check evaluated no documents because the embedder was unavailable, so it provides no evidence of absent drift.”

**Stop condition:** deliver the stale/unverified inventory, any claim checks actually completed, and the unresolved coverage limits. Do not stamp review dates, call all recommendations current, or equate an embedding refresh with verification.

D. No wiki authoring or maintenance operation follows from this request. It concerns application database terminology.

Under the supplied standing instruction to consult existing wiki knowledge, a bounded, read-only `wiki-search` for this application’s schema or naming conventions is appropriate. Otherwise, inspect the application’s existing terminology and table semantics before advising. Do not trigger `wiki-author` merely because the alternatives include “sources” and “citations”; do not discover, ingest, or file an ADR automatically.

**Stop condition:** provide a naming recommendation grounded in what the table represents and the application’s conventions, with no wiki changes.
