# Baseline search observation

This is actual baseline-plugin-loaded execution, not candidate evidence or an independent grade. The baseline revision was `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca`; the host was Claude Code 2.1.316 using its existing subscription. The session-only loader exposed the baseline's 21 wiki-master skills. Installed plugins, caches and global configuration were not modified.

The actor was asked for four read-only lookups: a unique exact phrase, an alias, an ambiguous name, and explicit raw evidence. It selected `wiki-master:wiki-search`, ran `search.mjs` four times, and opened the returned passages. The raw request included `--include-raw`; the other searches did not. Both Harbor paths were reported. No result came from the recycle decoy. The transcript contains actual helper diagnostics and the actor's interpretation, retained without correcting its answer after the fact.

The deliberately unavailable embedding endpoint and absent index produced lexical retrieval. This run does not establish healthy indexed behavior. It disclosed incomplete identity metadata and unindexed hits. The actor's final answer quoted passages without separately loading evidence policy; this is an observation for independent grading, not an assertion that every baseline policy was followed.

`state.json` records identical pre/post content hashes (including recycle decoy), Git HEAD and porcelain status. No operation, log or index file appeared. The fixture remains outside the product checkout for equivalent candidate execution. `fixture.json` contains its generic source files.

The actor loaded the search entry point, maintainer entry point and shared access reference: 20,236 source bytes in total. `observations.json` records per-file byte/character/line counts, actual loads and host-reported token usage. Byte counts are not token counts; aggregate host usage includes system prompt/cache accounting, so it must not be presented as search-only consumption. Applicable fixture AGENTS instructions were host context; the actor did not explicitly read that file.

## Permission preflight friction

The first fresh session used narrow shell allowances such as `PowerShell(node *)`. The actor composed an environment inspection/assignment with its helper command, so the session denied both shell attempts in don't-ask mode. It reported the denial and stopped without mutation. The original transcript, execution manifest and unchanged snapshot are retained under `permission-preflight/` and are not a successful search run.

A second fresh session allowed the shell tools for this isolated, explicitly read-only evaluation and completed with no permission denials. No bypass mode or global setting was used. A portable evaluation launcher could document that compound environment-prefix commands do not match simple executable-prefix permissions; the narrow patterns are insufficient for this actor's legitimate read-only command shape.

## Artifacts

- `execution.json`: exact prompt, redacted invocation, exit, environment and baseline revision.
- `transcript.jsonl`: complete redacted stream including tool calls/results and final answer.
- `observations.json`: activation, loaded files, reference sizes and reported usage.
- `state.json`: before/after content and Git evidence.
- `fixture.json`: controlled generic starting inputs.
- `stderr.txt`: launcher stderr.

Private home prefixes are replaced with `<HOME>`. No real-vault content is included. A fresh independent reviewer must inspect these artifacts; this note is the executor's record only.
