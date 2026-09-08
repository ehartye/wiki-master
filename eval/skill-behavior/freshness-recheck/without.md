# Freshness probe transcript — without wiki-master skill bodies

This is a simulation of intended actions and a sample response, not execution against a wiki. Only the `freshness` entry in prompts.json was read. No real vault, app, network, git, helper, skill body, tests, evaluator, scenario rubric, prior trace, or other evaluation content was read or executed. The surrounding conversation includes a skill catalog with brief descriptions and general AGENTS.md guidance; these were already visible. No grading rubric was exposed.

User: Are the wiki recommendations still current?

Given facts: Structural health is 100; there are 40 concepts; 12 lack a reviewed value; many were edited yesterday; drift evaluated 0 and failed 10 because the embedder is unavailable. Filesystem access works.

Assistant — intended ordered actions (simulated):
1. Establish what can be concluded from the supplied evidence: structural health concerns organization and links, recent edits establish modification dates, and neither establishes factual currency. Treat missing review dates as unknown review status. Treat the failed drift run as unavailable evidence, with no evaluated items.
2. Read the wiki's relevant conventions, index, and concept metadata through the working filesystem. Inventory the recommendations and supporting sources across the 40 concepts, including review dates where present. Identify all 12 concepts missing review dates, and distinguish them from pages whose existing reviews may be old or insufficient for volatile claims.
3. Prioritize factual review by how quickly the subject changes and by the consequences of following the recommendation. Inspect recommendation text and cited evidence directly. Use yesterday's edits only to locate possible changes to inspect, not to mark anything verified.
4. Check prioritized claims against current authoritative primary sources, using the source of record appropriate to each claim. Record source dates, the exact recommendation checked, and whether it is supported, contradicted, or still uncertain. When a source cannot be reached, preserve the unknown status. The embedder outage does not prevent this manual factual review.
5. Return a concise report with note paths, evidence links, and separate lists of recommendations verified as current, recommendations needing revision, and recommendations not yet verified. State the actual review coverage. Report the unavailable drift check separately and avoid making its recovery a prerequisite for the manual review.
6. Do not update review dates simply because files were read or recently edited. Any later metadata update must describe a completed factual review. Surface proposed recommendation changes for follow-up rather than silently treating an assessment request as approval for broader changes.

Assistant — sample response based only on the supplied facts (simulated):
“I can't confirm that the recommendations are current from these checks. Structural health is 100, but that measures the wiki's structure. Twelve of the 40 concepts have no recorded review date, and yesterday's edits don't show that their recommendations were fact-checked. The drift check evaluated zero items and failed on ten because the embedder was unavailable, so it provides no evidence of currency.

Filesystem access still works. I would inspect the recommendations and their cited sources directly, beginning with volatile or consequential claims and the concepts missing review dates, then report which are current, which need changes, and which remain unverified.”

Stop condition: The simulation ends here without executing those actions. In a real assessment, stop after reporting the reviewed scope and evidence-backed status for each recommendation in scope, with any unverified items explicitly identified. A full-wiki claim of currency requires review of all recommendations in scope; partial review must be labeled partial. If access blocks source verification, return the concrete unresolved items and access limitation without presenting them as current. Do not wait indefinitely for the embedder when manual source checking can proceed.
