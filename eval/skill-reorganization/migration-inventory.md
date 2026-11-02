# Section migration inventory

Baseline: wiki-master `8720f90` (0.88.0), inspected 2026-11-02 before candidate authoring. This is a destination contract, not a claim that candidates already exist. `setup`, `search`, `project`, `maintainer`, `researcher`, `purge` abbreviate the six `wiki-*` skill owners. Reference labels below are proposed functional homes; WP2/WP3 must reconcile them with the final stable paths. Mixed rows require extraction, not whole-file copies.

Every Markdown heading outside code fences is listed below. A heading governs its body until the next heading; the embedded-section table separately accounts for numbered steps and bold subprocedures inside mixed bodies. Leading reference-loading paragraphs follow the owning task, with direct links to shared policy and matching setup checks. All 28 references are included.

## Complete reference sections

### 1. `skills/wiki-init/references/setup.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Set up a new vault (1) | setup / initialization: root verification, non-overwriting scaffold, local-only completion and optional app registration |

### 2. `skills/wiki-maintainer/references/access.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Vault access and host commands (1) | maintainer / access: canonical root, read scope, supported channels and guarded action policy; setup / app-access owns failure diagnosis and shell/prerequisite troubleshooting |
| Layout and read scope (15) | maintainer / access: canonical root, read scope, supported channels and guarded action policy; setup / app-access owns failure diagnosis and shell/prerequisite troubleshooting |
| Choose the supported channel (29) | maintainer / access: canonical root, read scope, supported channels and guarded action policy; setup / app-access owns failure diagnosis and shell/prerequisite troubleshooting |
| Shell portability (64) | maintainer / access: canonical root, read scope, supported channels and guarded action policy; setup / app-access owns failure diagnosis and shell/prerequisite troubleshooting |

### 3. `skills/wiki-maintainer/references/efficacy.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Keeping knowledge findable and trustworthy (1) | maintainer / efficacy: single normative identity/relationship policy; detailed checking procedures to setup / checks |
| Concept identity (5) | maintainer / efficacy: single normative identity/relationship policy; detailed checking procedures to setup / checks |
| Relationships and citations (11) | maintainer / efficacy: single normative identity/relationship policy; detailed checking procedures to setup / checks |
| Task maps and discovery (19) | maintainer / efficacy: single normative identity/relationship policy; detailed checking procedures to setup / checks |
| Verification and maintenance cadence (25) | setup / checks: bounded verification/reporting cadence and coverage; maintainer retains concise evidence/date obligations |

### 4. `skills/wiki-maintainer/references/evidence.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Evidence and editorial policy (1) | maintainer / evidence: single normative source for schema, factual dates, evidence restrictions and editorial policy; project-specific procedure linked to project |
| Page schema and dates (3) | maintainer / evidence: single normative source for schema, factual dates, evidence restrictions and editorial policy; project-specific procedure linked to project |
| Non-negotiable guardrails (19) | maintainer / evidence: single normative source for schema, factual dates, evidence restrictions and editorial policy; project-specific procedure linked to project |
| Reddit and Medium (53) | maintainer / evidence: single normative source for schema, factual dates, evidence restrictions and editorial policy; project-specific procedure linked to project |
| Style: viewpoints whole, conclusions after, breadcrumbs always (80) | maintainer / evidence: single normative source for schema, factual dates, evidence restrictions and editorial policy; project-specific procedure linked to project |

### 5. `skills/wiki-maintainer/references/health.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Report wiki health and backlog (1) | setup / checks: read-only structural health, backlog metrics and honest coverage |

### 6. `skills/wiki-maintainer/references/lint.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Review wiki consistency and factual claims (1) | setup / checks owns reporting and interpretation; maintainer / lint owns authorized factual repairs and persisted dispositions |

### 7. `skills/wiki-maintainer/references/maintenance.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Maintenance metrics, repairs and limits (1) | maintainer / maintenance owns hash-join invariant and content repair recipes; setup / checks owns metric reporting and diagnostic interpretation |
| Integrity worklist (3) | setup / checks: structural issue metrics and coverage; authorized repair handoff to maintainer |
| "Has this been ingested?" — a content-hash join, not a guess (20) | maintainer / maintenance owns hash-join invariant and content repair recipes; setup / checks owns metric reporting and diagnostic interpretation |
| Known limits of the pattern (160) | maintainer / maintenance owns hash-join invariant and content repair recipes; setup / checks owns metric reporting and diagnostic interpretation |
| Cost discipline (182) | setup / checks: bounded verification/reporting cadence and coverage; maintainer retains concise evidence/date obligations |

### 8. `skills/wiki-maintainer/references/obsidian-cli.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Driving the Obsidian CLI (4) | maintainer / obsidian-cli owns guarded actions and live command syntax; setup / app-access owns prerequisites and failures |
| Windows invocation — REQUIRED (24) | setup / app-access: Windows redirector, lazy canary and truthful backend diagnosis; maintainer retains guarded-action obligation |
| Empty is not an answer (39) | setup / app-access: Windows redirector, lazy canary and truthful backend diagnosis; maintainer retains guarded-action obligation |
| Syntax and the live contract (61) | maintainer / obsidian-cli owns guarded actions and live command syntax; setup / app-access owns prerequisites and failures |
| Read / search (76) | maintainer / obsidian-cli owns guarded actions and live command syntax; setup / app-access owns prerequisites and failures |
| Links & graph (87) | maintainer / obsidian-cli owns guarded actions and live command syntax; setup / app-access owns prerequisites and failures |
| Typed properties (frontmatter) (99) | maintainer / obsidian-cli owns guarded actions and live command syntax; setup / app-access owns prerequisites and failures |
| Create / edit / move (104) | maintainer / obsidian-cli owns guarded actions and live command syntax; setup / app-access owns prerequisites and failures |
| Tags, tasks, templates, bases (110) | maintainer / obsidian-cli owns guarded actions and live command syntax; setup / app-access owns prerequisites and failures |
| Escape hatches (115) | maintainer / obsidian-cli owns guarded actions and live command syntax; setup / app-access owns prerequisites and failures |

### 9. `skills/wiki-maintainer/references/operations.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Completion for vault mutations (1) | maintainer / operations owns normal mutation lifecycle and policy; setup / operation-recovery owns detailed failure diagnosis, recovery and verification recipes |
| Recovery and token ownership (156) | split: maintainer / operations keeps ownership/holds/delegation/completion policy; setup / operation-recovery gets retry, uncertain completion, cleanup, abort, refusal diagnostics and Git setup |
| Exceptions with their own transaction (260) | maintainer / operations: normal portable lifecycle and transaction exceptions; recovery references direct |
| Executable lifecycle templates (275) | maintainer / operations: normal portable lifecycle and transaction exceptions; recovery references direct |

### 10. `skills/wiki-maintainer/references/relink.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Connect concepts and task maps (1) | maintainer / relink: canonical identity, explained relationships and task maps; reporting/check procedures linked directly to setup / checks |

### 11. `skills/wiki-maintainer/references/repair.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Repairing wiki integrity (1) | maintainer / repair: evidence-led scoped repairs and issue acceptance; diagnostic checks linked directly to setup / checks |

### 12. `skills/wiki-maintainer/references/stale.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Report freshness and review needs (1) | setup / checks: read-only freshness and drift coverage; cited claim answers route to search |

### 13. `skills/wiki-maintainer/references/triage.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| What this is for (5) | maintainer / triage: queue, dispositions, topic attribution and actions; remote access/session recovery to setup / app-access |
| Show the queue (11) | maintainer / triage: queue, dispositions, topic attribution and actions; remote access/session recovery to setup / app-access |
| Triaging from another machine (25) | split: maintainer / triage retains requested remote action syntax; setup / app-access owns reachability, token/port recovery and network prerequisites |
| Grouping by research topic (47) | maintainer / triage: queue, dispositions, topic attribution and actions; remote access/session recovery to setup / app-access |
| Read dispositions back (62) | maintainer / triage: queue, dispositions, topic attribution and actions; remote access/session recovery to setup / app-access |
| Queue something yourself (97) | maintainer / triage: queue, dispositions, topic attribution and actions; remote access/session recovery to setup / app-access |
| Guardrails (118) | maintainer / triage: queue, dispositions, topic attribution and actions; remote access/session recovery to setup / app-access |

### 14. `skills/wiki-maintainer/references/workflows.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Domain workflow reference (1) | maintainer / workflows: comparison/routing only; original-document procedure merged into project, search links to search and reporting links to setup |
| Workflows (6) | maintainer / workflows: comparison/routing only; original-document procedure merged into project, search links to search and reporting links to setup |

### 15. `skills/wiki-purge/references/purge.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Purging a topic (4) | purge / purge: approved plan, apply, restore, reconciliation and publication gates; diagnostic/recovery detail to setup / operation-recovery and verification to setup / checks |
| Steps (40) | purge / purge: approved plan, apply, restore, reconciliation and publication gates; diagnostic/recovery detail to setup / operation-recovery and verification to setup / checks |
| When a purge stops partway (116) | setup / operation-recovery: partial purge reconciliation (never replay apply); purge keeps authorization and transaction ownership |
| Restoring (130) | purge / purge: approved plan, apply, restore, reconciliation and publication gates; diagnostic/recovery detail to setup / operation-recovery and verification to setup / checks |
| Rules (143) | purge / purge: approved plan, apply, restore, reconciliation and publication gates; diagnostic/recovery detail to setup / operation-recovery and verification to setup / checks |

### 16. `skills/wiki-researcher/references/capture.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Capture named sources and research selections (4) | researcher / capture: named and selected capture, outcomes, immutable evidence and exact-set handoff; troubleshooting to setup / capture-prerequisites |
| Named sources (14) | researcher / capture: named and selected capture, outcomes, immutable evidence and exact-set handoff; troubleshooting to setup / capture-prerequisites |
| Capture the selected sources (38) | researcher / capture: named and selected capture, outcomes, immutable evidence and exact-set handoff; troubleshooting to setup / capture-prerequisites |
| Finish capture and report (118) | researcher / capture: named and selected capture, outcomes, immutable evidence and exact-set handoff; troubleshooting to setup / capture-prerequisites |
| Guardrails (150) | researcher / capture: named and selected capture, outcomes, immutable evidence and exact-set handoff; troubleshooting to setup / capture-prerequisites |

### 17. `skills/wiki-researcher/references/clip-confluence.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Clipping a Confluence page into the wiki (5) | researcher / clip-confluence: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| How it works (30) | researcher / clip-confluence: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Graceful degradation when confluencer isn't installed (57) | setup / capture-prerequisites: focused clip-confluence troubleshooting; capture reference retains supported options and fidelity obligation with direct link |
| Steps (87) | researcher / clip-confluence: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Known limitation: re-clipping an updated page (118) | setup / capture-prerequisites: focused clip-confluence troubleshooting; capture reference retains supported options and fidelity obligation with direct link |
| Guardrails (131) | researcher / clip-confluence: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Completion (143) | researcher / clip-confluence: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |

### 18. `skills/wiki-researcher/references/clip-docx.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Clipping a Word document into the wiki (5) | researcher / clip-docx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| How it works (15) | researcher / clip-docx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Steps (36) | researcher / clip-docx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Guardrails (66) | researcher / clip-docx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Completion (76) | researcher / clip-docx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |

### 19. `skills/wiki-researcher/references/clip-gh.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Clipping a GitHub repository into the wiki (5) | researcher / clip-gh: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| How it works (30) | researcher / clip-gh: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Per-file mode (small repos) (52) | researcher / clip-gh: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Digest mode (large repos — output bounded, not 1:1 with file count) (74) | researcher / clip-gh: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Steps (161) | researcher / clip-gh: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Guardrails (210) | researcher / clip-gh: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Completion (229) | researcher / clip-gh: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |

### 20. `skills/wiki-researcher/references/clip-pdf.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Clipping a PDF into the wiki (5) | researcher / clip-pdf: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| How it works (20) | researcher / clip-pdf: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Steps (100) | researcher / clip-pdf: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Preserving figures (`--figures`) (148) | researcher / clip-pdf: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Overriding the reading mode (205) | setup / capture-prerequisites: focused clip-pdf troubleshooting; capture reference retains supported options and fidelity obligation with direct link |
| Guardrails (242) | researcher / clip-pdf: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Completion (254) | researcher / clip-pdf: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |

### 21. `skills/wiki-researcher/references/clip-pptx.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Clipping a PowerPoint deck into the wiki (5) | researcher / clip-pptx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| How it works (16) | researcher / clip-pptx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Steps (44) | researcher / clip-pptx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Guardrails (74) | researcher / clip-pptx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Completion (87) | researcher / clip-pptx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |

### 22. `skills/wiki-researcher/references/clip-xlsx.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Clipping a spreadsheet into the wiki (5) | researcher / clip-xlsx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| How it works (22) | researcher / clip-xlsx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Steps (43) | researcher / clip-xlsx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Guardrails (74) | researcher / clip-xlsx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |
| Completion (86) | researcher / clip-xlsx: capture format, supported helper, evidence limitations, guardrails and completion; setup / capture-prerequisites owns preflight, troubleshooting and recovery |

### 23. `skills/wiki-researcher/references/discover.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Discover sources on a topic (4) | researcher / discover: dedup, five perspectives and independent selection, authorized capture handoff |
| Independence checkpoint before capture (12) | researcher / discover: dedup, five perspectives and independent selection, authorized capture handoff |
| Phase 0 — dedup before searching (27) | researcher / discover: dedup, five perspectives and independent selection, authorized capture handoff |
| Phase 1 — five perspective researchers (parallel if supported, else sequential) (47) | researcher / discover: dedup, five perspectives and independent selection, authorized capture handoff |
| Phase 2 — independent select + credibility (do NOT let a finder grade itself) (68) | researcher / discover: dedup, five perspectives and independent selection, authorized capture handoff |

### 24. `skills/wiki-researcher/references/ingest.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Ingest captured evidence (1) | researcher / ingest: exact eligible set, hash-join membership, restrictions, zero-work exit, derived pages and completion; required checks directly link setup |
| Select eligible work before opening an operation (16) | researcher / ingest: exact eligible set, hash-join membership, restrictions, zero-work exit, derived pages and completion; required checks directly link setup |
| Ingest and complete the selected set (47) | researcher / ingest: exact eligible set, hash-join membership, restrictions, zero-work exit, derived pages and completion; required checks directly link setup |

### 25. `skills/wiki-user/references/authoring.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Author original wiki documentation (1) | project / authoring: canonical placement, metadata, project identity, living documentation and catalog completion; detailed validation moves to setup / validation |
| Canonical placement for original project documentation (62) | project / authoring and backlog: placement/metadata and all lifecycle/catalog semantics |
| Keeping project documentation honest (154) | project / authoring: as-built architecture, current roadmap, balanced/reconstructed ADRs, failures and intent/behavior distinction |
| Validating what a task wrote (186) | setup / validation: complete scoped validator contract; project retains obligation and direct link |

### 26. `skills/wiki-user/references/query.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Answer from the wiki (1) | search / cited answers: retrieval, evidence reading and attributed synthesis; authorized filing extracted to maintainer / synthesis-filing |

### 27. `skills/wiki-user/references/search-details.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Search diagnostics and evidence routes (1) | search / advanced: filters, identities, raw lookup and provenance; diagnostics to setup / search-diagnostics; lifecycle listing to project / backlog |
| How it works (6) | search / advanced: filters, identities, raw lookup and provenance; diagnostics to setup / search-diagnostics; lifecycle listing to project / backlog |
| Explicit raw lookup (58) | search / advanced: filters, identities, raw lookup and provenance; diagnostics to setup / search-diagnostics; lifecycle listing to project / backlog |
| Jumping from a wiki/ hit to its raw/ evidence (76) | search / advanced: filters, identities, raw lookup and provenance; diagnostics to setup / search-diagnostics; lifecycle listing to project / backlog |

### 28. `skills/wiki-user/references/search.md`

| Baseline section (line) | Canonical destination / retained capability |
|---|---|
| Find pages and passages (1) | search main / Simple search: executable bounded retrieval, matched passages, citations and coverage limits; diagnostic recipes to setup / search-diagnostics |

## Embedded sections requiring a split

| Baseline section / content | Destination or merged equivalent |
|---|---|
| search.md steps 1, 3, 4 and final read-only paragraph | search main: resolve absolute helper and vault; bounded query; exact match passage, citation and planned/shipped distinctions; no operation/index writes |
| search.md step 2; search-details How it works status/channel/freshness interpretation | search retains concise disclose-coverage obligation; setup/search-diagnostics owns detailed tier, channel, semantic-gate and freshness interpretation |
| search-details How it works health/setup/index commands | setup/search-diagnostics; no automatic install, model pull or index rebuild |
| search-details How it works backlog-list example | project/backlog (page status versus backlog lifecycle); search directly links when request is listing work |
| search-details Explicit raw lookup and evidence-route outputs | search/advanced: explicit include-raw, raw counts, failed raw not searched, unreachable versus declared-no-provenance |
| query steps 1–2; Reddit/Medium and cross-topic reasoning | search/cited answers plus direct normative evidence link |
| query step 3 and conditional operations preamble | maintainer/synthesis-filing; retain query operation semantics; original documentation instead routes project; no filing from search |
| authoring steps 1–4, placement table, overview repo, project/kind and ADR status | project/authoring; standalone project-less original notes remain supported |
| authoring step 5 and Validating what a task wrote (ledger/results/public checks/rule catalog) | setup/validation owns procedure and detailed rules; project retains scoped validation obligation and direct link |
| authoring steps 6–7, backlog lifecycle/dependencies/startable/collapse/generated metadata, living updates | project/authoring and backlog own catalog and original-content guidance; normal completion directly invokes maintainer operations |
| access root resolution, Layout and read scope, channel table, guard size/timeout/lock/uncertain write boundaries | maintainer/access owns normative policy and practical root resolution; setup/app-access owns detailed failure checks |
| access Shell portability | maintainer/access retains normal shell environment scope examples; setup/app-access owns Windows executable-selection gotcha |
| operations numbered steps 1–7 | maintainer/operations retains open-before-write, ledger, catalog, log, close, sync, remote verification and non-Git/hold policy; project owns full authored catalog instructions |
| operations step 2 refused pre-dirty/unscoped close, step 7 conflict/lock/overlap/error-output detail | setup/operation-recovery; obligations not to adopt foreign files or invent completion stay maintainer |
| operations Recovery: Retry/Reconcile/Abandoned tokens/Stopping early/Refused sync/Refusal record | setup/operation-recovery owns recipes and diagnostics; maintainer keeps token ownership, no manual token/lock deletion, preserve foreign edits, holds, delegation and actionable-blocker contract |
| operations Git ownership configuration | setup/initialization and operation-recovery own Obsidian Git auto-commit/auto-push settings; maintainer keeps scripts-own-commit/sync rule |
| evidence final unheaded quality/citation-status/fidelity/recapture paragraphs | maintainer/evidence retains all normative restrictions and exact capture identity; setup/capture-prerequisites gets diagnostic tooling recipes only |
| efficacy Concept identity audit and Relationships candidate command | maintainer/efficacy retains identity/relationship rules and action selection; setup/checks owns audit diagnosis; callers retain concise required check links |
| maintenance content-hash join definition and never-move invariant | maintainer/maintenance remains single normative hash identity/backlog membership contract (including legacy fallback) |
| maintenance metrics table, health backlog reporting, known limits, cost discipline | setup/checks: metrics/coverage/limitations and bounded report practices; normative evidence limits stay linked |
| maintenance migrating source hashes, title-shaped citations, wrapped links, sources ordering, ambiguous links | maintainer/maintenance owns actual content-repair helpers and dry-run/apply scope; setup/checks owns initial detection and post-repair verification procedure |
| maintenance unsafe/doubled-extension clipping names, authored metadata backfill | maintainer/maintenance owns exact content repair and byte/hash/no-overwrite safeguards; setup links diagnostic cases without duplicating repair |
| lint steps 1–3 read-only health/drift coverage/lint tiers/near/flags and step 4 inspection | setup/checks owns reporting; embedding drift cache is disclosed and excluded from strict read-only reports |
| lint persisted dispositions and steps 5–6 factual fixes/log/close | maintainer/lint: only authorized mutation, ledger disposition file, real reviewed date, scoped completion |
| repair initial worklist and step 4 repeated report commands; relink step 1 reports | setup/checks owns report interpretation; maintainer repair/relink retain exact acceptance obligations, issue IDs and point-of-use links |
| obsidian-cli introductory guard and Syntax, Read/search, Links/graph, Typed properties, Create/edit/move, Tags/tasks/templates/bases, Escape hatches | maintainer/obsidian-cli retains guarded supported actions, explicit elevated action boundaries and live help |
| obsidian-cli Windows invocation, Empty is not an answer, final failure/timeout paragraph | setup/app-access owns checks/failure recipes; maintainer keeps uncertain-outcome and no bypass/retry obligations |
| triage Show queue and Grouping; Read dispositions; Queue something; Guardrails | maintainer/triage retains UI action, authenticated link handoff, topic provenance, append-only disposition handling and exact action table |
| triage remote token loss/rotation/port/host/network guidance | setup/app-access owns session/access troubleshooting; maintainer retains remote command and direct conditional link |
| capture named routing and selected HTML capture; recapture/supplied-page/name/result contracts | researcher/capture retains sole-writer helper, dedup/declines/topic/format and exact-set handoff; setup/capture-prerequisites gets recovery branches for clashes/gates/failed inputs |
| all six clip-* Steps 1 preflight; converter invocation and missing-service interpretation | setup/capture-prerequisites: PDF doctor, pandoc, Python interpreter probes, LibreOffice, gh doctor/auth and Confluence doctor; each specialist keeps direct required link |
| clip-pdf How it works table tools/OCR repair/fidelity refresh; figures Tools; mode diagnosis comparison | setup/capture-prerequisites owns tools/gotchas/recovery; researcher retains modes, figures rendering, hashes, flags, fidelity ceilings and verify-before-citing obligations |
| clip-docx How it works and Steps 2–4 | researcher retains helper, XML/plain extraction, allow-short only after inspection, immutable body and evidence checks; setup owns converter/corrupt-file diagnosis |
| clip-pptx How it works interpreter fallback and unsupported legacy .ppt | setup owns prerequisite probes/conversion guidance; researcher retains supported pptx-only scope, slide/table/notes output and fidelity |
| clip-xlsx How it works converter failure differences and Steps thin/no allow-short | setup owns failure troubleshooting and prerequisites; researcher retains rendered values, table pairing obligations and no PDF fallback |
| clip-gh How it works, Per-file, Digest, Steps and filename migration paragraphs | researcher retains bounded mode selection, dedup, prune/adoption reporting and authorized summary scope; setup owns doctor/failures; maintainer owns filename content migrations |
| clip-confluence Graceful degradation and Known limitation | setup owns dependency location/override/doctor, no-auth fallback and URL-dedup gotcha; researcher retains exact metadata origin, supported inputs, no invented raw and capture completion |
| ingest Select eligible and completion source metadata rules | researcher retains named/default selection, existing/restricted/missing hash/binary exclusion, zero-work no-op, exact source paths/hashes, figure inspection and independent catalog/operation completion |
| ingest embedded repair-provenance command and sync refusal explanation | maintainer owns content repair; setup/operation-recovery owns refusal detail; researcher links directly and retains scope/evidence obligations |
| purge introduction history preflight, step 1 health baseline, step 6 legacy broken-link verification | setup/operation-recovery and checks own detailed diagnosis/verification; purge retains must-check lineage and compare broken links obligations |
| purge Steps 1–5, Restoring, Rules | purge retains reconcile transaction, seed relevance, explicit plan approval, blocking/collateral handling, separate publication approval and restore no-overwrite/MISSING boundary |
| purge When a purge stops partway | setup/operation-recovery owns locked-file resume via reconcile; purge retains no replay-apply rule and direct link |
| workflows comparison bullets | concise updated six-skill routing; full authoring merged into project, report/lint checking into setup, search/query into search, filing into maintainer |

## Maintained specialist documentation and runtime surfaces

These public API descriptions may remain, but skill-facing check/troubleshooting procedures have one setup owner and are linked there. Historical docs/superpowers, CHANGELOG and prior eval evidence remain unchanged.

| Surface / sections | Disposition |
|---|---|
| docs/codex.md: Install from a local checkout; Runtime and workflows; Updating | Maintain public host install/update documentation; setup initialization/prerequisites links; update role routing and doctor reference |
| docs/wiki-integrity.md: Measurement contract; Scoped validation; Agent workflow | Keep public helper contracts; setup/checks and validation own agent checks; maintainer owns repair actions |
| docs/wiki-efficacy.md: Commands; Agent workflows; Evaluation and limits | Keep public command contract; setup/checks owns diagnostic workflow; identity policy stays maintainer; historical validation sections preserved |
| docs/cli-transport-guards.md: Supported access; Enforced boundaries; Limits and activation | Keep public transport contract; link setup/app-access for failure recovery; maintainer normative guards remain single-owned |
| docs/clipping-fidelity.md: overview; Pages that are not the page; Recapture/saved pages/decline/known-URL commands | Keep public capture APIs; setup/capture-prerequisites owns diagnostic recipes, researcher owns capture, maintainer owns evidence restrictions |
| docs/reclipping.md: layout repair and Web pages | Maintainer content-repair API reference remains; setup owns diagnosis/prerequisite interpretation with direct links |
| docs/skill-reliability.md: current overview; Runtime and completion; Behavioral suite | Update current role/check routing only; preserve explicitly historical skill audits/loading/verification |
| README.md, docs/skill-migration.md, eval/skill-catalog.md, templates | WP3 six-role routing, migration map and generated-equivalent catalog; authored templates route project, setup references for checks |
| scripts/lib/vault.mjs obsolete initialization help destination | Only intended runtime text change: wiki-init → wiki-setup; no interface/behavior change |
| Existing tests and evaluation harnesses | WP3 revise five-role/no-example expectations; preserve capability, auth, reference-integrity and actual behavior assertions |

## Companion boundary

The machine-readable before inventory scans the previous sixteen plugin identities, current available Git-tracked text (broader than the previous Markdown-only scan), and latest installed Markdown copies. Maintained source hits: hartye-skills spec-plan/q-master; agent-game-studio plugin-map; and agent-unreal scripts/sibling-skills.json. Installed copies remain untouched. agent-draw source is unavailable in the bounded source set; its prior temporary clone is not assumed current. Older historical references retain their historical disposition from the linked prior inventory, not mechanical replacements. No third-party compatibility claim is made.

## Final canonical destination resolution

The baseline section rows above remain intact as inventory evidence. Their
functional destination labels resolve to the exact files below in the six-skill
candidate. Together with the embedded split rows, this table identifies the
canonical owner of every baseline section; it does not retain old forwarding
files. Shared evidence, identity and transaction rules remain single-owned.

All destinations are relative to the repository root under `skills/` unless
shown as public documentation. `search/cited answers` means
`wiki-search/references/answers.md`; `project/authoring and backlog` also includes
`wiki-project/references/catalogs.md` for the catalog procedure. No proposed
filename remains an intended future file.

| Baseline reference | Final canonical destinations, by the section splits above |
|---|---|
| wiki-init/setup | [Initialization](../../skills/wiki-setup/references/initialization.md), [app registration](../../skills/wiki-setup/references/app-access.md) |
| maintainer/access | [Access policy](../../skills/wiki-maintainer/references/access.md); failure diagnosis in [app access](../../skills/wiki-setup/references/app-access.md) |
| maintainer/efficacy | [Identity and relationship policy](../../skills/wiki-maintainer/references/efficacy.md); [identity audit and evaluation](../../skills/wiki-setup/references/checks.md) |
| maintainer/evidence | [Evidence policy](../../skills/wiki-maintainer/references/evidence.md); diagnostic tooling only in [capture prerequisites](../../skills/wiki-setup/references/capture-prerequisites.md) |
| maintainer/health | [Health and ingest backlog](../../skills/wiki-setup/references/checks.md#health-and-ingest-backlog) |
| maintainer/lint | [Authorized fixes and dispositions](../../skills/wiki-maintainer/references/lint.md); [lint report](../../skills/wiki-setup/references/checks.md#content-lint-report), [bounded evaluation](../../skills/wiki-setup/references/checks.md#bounded-maintenance-evaluation) |
| maintainer/maintenance | [Hash join and content repair](../../skills/wiki-maintainer/references/maintenance.md); [metrics and limits](../../skills/wiki-setup/references/checks.md) |
| maintainer/obsidian-cli | [Guarded actions](../../skills/wiki-maintainer/references/obsidian-cli.md); [Windows invocation](../../skills/wiki-setup/references/app-access.md#windows-invocation), [empty canary](../../skills/wiki-setup/references/app-access.md#empty-output-one-lazy-canary), [failure](../../skills/wiki-setup/references/app-access.md#failure-refusal-and-uncertain-mutation) |
| maintainer/operations | [Mutation lifecycle](../../skills/wiki-maintainer/references/operations.md); [recovery/refusals/Git settings](../../skills/wiki-setup/references/operation-recovery.md); [authored catalog procedure](../../skills/wiki-project/references/catalogs.md) |
| maintainer/relink | [Relationship actions](../../skills/wiki-maintainer/references/relink.md); [checks](../../skills/wiki-setup/references/checks.md), [validation](../../skills/wiki-setup/references/validation.md) |
| maintainer/repair | [Content repair](../../skills/wiki-maintainer/references/repair.md); [checks](../../skills/wiki-setup/references/checks.md), [validation](../../skills/wiki-setup/references/validation.md) |
| maintainer/stale | [Freshness and drift coverage](../../skills/wiki-setup/references/checks.md#freshness-and-drift-coverage) |
| maintainer/triage | [Triage actions and disposition table](../../skills/wiki-maintainer/references/triage.md); [session recovery](../../skills/wiki-setup/references/app-access.md#triage-ui-reachability-and-session-recovery) |
| maintainer/workflows | [Six-skill routing](../../skills/wiki-maintainer/references/workflows.md) |
| purge/purge | [Approved purge/restore actions](../../skills/wiki-purge/references/purge.md); [recovery](../../skills/wiki-setup/references/operation-recovery.md#interrupted-purge), [history preflight](../../skills/wiki-setup/references/operation-recovery.md#purge-history-connectivity), [broken-link verification](../../skills/wiki-setup/references/checks.md#purge-broken-link-verification) |
| researcher/capture | [Capture actions and outcomes](../../skills/wiki-researcher/references/capture.md); [HTML and supplied-page diagnosis](../../skills/wiki-setup/references/capture-prerequisites.md#html-and-supplied-pages) |
| researcher/clip-confluence | [Confluence capture](../../skills/wiki-researcher/references/clip-confluence.md); [prerequisites and limits](../../skills/wiki-setup/references/capture-prerequisites.md#confluence) |
| researcher/clip-docx | [Word capture](../../skills/wiki-researcher/references/clip-docx.md); [prerequisites](../../skills/wiki-setup/references/capture-prerequisites.md#word) |
| researcher/clip-gh | [GitHub capture](../../skills/wiki-researcher/references/clip-gh.md); [prerequisites](../../skills/wiki-setup/references/capture-prerequisites.md#github-repositories) |
| researcher/clip-pdf | [PDF capture and figures](../../skills/wiki-researcher/references/clip-pdf.md); [prerequisites](../../skills/wiki-setup/references/capture-prerequisites.md#pdf), [mode diagnosis](../../skills/wiki-setup/references/capture-prerequisites.md#wrong-reading-mode-or-garbled-text) |
| researcher/clip-pptx | [PowerPoint capture](../../skills/wiki-researcher/references/clip-pptx.md); [prerequisites](../../skills/wiki-setup/references/capture-prerequisites.md#powerpoint) |
| researcher/clip-xlsx | [Spreadsheet capture](../../skills/wiki-researcher/references/clip-xlsx.md); [prerequisites](../../skills/wiki-setup/references/capture-prerequisites.md#spreadsheets) |
| researcher/discover | [Independent discovery](../../skills/wiki-researcher/references/discover.md); [capture prerequisites](../../skills/wiki-setup/references/capture-prerequisites.md) only when capture follows |
| researcher/ingest | [Eligibility and ingestion](../../skills/wiki-researcher/references/ingest.md); [hash identity](../../skills/wiki-maintainer/references/maintenance.md), [backlog report](../../skills/wiki-setup/references/checks.md#health-and-ingest-backlog), [validation](../../skills/wiki-setup/references/validation.md), [recovery](../../skills/wiki-setup/references/operation-recovery.md) |
| user/authoring | [Original authoring and placement](../../skills/wiki-project/references/authoring.md), [backlog](../../skills/wiki-project/references/backlog.md), [catalogs](../../skills/wiki-project/references/catalogs.md); [validation](../../skills/wiki-setup/references/validation.md) |
| user/query | [Read-only cited answers](../../skills/wiki-search/references/answers.md); authorized [derived synthesis filing](../../skills/wiki-maintainer/references/synthesis-filing.md), original content to [project](../../skills/wiki-project/SKILL.md) |
| user/search-details | [Advanced retrieval/raw/provenance](../../skills/wiki-search/references/advanced.md); [search diagnostics](../../skills/wiki-setup/references/search-diagnostics.md); [backlog listing](../../skills/wiki-project/references/backlog.md#list-by-lifecycle) |
| user/search | [Executable simple search](../../skills/wiki-search/SKILL.md#simple-search); [advanced detail](../../skills/wiki-search/references/advanced.md) |

Maintained specialist public documents now link the corresponding canonical setup
procedures. Their public command/API contracts and explicitly historical
measurements remain reference material. Current invocation paths in README,
Codex guidance, the schema template and runtime help use the six-skill owners.
`docs/skill-migration.md` retains old names only as migration inputs; historical
`docs/superpowers/`, CHANGELOG and preceding evaluation snapshots remain unchanged.
