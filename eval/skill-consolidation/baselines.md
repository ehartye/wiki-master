# Consolidation baselines

Implementation starts from wiki-master `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca` (0.87.0), on feature branch `feat/five-skills` in a sibling worktree. Companion hartye-skills starts from `0b86d8e5be41b1aeeaf7f2bae89a47da0c1e4f91` on `feat/wiki-five-skills`, also in a sibling worktree. Main product checkouts were clean at inspection. No merging, release, marketplace update or global installation is authorized by this work.

The maintained caller scan additionally identified agent-game-studio's `references/plugin-map.md`. Its clean baseline is `a5e9269c39c82a34e05ca1ce842b5982c4674dec`; its migration uses `feat/wiki-five-skills` in that repository's sibling worktree directory.

Environment: Windows, PowerShell, Claude Code 2.1.316. The session loader preflight used `claude -p <catalog-only prompt> --plugin-dir <baseline-plugin> --setting-sources local --strict-mcp-config --no-session-persistence --output-format stream-json --verbose`, exit 0. Its initialization event listed only the baseline inline wiki-master plugin for that namespace, with all 21 old skill names. This is activation inventory evidence, not workflow execution. Native built-in host skills were also present. Private raw preflight output is retained outside the product repository.

Baseline commands (run from the unchanged baseline checkout):

| Command | Exit | Result | Evidence |
|---|---|---|---|
| `node --test test/skill-contracts.test.mjs test/drift-guard.test.mjs test/triage-skill-table.test.mjs` | 0 | 22 passed, 0 failed/skipped | `baseline-structural.tap` |
| `npm run test:skills` | 0 | 43 passed, 0 failed/skipped | `baseline-skills.tap` |

These deterministic tests do not establish agent activation, discovery, or synthesis correctness. Candidate results and behavioral gates must be recorded separately.

The reviewed specification's skill-design sources were checked through `known-urls.mjs --check`: both the Agent Skills specification and Anthropic engineering article were already captured. Their source hashes also occur in existing source summaries; no duplicate capture or ingestion was needed. Existing unrelated vault edits are outside this operation's ownership.
