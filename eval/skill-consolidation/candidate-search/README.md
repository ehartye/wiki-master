# Candidate lexical search execution

Actual candidate-plugin-loaded execution at revision `082de0b4ee151d51cc504de825d3b92b7590a5b1`, Claude Code 2.1.316. This is the executor's observation, pending independent grading. The prompt and generic source fixture match the [baseline](../baseline-search/README.md). No installed plugin or global setting was changed.

The session inventory exposed exactly `wiki-init`, `wiki-maintainer`, `wiki-purge`, `wiki-researcher`, and `wiki-user` under the wiki-master namespace, with its plugin source pointing to the candidate worktree. The actor actually invoked `wiki-user` and read `references/search.md`; it did not load the maintenance role or mutation policy. It also explicitly read the fixture's AGENTS instructions. The two skill instruction files contain 5,232 bytes, versus 20,236 bytes actually loaded by the baseline. These are measured source bytes, not estimated tokens; host token/cache usage is retained separately in `observations.json`.

The actor ran four real helper queries, used `--include-raw` only for the evidence lookup, and opened each matching file. It returned the exact phrase path/line, the alias target, both ambiguous Harbor paths and the raw marker. No recycle result appeared. Its first query included extra quote characters around the phrase, visible in the transcript; the expected page was still found. It disclosed lexical retrieval, unavailable index, incomplete identity coverage and unindexed results.

`state.json` contains identical pre/post file hashes, Git HEAD and status. No operation, log, commit or index refresh occurred. `fixture.json` exactly matches the baseline fixture. The actor quoted retrieved passages without loading the conditional evidence reference, as did the baseline; that observation remains for the independent reviewer rather than being silently corrected.

Artifacts retain the redacted invocation and prompt (`execution.json`), complete tool transcript (`transcript.jsonl`), observed inventory/loads and host usage (`observations.json`), and content/Git checks (`state.json`). The declared-unavailable embedding endpoint was `http://127.0.0.1:1`.
