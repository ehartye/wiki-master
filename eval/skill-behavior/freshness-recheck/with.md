# Freshness probe WITH skill bodies

This is a simulation of intended behavior, not an executed wiki review. I did not access a real vault or execute app, network, Git, or wiki helper commands. The only actions executed were reading the probe input and the skill files listed below, then writing this transcript outside the repository.

## Input

User: Are the wiki recommendations still current?

Supplied facts: Structural health 100; 40 concepts; 12 lack reviewed; many edited yesterday; drift evaluated 0, failed 10 because the embedder is unavailable. Filesystem access works.

## Intended-action trace

1. Tell the user: “I’m using wiki-stale and the wiki evidence workflow to check review coverage and inspect the recommendations themselves. I’ll distinguish what has been verified from what still needs checking.” Success means a cited, bounded assessment of actual recommendation claims, with review-date and drift coverage limits made explicit.
2. Resolve the vault from WIKI_MASTER_VAULT or its documented default and verify its expected wiki/ layout. Resolve helper paths from the loaded plugin location, C:/Users/ehart/repos/wiki-master-skills, independently of cwd. Keep this a read-only report: no operation, log, index rebuild, factual changes, or publication.
3. Run the intended absolute helper command `node 'C:/Users/ehart/repos/wiki-master-skills/scripts/stale.mjs'` with the resolved vault scoped to the command. Inspect backend diagnostics and use the supported scoped filesystem fallback if CLI discovery fails. Report missing root/wiki as failure rather than an empty result. Separate pages with old factual review dates from pages missing reviewed. The 12 missing dates mean 12 of 40 concepts (30%) lack recorded factual verification; the other 28 are not automatically current.
4. Run the read-only intended coverage command `node 'C:/Users/ehart/repos/wiki-master-skills/scripts/drift.mjs' --coverage`. Preserve the supplied evaluation result separately: evaluated 0, failed 10, embedder unavailable. Do not call these concepts clean or infer zero drift; no drift evaluation succeeded. Do not start the embedder, regenerate embeddings, or wait for Obsidian to make filesystem work possible. Structural health 100 measures structural checks, not factual currency.
5. Use bounded search over wiki/ and moc/ to find recommendation passages and relevant task maps. Begin with recommendation/advice terms, then adapt to the topics actually found. The intended helper is `node 'C:/Users/ehart/repos/wiki-master-skills/scripts/search.mjs' '<observed topic terms>' --json --limit=10`. Inspect status, channel failures, current passages, review dates, and proposal versus implemented status. If a search channel fails, continue with bounded filesystem rg under explicit wiki/ and moc/ roots; disclose unavailable semantic or CLI channels. Do not infer that the missing drift embedder proves every search channel failed.
6. Select an initial bounded sample of up to five recommendation-bearing pages, prioritizing volatile guidance and evidence of frequent use, and including missing-review or old-review pages where available. Recent edits can help identify changed claims but cannot establish verification. Report the selection criteria and page coverage; do not pretend a sample covers all 40 concepts or every recommendation.
7. Read the actual selected claims and their scope. Resolve each citation route with the intended absolute resolve-evidence.mjs helper, then read the supporting raw passages at exact paths. A reachable citation route is not proof of support. Check publication/capture dates and whether the evidence is current enough for the particular claim; distinguish faithful capture from source credibility, degraded captures, contradictions, and unsupported claims. For authored guidance with sources: [], inspect any relevant current project behavior or explicit basis rather than calling its declared provenance absence a broken citation.
8. For claims whose current validity depends on changing external facts, identify the exact current authoritative evidence needed. In a real review, consult that evidence read-only when accessible. If the available evidence is only historical or the needed source cannot be checked, mark that claim unverified rather than certifying it as current. Discovery/clipping/ingestion would be separate content-changing work, so this answer does not quietly add sources to the vault.
9. Return a concise assessment with real page/source path and line citations only after reading them: claim checked, evidence date and support, outcome (supported by sufficiently current evidence, outdated/contradicted, or unresolved), and review priority. Separate those findings from metadata counts. Explicitly state the number of pages/claims checked and the untouched remainder. Never stamp reviewed based on edits, graph health, embedding refresh, or this report alone.

## Sample response supported by the supplied facts alone

“I can’t confirm that the recommendations are still current from these results. Twelve of the 40 concepts (30%) have no recorded factual review. Yesterday’s edits don’t establish that their claims were checked, and a structural health score of 100 doesn’t measure accuracy.

“The drift check also provides no assurance: it evaluated 0 pages and failed on 10 because the embedder was unavailable. Filesystem access still allows a review of the recommendations and their evidence. The next useful check is a bounded sample of frequently used or volatile guidance, with each claim compared to sufficiently current evidence. No individual recommendation has been verified in this simulation, so I can’t honestly name a current or outdated recommendation yet.”

In an executed review, replace the last paragraph with the actual cited claim findings and sample coverage. Do not invent findings or citations to make the response look complete.

## Stop condition

In the actual task, stop after the read-only metadata/coverage report and a bounded, cited claim inspection identify what the checked evidence supports and what remains unverified. State any inaccessible evidence and the unreviewed remainder; do not claim whole-wiki currency from a sample. Lack of an embedder alone is not a reason to stop the supported filesystem review. If exact vault content or current supporting evidence is inaccessible, give the precise limit rather than fabricate a verdict. This simulation stops here because executing any real vault inspection or helper was outside the probe scope.

## Loaded files and exposure

- C:/Users/ehart/repos/wiki-master-skills/eval/skill-behavior/prompts.json
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-stale/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/access.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/efficacy.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/evidence.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-query/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-search/SKILL.md
- C:/Users/ehart/repos/wiki-master-skills/skills/wiki-maintainer/references/operations.md

Rubric exposure: none. I did not read scenarios.json, tests, evaluator files, prior traces, or a real vault. Input isolation deviation: my first read displayed the whole prompts.json, so the other scenario prompts and facts were visible despite the instruction to read only freshness. Only freshness was used for this trace. No other eval files or directories were inspected. Operations was loaded because wiki-query directly required it; no mutation workflow was executed.
