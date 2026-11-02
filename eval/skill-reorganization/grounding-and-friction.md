# Grounding and tool friction

Read-only grounding on 2026-11-02 checked the reviewed specification and existing
official skill-authoring evidence before implementation. `known-urls.mjs --check`
identified the Agent Skills specification and Anthropic's *Equipping agents for
the real world with Agent Skills* as captured. Their exact raw `source-hash`
values are recorded in `wiki/sources/Agent Skills Spec.md` and
`wiki/sources/Anthropic Engineering — Equipping Agents with Agent Skills.md`.
Named ingestion therefore had zero eligible work; no operation or ingestion ran.
The global backlog is unrelated to that named scope. Existing evidence supports
examples and progressive disclosure, not efficacy of this particular layout.

## Initialization wording versus template behavior

At baseline revision `8720f90`, `scripts/init.mjs` advertises “Existing files are
kept.” Its `scaffold` implementation protects index, schema and bases with
existence checks but uses `cpSync(..., { recursive: true })` for `_templates`.
That copy can overwrite an existing customized template. The baseline actor
preserved its existing index; that does not prove arbitrary populated-vault
safety. The independent baseline review retains this limitation.

The migration does not change runtime behavior. Setup guidance must inspect
existing templates and preserve customized content before scaffolding. Record
the help/behavior mismatch in the project's wiki backlog for a separately
scoped fix; do not claim this skill migration fixes the helper.

## Catalog scope

The real vault's global index already contains foreign changes. Existing
operation policy requires preserving them. Project-only backlog and MOC
generators can publish owned navigation; global index refresh remains deferred.
The existing operation-ownership backlog tracks the missing project-only mode
on the combined refresh helper. This migration does not extend that interface.
