---
name: wiki-author
description: Author original wiki/authored/ content (docs, guides, ADRs, backlog items) with canonical per-kind placement — no re-deriving the convention per project. Use when the user asks to write/update project documentation, a guide, an architecture doc, a decision record, or a backlog item.
argument-hint: "[what to author, e.g. \"a user guide for sparta-scope\"]"
---

> **Host portability (Claude Code, Copilot CLI, Codex):** Resolve bundled
> `scripts/` and `templates/` paths from this skill's installed directory:
> `../../` is the plugin root. Use quoted absolute paths when running helpers;
> do not resolve them from the current workspace or depend on plugin-root shell
> variables. For sibling skills, read `../<skill-name>/SKILL.md` if the host has
> no skill-loading tool. References such as `/wiki-health` mean that skill's
> workflow; in Codex, select the skill or ask for it by name. Treat `$ARGUMENTS`
> as the user's request when the host does not substitute it.

Load the `wiki-maintainer` skill and follow its **Authoring** workflow — this
skill exists to make that workflow the thing you reach for by name, the same
way `/wiki-ingest` is what you reach for to ingest a source, rather than
relying on a paragraph inside `wiki-maintainer`'s general text.

For: $ARGUMENTS

Steps:
1. **Identify the project and the kind of doc being asked for**, from the
   canonical placement table in `wiki-maintainer`'s vault-contract section:

   | You hear | It lives at | `kind:` |
   |---|---|---|
   | "update the product documentation" / "the overview" | `<project>/overview.md` | `overview` |
   | "document the architecture" | `<project>/architecture.md` | `architecture` |
   | "add/update the roadmap" | `<project>/roadmap.md` (mostly generated — step 4) | `roadmap` |
   | "write a user guide" | `<project>/guides/user.md` | `guide` |
   | "write a developer guide" | `<project>/guides/developer.md` | `guide` |
   | "write an administrator guide" | `<project>/guides/administrator.md` | `guide` |
   | "get me a diagram [for X]" | `<project>/diagrams/<x-slug>.md` | `diagram` |
   | "write up a reference doc on X" | `<project>/reference/<x-slug>.md` | `reference` |
   | "record a decision about X" (ADR) | `<project>/decisions/<x-slug>-adr.md` | `decision` |
   | "make a note about X" | `<project>/notes/<x-slug>.md` | `note` |
   | "add an item to the backlog" | `<project>/backlog/<item-slug>.md` | `backlog-item` |

   If the project doesn't exist yet under `wiki/authored/`, this is the
   overview — create `wiki/authored/<project>/overview.md` first.
2. **Use the matching template** — `_templates/authored-note.md` for anything
   general, `_templates/authored-decision.md` for an ADR,
   `_templates/authored-backlog-item.md` for a backlog item. Set `project:`
   and `kind:` to match the row above; `sources: []`; `ai-generated` honestly.
3. **Write the page directly** via `obsidian create path=... content=...` —
   there is no source to ingest from, this is original content.
4. **Regenerate what the write affects**, from the plugin root:
   - Any page in a project with 2+ authored pages:
     `node ../../scripts/moc-authored-gen.mjs --apply` — refreshes that
     project's `moc/<project>.md` hub.
   - A backlog item specifically:
     `node ../../scripts/backlog-gen.mjs --apply` — refreshes
     `<project>/roadmap.md`'s itemized, status-grouped list from
     `backlog/*.md`. **Never hand-append to `roadmap.md` itself** — edit the
     one backlog item file that changed, then regenerate.
5. Write the log entry:
   `node ../../scripts/log-entry.mjs --op relink --title "<summary>"`.

If you were about to append a dated "Update (...):" paragraph to an existing
authored page rather than following steps 1–4 above, stop — that is exactly
the pattern this skill exists to prevent. Create or edit the one small file
the change actually belongs to instead.

**Linking to another project's `overview.md` / `architecture.md` / `roadmap.md`?**
These are bare canonical names reused across every project, so a bare
`[[roadmap]]` link is ambiguous once a second project has one. From outside
that project, use the piped form: `[[wiki/authored/<project>/roadmap.md|<project>
roadmap]]`. See wiki-maintainer's vault-contract section for the full rationale.
