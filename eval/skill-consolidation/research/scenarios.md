# Research execution scenarios

Skill baseline: `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca`.
Candidate source: `082de0b4ee151d51cc504de825d3b92b7590a5b1`.

These requirements are declared before actor execution. Each baseline/candidate
condition gets a fresh session with only its session-loaded wiki-master plugin,
an equivalent isolated vault, and its own local bare Git upstream. Fixture HTTP
content is explicitly synthetic evaluation material, not real-world evidence.

1. Named capture: invoke the actual role, skip broad source research, check known
   URL membership, capture a new substantive page, leave the known duplicate
   untouched, and report thin/failed captures honestly. The successful clip must
   contain the requested topic, canonical URL and a matching source hash; only
   tools create its body. Capture-only leaves source/concept pages unchanged.
   Finish scoped log/commit/sync and verify the local remote; retain failures and
   restrictions rather than fabricate missing source text.
2. Controlled discovery plus complete flow: given a topic and a local search
   corpus catalog, independently find/select candidates with provenance and
   credibility, skip the known duplicate, capture a new useful source, ingest only
   the authorized captured set, reuse the existing related concept where useful,
   and search/answer the question with accurate exact evidence citations. Inspect
   raw hashes/bytes, summaries, concept, logs, operations, history and local remote.
   This is controlled discovery, never described as live web discovery.
3. Bounded live discovery: actual public WebSearch and inspection of independently
   found official sources, dedup, capture at most two on HTTP conditional requests,
   and report observed limitations. This run is capture-only. Retain exact search
   queries and captured URLs. No authenticated Confluence or converter success is
   inferred from HTML capture.

A successful CLI exit is not a passed behavioral gate. Fresh independent grading
must inspect the transcript and actual artifacts. Record activation inventory,
explicit Skill invocation, loaded references and execution separately. A missing
execution capability or a failed search/discovery/ingestion step blocks readiness.
