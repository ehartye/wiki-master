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

Search indexes `wiki/` and `moc/`, combines exact identities, keyword candidates and semantic chunks, and returns current passages with line numbers and metadata. `--project`, `--type`, and `--status` filter results. `--include-raw` adds a separate bounded raw result channel. Inspect `tier`, `diagnostics`, and `index` when a backend is unavailable. Indexed freshness describes file versions, not factual correctness. Obsidian and Ollama requests have time limits.

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

Final verification: `node --test` ran 1,004 tests: 1,002 passed, one skipped, and one pre-existing triage-auth startup failure. The same failure reproduces on unchanged code: random port selection can hit a Windows-excluded port, producing EACCES while the server retries only EADDRINUSE. Independent spec and code-quality review found no outstanding important or critical issues after fixes. `git diff --check` passed.

Stricter citation handling exposed three malformed sources lists, now repaired against matching raw source hashes, and one remaining uncaptured NoteBuddy source. Related navigation no longer disguises that missing evidence. The structural score is therefore not directly comparable to its older, more permissive result; the remaining source gap and five unreachable derived pages are visible in [vault checks](../eval/wiki-efficacy.vault-check.json).
