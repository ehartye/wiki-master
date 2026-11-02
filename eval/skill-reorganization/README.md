# Six-skill separation delivery handoff

The reviewed implementation exposes exactly six skills: `wiki-search`,
`wiki-project`, `wiki-setup`, `wiki-maintainer`, `wiki-researcher` and `wiki-purge`.
The old wiki-user/wiki-init entry folders are removed without forwarding skills.
Product source remains **unreleased**; package version 0.88.0 still identifies
the released five-role baseline. No product merge, marketplace update or cache
installation was performed by this migration.

## Source revisions and coordinated delivery

| Repository | Feature branch | Reviewed implementation commit |
|---|---|---|
| wiki-master | feat/separate-search-project-setup | a4ce7e73d3973c42218120fcaf5907c8afd2476a |
| hartye-skills | feat/wiki-role-split | 884ae1d440fa786746f74d430355f2d3d9fb1b5e |
| agent-game-studio | feat/wiki-role-split | 34aa167951508e46113fe8e8c5cfc956de377420 |
| agent-unreal | feat/wiki-role-split | 9e7202d65a749f6ff531702ef773b4714a82c44c |

Worktrees use sibling `<repo-name>-worktrees` directories. The three companion
changes migrate spec-plan/q-master, studio's plugin map and Unreal's sibling
catalog. Rebase onto current default branches and rerun affected checks before
eventual squash integration. Studio main advanced concurrently to 0.4.0
(`d1481c8f93f27c29767cbf345cd9aae748ae701c`); the reviewed feature still rests on
0.3.2 (`12fcd55`), so its passing checks do not certify that future rebase.
Version/release decisions, marketplace publication and installation remain
separate delivery actions.

## Ownership and migration

Search owns read-only lookup and cited answers; project owns original authored
documents and backlog/catalog updates; setup owns initialization, checks,
diagnostics and recovery. Maintainer keeps content actions and authorized
derived-synthesis filing. Researcher keeps independent discovery, capture and
ingestion. Purge keeps approval, transaction and restore boundaries.

Shared normative evidence, identity and ordinary transaction policy remain
maintainer-owned. Required checks are linked directly at their point of use.
Runtime behavior/interfaces are unchanged except the obsolete setup destination
in an app-registration error. A source comment also points to the moved
authoring reference. No search engine, flags, schema or authorization model was
added.

[The migration guide](../../docs/skill-migration.md) and
[section inventory](migration-inventory.md) record all 28 old references and
their canonical destinations. [Caller evidence](wp3-companions.md) covers 15
available repositories from the prior 16-companion set; agent-draw source was
unavailable. Historical references and installed copies are retained. No
unknown third-party compatibility claim is made.

## Reviews and verification

- [WP1](wp1-review.md): section/caller inventory and real before-authoring baselines.
- [WP2](wp2-review.md): new entry points, shared contracts and focused execution.
- [WP3](wp3-review.md): remaining workflows, catalog, maintained documentation and callers.
- [WP4](wp4-review.md): every mandatory behavioral gate, independent grades and final regression results.
- WP5: prepared wiki documentation passed its distinct independent review and was
  published through the scoped helpers; see [publication receipt](wp5-publication.json).

Final `npm.cmd test`: **2309 passed, 0 failed, 1 skipped** out of 2310.
The sole skip is the unconfigured owner-specific private-term dictionary.
Built-in privacy scans have zero hits; the absent dictionary was not checked.
Earlier required suites pass: 46 skill tests, 64 authoring/structural/triage
tests, 123 studio tests and 17 Unreal tests; Hartye metadata/link/diff checks
also pass. [Command receipts](wp4-command-receipts.json) retain exact counts.

Actual actor transcripts, source snapshots, file hashes, operations, citations
and local bare-remote publication support the acceptance matrix. Independent
[WP4 grades](independent-wp4-grades.json) reuse the existing evaluator. Routing
probes measure selection/reference resolution, not execution of every workflow.
No aggregate efficacy or startup-token reduction is claimed: several baselines
already succeeded.

## Retained failures and limits

Initial actors omitted scaffold ledger entries, explicit instruction reads or
scoped ingestion validation. They remain failures; reviewed source corrections
and fresh reruns supply acceptance. One initial named-ingestion run crossed a
source edit and is excluded from final source-bound acceptance. The
[research report](research/results.md) and WP4 review identify the clean reruns.

The first full suite skipped PDF table mode. Authorized toolchain setup then
exposed a suite-precedence incompatibility: full Xpdf precedence passed table
extraction but failed six figure tests. Text-only Xpdf precedence with Poppler
render/probe tools passes all **72 PDF tests**, with zero skips, and the final
full suite executes the formerly skipped table case. Failed and corrected
receipts remain. This is environment verification, not a runtime doctor fix.

Controlled HTTP research verifies independent workers, selection ordering and
real capture/ingest/retrieval, not public-web discovery quality. Unavailable
native-action fallback is tested, not successful app control. LibreOffice and
Confluencer were absent; live authenticated-service and universal converter
integration are not claimed. Some successful actors did not load every
conditional reference and recovered from harmless command mistakes; flawless
procedural compliance is not asserted.

## Wiki publication boundary

Prepared updates distinguish released 0.88.0 from built feature source, keep the
implementation backlog in progress pending release, and record initialization
template preservation and PDF doctor capability friction. Existing PDF-doctor
work is updated rather than duplicated. Machine-specific setup detail stays in
the private wiki, not this repository.

Only owned wiki paths may be validated, logged, committed and synchronized.
Foreign global-index changes remain untouched; project-only roadmap/MOC
generators are used and global refresh is deferred. The [WP5 publication receipt](wp5-publication.json) identifies the operation,
exact publication scope, fresh remote verification and preserved global index;
[Independent post-publication review](wp5-review.md) passed. Of 74 original
foreign files, 69 remained byte-identical; five changed concurrently and two new
outside-scope paths appeared. All seven were excluded from the published scope;
unseen writes are not attributed here. Wiki publication does not release the product.
