# WP3 companion migration evidence

This package changes source only. No installed cache, global configuration, version, marketplace pin, release or real vault content was changed. Product edits are in feature worktrees.

## Source changes

| Repository / baseline | Changed file | Final route |
|---|---|---|
| hartye-skills / `0b86d8e5be41b1aeeaf7f2bae89a47da0c1e4f91` | `skills/spec-plan/SKILL.md` | wiki-user search and authoring; wiki-researcher topic discovery and ingestion of the resulting named clippings |
| hartye-skills / same | `skills/q-master/SKILL.md` | wiki-user authoring |
| agent-game-studio / `a5e9269c39c82a34e05ca1ce842b5982c4674dec` | `references/plugin-map.md` | wiki-user authoring and task-scoped validation; wiki-maintainer health only for a requested whole-vault report |

The companion skill metadata and all unrelated procedures remain unchanged. Existing authorization boundaries remain: source-gap research uses existing authorization; q-master still requires approval for its configuration write; wiki authoring owns scoped validation/publication. Coordinated delivery must include both companion migrations before retiring the old wiki-master names.

## Fresh-session dependency check

The hartye-skills repository's authoring discipline requires a failing baseline before edits. A fresh actor without the migrated caller instructions read the two baseline caller files, then attempted their exact wiki dependencies against the session-only five-skill candidate. It did not execute a wiki workflow, substitute another route, write files, run shell commands, or access the vault. This is a focused compatibility check, not a full with/without-skill efficacy experiment.

The Skill tool returned these failures verbatim before edits:

```text
<tool_use_error>Unknown skill: wiki-master:wiki-search</tool_use_error>
<tool_use_error>Unknown skill: wiki-master:wiki-discover</tool_use_error>
<tool_use_error>Unknown skill: wiki-master:wiki-ingest</tool_use_error>
<tool_use_error>Unknown skill: wiki-master:wiki-author</tool_use_error>
```

After migration, a separate fresh actor loaded `wiki-master:wiki-user` and `wiki-master:wiki-researcher` successfully through the Skill tool. An initial candidate run noted that generic "ingestion modes" wording did not specify named clippings; it is preserved in `caller-candidate-initial-*`. The caller was narrowed to ingestion of the resulting named clippings and a fresh rerun confirmed the intended mode mapping. Both final dependencies resolved without tool errors. Each initialization event exposes exactly the five candidate wiki-master skills; the installed old catalog was not substituted.

The exact prompts, commands, exits and actual tool calls/results are retained in `caller-baseline-*`, `caller-candidate-initial-*`, and `caller-candidate-*`. Every CLI process exited 0; that host exit does not disguise the baseline dependency failures above. Paths in public transcripts are sanitized. No end-to-end spec-plan, q-master or studio workflow success is claimed from dependency loading.

## Bounded caller inventory

`caller-inventory-before.json` and `caller-inventory-after.json` record the scan expression, scope, source revisions and every match without private source-line snippets. `caller-migration.json` gives final dispositions and replacements for all original matches.

The set comprises 16 installed first-party companions and their 16 corresponding source repositories: agent-beeps, agent-draw, agent-engine, agent-game-studio, agent-marketing, agent-meshes, agent-phaser, agent-prose, agent-sprites, agent-stalker, agent-tests, agent-unreal, agent-vids, agent-workflow, h-superpowers and hartye-skills. Agent-draw's source was accessible through a read-only shallow clone because no normal checkout was present. All source revisions are recorded. Wiki-master's own maintained sources/catalog and historical evaluations are owned by the main WP3 migration. Temporary plugin-install staging folders are not catalog entries.

The scan covered Git-tracked Markdown in source repositories and Markdown under installed plugin roots, excluding dependency/build internals. It matched retired qualified names and direct old skill paths. There were 42 original occurrences: nine actionable source references in the three files above; remaining occurrences are historical plans/review evidence or read-only installed copies. The final scan retains 33 such occurrences, with zero unresolved maintained source callers and zero unclassified matches. Historical transcripts, design plans and release history remain byte-for-byte unchanged. Installed old versions remain unchanged until coordinated delivery. Compatibility with unknown third-party callers or non-Markdown executable consumers is not claimed.

## Verification

| Check | Result |
|---|---|
| Baseline fresh actor dependency resolution | Four expected unknown-skill failures; host exit 0; captured before edits |
| Final fresh actor dependency resolution | Both new roles loaded; expected modes identified; host exit 0 |
| `node scripts/check.mjs` in agent-game-studio worktree | Exit 0; 123 passed, zero failed/skipped; full output `caller-studio-check.tap` |
| Companion `git diff --check` | Exit 0 in both worktrees |
| Changed-file frontmatter comparison and relative-link check | Metadata unchanged; all relative targets resolve; final file hashes in `caller-checks.json` |
| Final retired-caller inventory | 32 source surfaces scanned; zero unresolved maintained source callers |
| Public evidence machine-path scan | No concrete home path, username or machine prefix found |

The check script was rerun once to retain its full output after the initial tool display truncated it. A first `rg` command named a nonexistent top-level references directory in hartye-skills; the corrected scan covered its actual skill/reference tree. These command-invocation mistakes did not modify source. Final independent package review is owned by a separate reviewer; this report does not self-certify that review.
