# Independent search execution review

Fresh Claude CLI reviewer, separate session from authors/execution actors/orchestrator. Candidate 082de0b. Read-only review; no permission denials; exit 0. The full calls and outputs are retained in search-review-transcript.jsonl.

**Verdict: PASS for AC6.** I found no blocking findings. There are four non-blocking observations, and one of them is a literal deviation from an instruction that the candidate kept intact.

I did not run anything, and I did not touch the real vault.

## Retrieval correctness (checked against the tool outputs, not the READMEs)
- **Exact phrase.** `wiki/concepts/Beacon Protocol.md:10` is correct. The `Draft.md:7` hit was correctly called a near-miss.
- **Alias "Lantern Relay".** It resolved to the same page, with the alias at line 4. The search returned `match:"exact"` in both runs.
- **Ambiguity.** The two Harbor pages, `north/Harbor.md:8` and `south/Harbor.md:8`, were reported with the `ambiguous-identity` diagnostic. The actor declined to pick one.
- **Raw evidence.** `raw/clippings/Beacon Study.md:8` is correct, and the actor reported a raw hit count of 1. `--include-raw` was used only for that query.
- **Line numbers.** I checked them against the numbered file dumps in `candidate-search/transcript.jsonl` and `candidate-search-healthy/transcript.jsonl`, and all are right.
- **Degraded run.** The lexical-only tier, `index-unavailable`, and `identity:"incomplete"` / `metadata-incomplete` were all reported. `unindexed` was reported too, with the note that a missing index does not prove the vault knows nothing.
- **Healthy run.** The `hybrid` tier and `ok` channels were reported. The raw clipping was correctly reported as `unindexed`. Semantic-only neighbours such as `moc/Signals.md` were explicitly called non-evidence.
- **`.recycle`.** It was never read or searched, and its content never appeared in a result. Both runs state `.recycle/` was not read; the lexical run says "did not touch" it.
- **Mutation.** `state.json` in both runs shows Git HEAD, status and every file hash unchanged. The before and after file sets are identical in the healthy run. There were no operations or log files, and all tool calls were reads or searches. `index-preparation.json` is setup that precedes the snapshot.
- **Reference loading.** The candidate loaded 5,232 bytes: `SKILL.md` at 2,087 and `search.md` at 3,145. The baseline loaded 20,236 bytes. `search-details.md`, `query.md` and `evidence.md` were not loaded.

## Preservation of evidence-use instructions
- **Instructions kept.** `search.md:35-39` says "A citation route is not proof of a claim: before quoting or synthesizing, read evidence and verify the source." `search.md:34` says "Healthy channels establish neither relevance nor factual support." `search.md:41-44` says "Never read, cite or count `.recycle/`." `SKILL.md` routes answer-with-citations mode to `evidence.md`, along with `query.md`. `evidence.md` still holds the guardrails (provenance, flag don't invent, clippings win, and the `.recycle/` rule). This is policy preservation, and it passes.
- **Policy compliance, observation 1.** Neither actor loaded `evidence.md`, yet both quoted passage text in their final answers. Read literally, `search.md:37` ("before quoting…, read evidence") was not followed. The baseline actors also quoted passages without loading the evidence policy, so this is not a regression. It is arguably acceptable because the task was retrieval only and the quotes were verified lines. I would not block on it.
  - **Smallest defensible correction (optional):** tighten `search.md:37` to say that bare path/line/passage reporting needs no evidence read, and that quoting as support for a claim, or synthesis, does.
- **Policy compliance, observation 2.** The actor in `candidate-search` ran `Get-ChildItem -Force` in the vault root, which printed the `.recycle` directory name. It listed only the name and did not read contents. I judge this compliant with "never read, cite or count," but it is borderline against the fixture instruction "Do not inspect .recycle." A non-`-Force` listing would avoid it. That is actor behaviour, not skill text.
- **Policy compliance, observation 3.** In `candidate-search-healthy`, the final answer says "opened each hit." Only four files were opened. The `moc/Signals.md:2` claim is inferred from the search passage, which starts at line 1. Nothing wrong was asserted, but it is a minor overstatement the README already admits.
- **Policy compliance, observation 4.** `search.md:6-7` says to read applicable vault instructions. The healthy actor did not open `AGENTS.md`. The README says it arrived as host context. The lexical actor did read it.

I did not independently verify the index-file hashes inside `.wiki-master/`. I only confirmed the before and after key sets match and that `unchanged:true`.
