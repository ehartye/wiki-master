# Candidate healthy indexed search execution

Actual candidate-plugin-loaded execution at revision `082de0b4ee151d51cc504de825d3b92b7590a5b1`, Claude Code 2.1.316, pending independent grading. The source fixture and prompt match the [healthy baseline](../baseline-search-healthy/README.md) exactly; the actor used a separate scratch vault and fresh session.

Before the actor snapshot, the executor prepared the real local Ollama index using candidate `index-embed.mjs`, the same model/host as baseline, and the scratch vault environment. Preparation exited 0 with five files and five embedded chunks. See `index-preparation.json`. This setup write precedes read-only evaluation.

The session exposed exactly five candidate wiki-master skills and no legacy wiki-master entry points. The actor invoked `wiki-user` and read only its short search reference, totaling 5,232 source bytes. Applicable fixture AGENTS instructions were host context. The actor did not explicitly open that file. It ran four helper searches and opened matching passages with numbered filesystem reads. Results reported hybrid retrieval, healthy keyword/semantic/identity channels, current indexed wiki pages, explicit raw inclusion with a healthy raw channel, and the expected unindexed raw result. Exact phrase, alias and ambiguous-name paths were preserved; no recycle result appeared.

The before/after snapshot includes the prepared index files and shows every hash, Git HEAD and status unchanged. No operations or logs appeared. The actor quotes passages without separately loading evidence policy; this is retained as an observation for the independent reviewer. Its final prose says it opened every hit, although its file-read command opens the four primary matching files, not every semantic neighbor. The exact tool transcript is authoritative.

`execution.json`, `transcript.jsonl`, `observations.json`, `state.json`, `fixture.json`, and `index-preparation.json` retain commands/exits, actual loads, source-byte measurements, host-reported token usage, artifacts and activation. These observations do not independently certify readiness or establish other workflows.
