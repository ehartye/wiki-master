---
type: authored
status: maintained
sources: []
ai-generated: true
project: plugin-docs
kind: reference
---

# Wiki efficacy

The wiki keeps Markdown as its source of truth. These helpers improve retrieval, distinguish concept identities, propose useful relationships, and expose verification coverage without introducing a database or a scheduler.

## Commands

Run from the plugin root; set `WIKI_MASTER_VAULT` or pass the supported `--vault` option for another vault.

```sh
node scripts/search.mjs "if-then planning" --json --limit=10
node scripts/search.mjs "maintenance" --project=wiki-master --type=authored --json
node scripts/identity-audit.mjs --json --limit=20
node scripts/relationships.mjs --seed="wiki/concepts/Implementation Intentions.md" --limit=10 --json
node scripts/drift.mjs --coverage --json
node scripts/drift.mjs --limit=10 --json
node scripts/stale.mjs
node scripts/index-embed.mjs --status
node scripts/evaluate-retrieval.mjs --questions eval/wiki-efficacy.questions.json --split development --output eval/development.json
```

Search indexes `wiki/` and `moc/`, combines exact identities, keyword candidates and semantic chunks, and returns current passages with line numbers and metadata. `--project`, `--type`, and `--status` filter results. `--include-raw` adds a separate bounded raw result channel. The keyword channel reads `wiki/`, `moc/` and, with `--include-raw`, `raw/` directly from the Markdown files and ranks candidates by exact phrase, then all query terms, then partial matches (`scripts/lib/fs-keyword.mjs`); it needs no running app. `--include-moc` is retired and ignored. Inspect `tier`, `diagnostics`, and `index` when a backend is unavailable. Indexed freshness describes file versions, not factual correctness. Ollama requests have time limits.

Aliases mean equivalent names; scope distinguishes nearby concepts. Exact identities use filenames, explicit frontmatter titles and aliases; H1 headings remain display and approximate retrieval signals. Exact labels preserve punctuation and ambiguous identities remain ambiguous. A canonical full path takes precedence. The identity audit reports candidates for human/agent review; repeated source/concept basenames can be intentional. It never renames or merges pages.

Relationship candidates are read-only, bounded, and explicitly unverified. `--since YYYY-MM-DD` limits attention to changed pages; `--semantic` uses existing fresh vectors. Shared evidence is a reason to inspect two pages, not proof that their claims agree. Record an accepted link with its role and an explanation in `## Relationships`. Keep factual citations outside that section. Evidence traversal follows source/raw citation routes and excludes lateral concept navigation.

`reviewed` means factual verification, `updated` means edited. Missing review dates remain unverified. Drift coverage reports total, eligible, ineligible, evaluated, failed and skipped pages. Coverage-only runs do not embed or update drift caches. A bounded run evaluates only its stated page sample. Long documents use up to eight evenly spaced structural chunks (at most 1,200 characters each), across up to eight evidence documents per page. Results disclose document/chunk sampling and partial coverage. This prevents model-context failures without claiming full-document verification; cosine drift cannot prove truth or detect all contradictions.

## Agent workflows

The shared contract is [efficacy.md](../skills/wiki-maintainer/references/efficacy.md). Concept and task-map templates live in `templates/_templates/`. Ingest checks canonical identity before creating pages. Discovery starts from an unanswered question and records the evidence added and pages changed. Relink uses explained relationship roles. Lint samples semantics even when structural health is clean. Weekly review is a suggested cadence, not an installed automated job.

Task maps are curated entry points around recurring questions, distinct from generated catalogs. Start with the live vault's Agent Knowledge and Wiki Maintenance and Learning and Goal-Directed Behavior maps.

## Evaluation and limits

`eval/wiki-efficacy.questions.json` contains 40 real-vault questions: 30 development and 10 held out, covering exact names, aliases, paraphrases, tasks, complementary topics and state. The runner records page recall@10, precision@3, reciprocal rank, labeled passage/evidence outcomes, backend diagnostics, latency and estimated output tokens. Missing ground truth and unavailable labeled metrics make a run incomplete (exit 2); malformed input is an error (exit 1). Evidence correctness evaluates only explicitly judged positive/forbidden citations, not entailment. Most questions currently judge pages; only one labels a passage and two label evidence. Expand those judgments before treating them as broad citation-quality measures.

The original Obsidian CLI stopped responding during baseline collection. The saved baseline therefore measures the original semantic-only search, with keyword search disabled. Compare it with the same controlled backend condition; do not describe it as a full hybrid before/after result. Context construction is excluded from new-query latency. Rich passages and diagnostics cost more output tokens than the legacy path-only response. Held-out results are reported after development work, not used to tune query-specific behavior.

These capabilities are introduced in version 0.35.0. Installed plugins must be updated to that version; live vault content and templates were applied independently of the plugin release.

## September 2026 validation

The controlled comparison kept Obsidian keyword search disabled for both versions. Baseline used commit `82059ee`; the new run also includes the approved vault pilot and MOC index, so this measures the combined change rather than isolating ranking code.

| Metric | Before | After |
| --- | ---: | ---: |
| Expected-page recall@10, all 40 | 88.75% | 97.50% |
| Development recall@10, 30 | 91.67% | 96.67% |
| Held-out recall@10, 10 | 80.00% | 100.00% |
| Development reciprocal rank | 0.790 | 0.876 |
| Held-out reciprocal rank | 0.700 | 0.721 |
| Development precision@3 | 0.333 | 0.356 |
| Held-out precision@3 | 0.267 | 0.300 |

All eight development alias queries ranked their expected page first. The one labeled passage and two evidence cases passed; the original response omitted these fields, so their baseline metrics are unavailable. The remaining development miss retrieved relevant source material but missed the specifically expected Source Attribution concept. These small, locally authored judgments do not establish general retrieval or citation accuracy.

Rich JSON output increased from about 306 to 4,296 estimated tokens per question (characters/4). It carries passages and provenance diagnostics that the legacy response lacked. Use compact default text for path lookup or `--limit=3 --json` for a small evidence-bearing result; use ten for exploratory retrieval and evaluation. Latency is not a fair speed comparison: the new run reuses an in-memory context, the baseline reloads its index, and model warming differs.

The live drift sample evaluated 10 pages with zero failures; all ten used partial document/chunk sampling. No sampled page crossed the drift threshold. This is not a clean bill of health for the 1,081 concept/synthesis pages or a factual review of the sampled pages. Ten existing concept review dates were preserved. New maps and source/concept pages have valid citation routes. One existing forward link on the edited RAG page remains deferred.

Reports: [baseline](../eval/wiki-efficacy.baseline.json), [development](../eval/wiki-efficacy.after-development.json), [held-out](../eval/wiki-efficacy.after-heldout.json), [drift sample](../eval/wiki-efficacy.drift-sample.json), [pilot checks](../eval/wiki-efficacy.pilot-check.json).

Final verification: `node --test` ran 1,004 tests: 1,002 passed, one skipped, and one pre-existing triage-auth startup failure. The same failure reproduces on unchanged code: random port selection can hit a Windows-excluded port, producing EACCES while the server retries only EADDRINUSE (confirmed and fixed in 0.44.1). Independent spec and code-quality review found no outstanding important or critical issues after fixes. `git diff --check` passed.

Stricter citation handling exposed three malformed sources lists, now repaired against matching raw source hashes, and one remaining uncaptured NoteBuddy source. Related navigation no longer disguises that missing evidence. The structural score is therefore not directly comparable to its older, more permissive result; the remaining source gap and five unreachable derived pages are visible in [vault checks](../eval/wiki-efficacy.vault-check.json).

## Keyword-engine questions

`eval/keyword-engine.questions.json` holds 42 questions that only the keyword channel can answer, because the general set above is dominated by exact names and paraphrases and cannot tell keyword engines apart. Each category has 14 questions (33 development, 9 held out): a rare `identifier` found on 1-4 pages and absent from every title, alias and filename; a `conjunction` of three moderately common terms (each on 10-300 pages, taken from one paragraph) that co-occurs on 1-3 pages; and a three-word `phrase` on 1-3 pages. Ground truth is every page whose text contains the string, by case-insensitive substring match over the vault snapshot, so nothing is judged by taste. `scripts/build-keyword-eval.mjs` generates the set from a seed; the committed JSON is the frozen artifact, and regenerating it is a deliberate act.

Run it with `node scripts/evaluate-retrieval.mjs --questions eval/keyword-engine.questions.json --keyword-only`. `--keyword-only` builds the search context as if the semantic service were down, so only keyword and identity candidates rank; leave it off to measure the full hybrid. The report records the setting under `configuration`.

Baseline on 2026-10-19 (plugin 0.44.1, 7,883 pages), page recall@10 overall and by category. Summaries are in `eval/keyword-engine.baseline.json`.

| Configuration | Overall | Identifier | Conjunction | Phrase |
|---|---|---|---|---|
| Filesystem keyword, keyword-only | 0.437 | 0.452 | 0.786 | 0.071 |
| Filesystem keyword, hybrid | 0.399 | 0.506 | 0.405 | 0.286 |
| Obsidian keyword (0.42.1), keyword-only | 0.460 | 0.524 | 0.786 | 0.071 |
| Obsidian keyword (0.42.1), hybrid | 0.375 | 0.530 | 0.310 | 0.286 |
| No keyword channel, identity only | 0.056 | 0.095 | 0.000 | 0.071 |
| No keyword channel, semantic and identity | 0.224 | 0.149 | 0.238 | 0.286 |

What it shows, and what it does not:

- **The questions need the keyword channel.** Without it recall falls from 0.44 to 0.06 keyword-only and from 0.40 to 0.22 in hybrid.
- **The filesystem engine is not the weak point; the final ranking is.** The engine ranks an expected page first for all 42 questions, but only 7 of 14 identifier, 11 of 14 conjunction and 1 of 14 phrase questions keep it in the final top ten. After the engine admits candidates, `main()` re-ranks them by `lexicalScore` (whole-word counts, with an alphabetical tie-break) and the engine's order is discarded. A phrase on a page that shares its three words with dozens of others ties with them and loses to the alphabet.
- **It does not separate the two engines.** Filesystem and Obsidian differ on one question each way (19 found by both, 22 by neither) because the ranking step dominates, so it measures the pipeline, not the engine alone. The filesystem engine is faster (about 1.2 against 2.1 seconds per question with a warm Obsidian).
- **Hybrid is below keyword-only** overall (0.399 against 0.437): for exact-string queries the semantic channel adds noise that rank fusion lets displace exact matches.
- **Fixed in 0.46.0.** The engine's rank became a third list in the final fusion and tied lexical scores share a rank. Same live vault, page recall@10 overall (identifier, conjunction, phrase): keyword-only 0.437 -> 0.937 (0.452 -> 0.881, 0.786 -> 0.929, 0.071 -> 1.000); hybrid 0.399 -> 0.722 (0.506 -> 0.762, 0.405 -> 0.762, 0.286 -> 0.643). The third list alone gave 0.847 and 0.611. The 40-question set held (recall 0.9375 -> 0.938, MRR 0.809 -> 0.835), and two runs matched per question. Hybrid still trails keyword-only, so the semantic channel's noise on exact-string queries is still open. The tables above are the 0.44.1 baseline; the after numbers are in `eval/keyword-engine.baseline.json`.
- **Fixed in 0.47.0.** Hybrid trailed keyword-only (0.722 against 0.937) because the semantic list returns topical neighbours that fusion lets displace pages holding the exact string. A temporary weight on that list showed no constant works: weight 0 gives 0.937 on this set but 0.813 on the 40-question set (paraphrase 0.375), and only weight 1 holds that set's guard. `exactMatchGate` instead drops the semantic vote per query when the candidate pages answer it exactly: 1 to 3 hold the whole query as written, or a query of at most 5 terms has 1 to 3 pages holding every term in one paragraph. Hybrid recall@10 on this set is 0.937 (identifier 0.881, conjunction 0.929, phrase 1.000); the 40-question set holds (recall 0.938, MRR 0.835 -> 0.823, guard 0.809). Two runs matched per question; the result is flat for a page limit of 3 to 5 and a term limit of 3 to 6. Limits: the limits were chosen on these two sets, the conjunction questions are built from one paragraph (which the paragraph signal matches by construction), and a short query that happens to be a rare real word drops the semantic vote on purpose. Numbers are in `eval/keyword-engine.baseline.json`.
- **Limits:** 14 questions per category and a single run, so differences of one or two questions are noise. The conjunction triples are exact but not natural queries. The vault is a moving snapshot; edited pages surface as `missingExpectedPages`. Latencies use a warm Obsidian.
