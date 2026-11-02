# Healthy indexed baseline search

Actual baseline-loaded execution, not candidate verification or independent grading. This uses the same source fixture and prompt as [the lexical baseline](../baseline-search/README.md), in a separate scratch vault and fresh Claude session. Baseline revision: `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca`. Host: Claude Code 2.1.316.

Before the read-only snapshot and actor session, the executor ran the baseline `index-embed.mjs` with `WIKI_MASTER_VAULT=<SCRATCH>/baseline-search-healthy-vault`, `WIKI_MASTER_REQUIRE_VAULT=1`, and `OLLAMA_HOST=http://localhost:11434`. Preparation exited 0 and embedded five chunks across five files; see `index-preparation.json`. This preparation write is not part of the read-only actor's execution.

The fresh actor selected `wiki-master:wiki-search`, loaded the maintainer core and access policy, ran four searches and `--health`, and opened returned passages using numbered filesystem reads. Actual outputs report hybrid search, healthy keyword/semantic/identity channels, a current five-file/five-chunk index, exact phrase and alias matches, both ambiguous Harbor paths, and one explicitly included raw hit. The recycle decoy never appears in the returned results.

`state.json` shows all content and prepared index file hashes, Git HEAD and status identical before and after the actor. No operations or log files appeared. Raw evidence correctly remains outside the semantic index. The actor again quoted retrieved passages without separately loading evidence policy; retain this observation for independent grading.

The baseline instruction files actually loaded total 20,236 source bytes. `observations.json` retains individual sizes and host-reported token usage without treating bytes as tokens or total prompt/cache usage as skill-only consumption. `transcript.jsonl` contains actual calls/results; `execution.json` records prompt, redacted command and exit. `fixture.json` is identical to the lexical run's source fixture. Private home prefixes are redacted, including encoded Claude memory-directory prefixes.

For candidate comparison, build a separate vault from `fixture.json`, prepare its index before taking the candidate snapshot with the same embedding model/host, then run the unchanged prompt through only the session-loaded candidate. Do not compare mutable index timestamps between vaults as content differences; compare each vault's own index files before/after its actor execution.
