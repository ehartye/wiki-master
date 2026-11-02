# Research evidence status

The original candidate revision was `082de0b4ee151d51cc504de825d3b92b7590a5b1`; baseline was `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca`. All actors use session-only plugin loading in isolated Git vaults with local bare upstreams. Actual activation is separate from tool execution in each case's `activation.json` and `transcript.jsonl`. `before.json`, `after.json`, and computed `inspection.json` expose file hashes, provenance, operations and publication.

Initial completed observations:

| Case | Observed result |
|---|---|
| Candidate named capture | Functional artifact checks pass: one protocol raw + log; known bytes preserved; no derived page changes; thin auto-declined/triaged; HTTP503 triaged without decline; correct URL/topic/hash; scoped local publication. No broad research. Independent reviewer inspected it. |
| Baseline named capture | Same functional result. Preexisting content preserved; one raw + log committed. No broad research. Independent reviewer inspected it. |
| Candidate full flow | **FAIL:** actor skipped required independent selection despite available Task, explicitly acknowledged self-selection. It also used literal `/tmp` paths resolving outside the isolated temp directory. Factual answer, exact raw provenance/hash, existing concept reuse, lexical retrieval and local publication were observed, but do not override failed gates. |
| Baseline full flow | **FAIL:** self-selected sources and did not execute search, instead read pages directly. Factual synthesis and local publication were observed, but do not override failed gates. |
| Initial live attempt | Interrupted and unscored when the sequential harness advanced automatically after baseline flow. Private stream retained and sanitized partial transcript published. No claim of completed live discovery. |

The candidate named-capture final answer incorrectly says its vault variable was unset: its first actual PowerShell tool result shows the configured scratch path and `WIKI_MASTER_REQUIRE_VAULT=1`. The transcript governs that diagnostic observation. Both initial capture finals infer a paywall/browser-login cause from thin content although the controlled fixture is simply short; the recorded capture outcome and pipeline disposition are correct, but that inferred cause is unsupported.

All completed actors inherited per-case `TEMP`, `TMP`, and `TMPDIR`. The original request metadata omitted these fields; it has been corrected from the actual harness environment. `temporary-artifacts.json` records the actual isolated capture token/ledger files. Literal `/tmp` in the candidate flow bypassed these environment variables; that run remains failed. The neutral rerun constraint requires environment-based case temp paths and forbids literal shared `/tmp`. No global temp mapping was changed.

The independent source review approved a narrow pre-capture discovery checkpoint. Corrected candidate `c705af263d0d7b2ff2d6bd7a97e4632cb48da3dc` is being exercised with the same original scenario and neutral temp rule in `recheck/`. This does not retroactively pass the failed initial run. Live discovery will only start after independent-selection execution is established in the corrected controlled run.

No authenticated capture or converter execution is established by these HTML scenarios. All factual corpus statements are synthetic, not claims about a deployed protocol.

## First corrected-source recheck

`recheck/candidate-flow` used candidate `c705af263d0d7b2ff2d6bd7a97e4632cb48da3dc` and the same original scenario plus the neutral temp-path rule. It made five actual read-only Agent calls and the orchestrator selected afterwards. Raw body hashes match, preexisting raw bytes remain unchanged, concept reuse and local publication were observed, and no literal shared `/tmp` command was used.

**The complete-flow result remains FAIL:** zero actual search helper calls; the final says it answered by reading pages directly because no semantic index was built. The requested search-and-answer workflow requires real retrieval; semantic unavailability is not grounds to skip lexical search. Live execution remains held pending the next reviewed correction. This failure is not replaced by the correct factual answer.

The fresh baseline paired flow also completed and remains **FAIL**: it used two of five workers and explicitly did not execute `search.mjs`, answering from pages it wrote and re-read. That baseline is retained without additional attempts to obtain a favorable result. Its raw hashes and local publication match, but these do not satisfy the missing retrieval gate. The candidate's independent five-finder execution is a measured difference in this pair.

## Final controlled candidate

Candidate `5e1bb6d106391af7e033a3418332aeed56eaa3c3` completed the fresh same-scenario controlled flow in `final/candidate-flow`. Five read-only finders executed; the orchestrator selected. It captured exactly one new source, reused the existing concept, completed separate discover/ingest operations, and executed `search.mjs` both normally and with raw inclusion before resolving exact evidence. Its answer accurately states 3 retries, 4 total attempts and deliver-once/cached-ack semantics while retaining synthetic-specification limitations. Raw body hashes match, `raw-history.json` proves the first committed raw bytes equal final bytes, and both scoped commits match the local bare remote with clean Git.

`final/fixture-comparison.json` compares the initial baseline and final candidate source pages and starting vaults: synthetic HTML bytes are identical; the only starting file hash difference is the known raw clipping's loopback URL port metadata. Reference loads occurred using Bash `head`/`cat`, so the absence of Read-tool entries in `activation.loadedFiles` is not evidence that no reference was read. The actual shell reference commands are retained in `inspection.json` and transcript. Independent review determines the final gate result.

The separate bounded live run is recorded under `live/`; no authenticated format/service or converter coverage is inferred from this HTML run.

## Bounded live discovery

`live/candidate-live` used candidate `5e1bb6d106391af7e033a3418332aeed56eaa3c3` in a separate fresh vault. The stream records five actual WebSearch tool calls from five read-only finder agents, their fetched candidates and the orchestrator's selection. Exactly two new official URLs were captured: `https://www.rfc-editor.org/rfc/rfc9110` and `https://www.rfc-editor.org/rfc/rfc9111`. The operation committed only those raw clippings and one log, pushed to the local bare origin, and finished clean. Raw hashes match; preexisting raw bytes and all derived pages are unchanged.

Both RFC captures carry `fidelity: partial` and fidelity triage records. The actor checked that ETag, If-None-Match, 304 and validation sections survived extraction; it did not clear the warnings or claim full fidelity. It disclosed upstream fetch failures and truncation. This establishes real public source-finding and HTML capture execution, not authenticated integrations or converter availability.

The actor final understates its pre-search deduplication: actual tools performed known-URL count, topic summary and full URL enumeration before finder dispatch, then checked selected URLs before capture. Independent review uses those actual calls, not the inaccurate self-description.

Public live raw bodies are omitted; complete captures and the original actor transcript remain in the isolated scratch vault for independent inspection. `public-content-omissions.json` describes redactions. `inspection.json` hashes were computed from the complete captures before public body omission, and `raw-history.json` compares actual Git bytes against the final scratch files. WebSearch inputs and corresponding results remain in the public transcript for exact-query auditing. The helper `redact-live.mjs` bounds content-bearing fetch/read outputs to 400 characters. The known synthetic fixture remains public.
