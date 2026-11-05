# Connect concepts and task maps

Read [access](access.md), [identity and relationships](efficacy.md),
[evidence](evidence.md) and [completion](operations.md). Read
[repair recipes](maintenance.md) only when a specific repair is indicated.

1. Inspect the requested navigation scope using the direct [health/topology check](../../wiki-setup/references/checks.md#health-and-ingest-backlog)
   and [identity/relationship checks](../../wiki-setup/references/checks.md#identity-and-relationship-checks).
   Unscored forward links and orphan/dead-end opportunities are not integrity
   obligations. Route actual integrity defects to [repair](repair.md) when
   authorized. A preview-only request stops after reports and writes nothing.
2. Before creating a page for a frequently mentioned entity, search candidate
   names and equivalent aliases; reuse the canonical page when it already exists.
   Never merge related concepts solely because names or embeddings are similar.
3. Obtain bounded candidates with
   `node "<absolute-plugin-root>/scripts/relationships.mjs" --limit=10 --json`
   (optionally `--since=YYYY-MM-DD`, `--seed="wiki/concepts/<page>.md"`, or `--semantic`).
   Read both pages and their evidence. Choose a relationship role and explanatory
   sentence under the identity contract. Shared evidence and similarity do not
   establish equivalence or causality. Report accepted/rejected candidates and why.
4. Apply useful links under `## Relationships` within scope, keeping your edits to
   what your task needs; seek input for uncertain interpretations. Keep supporting citations in `sources:`
   and factual prose, separate from navigation. Preserve `reviewed` on mechanical edits.
5. Build or refresh a small task MOC when it helps recurring questions: starting
   points, prerequisites, alternatives, complementary domains and open questions.
   Use `_templates/task-map.md`; keep generated document catalogs distinct. Use
   [project guidance](../../wiki-project/references/authoring.md) for original
   project pages, and its [catalog procedure](../../wiki-project/references/catalogs.md)
   for project-generated navigation.
6. Confirm new links resolve, then follow [completion](operations.md) with
   `--op relink`. Once the refresh has run, confirm a task query can retrieve the map.

**Done:** relationships are explained and supported, canonical identity is
preserved, affected maps are findable, and authorized changes are logged and
refreshed, or reported as written but not refreshed. A preview remains read-only.
