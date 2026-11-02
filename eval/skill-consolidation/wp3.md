# WP3: contracts, current documentation and callers

Baseline: `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca`.
Reviewed candidate skills: `8a899af34c1eef7e367400d3a30b3d39fe8d45b1`.
The commands below ran against that skill revision with the WP3 source changes
in the working tree. The coordinator records the resulting candidate revision at
the package gate. No merge, release, marketplace update or global installation
is part of this package.

## Contracts

`test/skill-contracts.test.mjs` now checks the exact five-role inventory, metadata
name/description constraints, direct workflow and six-format helper reachability,
and exact equality between the catalog and current frontmatter. It follows local
Markdown links recursively through procedures and specialist documentation,
checking file existence and Markdown heading anchors. Every skill reference must
be reachable. A synthetic second-hop missing file and missing self-anchor verify
that the recursive guard detects those failures while ignoring code examples.

The checks retain shared access/completion routing, read-only search startup,
health/freshness operation exclusions, authoring completion and portable shell
examples. They are structural checks, not evidence that an agent chooses or
executes the right workflow. The Markdown checker covers inline links used by
the maintained skill graph; it is not a general Markdown parser or site auditor.

The drift guard retains helper-path, schema, manifest/version, frontmatter and
NUL-byte checks while dropping the obsolete one-command/one-skill assumption.
Triage still compares the actual exported disposition IDs and labels with the
migrated table, including its deliberate negative controls. Authored-page tests
now read the moved user policy, retaining vocabulary, canonical placement,
dependency, provenance and read-only validation checks.

## Documentation and caller inventory

The coordinator updated README, current Codex and integrity documentation, the
schema template, skill reliability guidance and [the migration map](../../docs/skill-migration.md).
The catalog now contains exactly the five candidate frontmatter descriptions.
Current docs distinguish role modes from helper CLI flags and describe the
search/capture/ingestion authorization boundaries. Historical evaluation figures,
transcripts, dated specifications/plans and release records are explicitly labeled
as historical and retain the names they actually used.

[Main-repository inventory](main-caller-inventory.json) enumerates baseline
maintained documentation/skill/script references and their dispositions. Current
user-facing source text changed in `scripts/init.mjs`, five clipper help entries
in `scripts/lib/clip-args.mjs`, and the waiting screen in
`scripts/triage-ui/server.cjs`. Source comments now point to the current modes or
moved procedure files. These are prose/comment edits only: helper names, options,
data formats, algorithms and execution behavior are unchanged.

The test path migrations are:

| Consumer | Old path or assumption | Replacement/disposition |
|---|---|---|
| `test/triage-skill-table.test.mjs` | `skills/wiki-triage/SKILL.md` via path segments | `skills/wiki-maintainer/references/triage.md`; same disposition assertions |
| `test/validate-authored.test.mjs` (three reads) | `skills/wiki-maintainer/references/authoring.md` | `skills/wiki-user/references/authoring.md`; same vocabulary/placement/provenance assertions |
| `test/skill-contracts.test.mjs` | 21 entry points and format-specific entry folders | Five roles plus explicit mode/format reachability, recursive references and catalog equality |
| `test/drift-guard.test.mjs` | Every former command must retain its own skill name | Retired command directory remains absent; capability checks are owned by the contract suite |

Earlier bug-history comments in tests and temporary fixture prefixes are not
current invocation instructions and remain unchanged. Maintained companion
source migrations and their bounded installed/source scans are recorded in
[caller migration](caller-migration.json), [before inventory](caller-inventory-before.json)
and [after inventory](caller-inventory-after.json). Root coordinates those
separate feature worktrees; this note does not claim external third-party callers
were exhaustively enumerated.

## Exact regression commands and results

[Command manifest](commands.json) retains the specification's exact four commands.
[Execution results](wp3-command-results.json) records actual command strings,
host fallback, timestamps, elapsed milliseconds, exits and artifact paths.

| Gate | Result | Output |
|---|---|---|
| `npm run test:skills` | 45 pass, 0 fail, 0 skipped; exit 0 | [Skill suite](wp3-skills.log) |
| Contract/triage/authored command from manifest | 64 pass, 0 fail, 0 skipped; exit 0 | [Contracts](wp3-contracts.log) |
| Focused search/capture/provenance command from manifest | 179 pass, 0 fail, 0 skipped; exit 0 | [Search/capture/provenance](wp3-search-capture-provenance.log) |
| Six format/service suites from manifest | 106 pass, 0 fail, 0 skipped; exit 0 | [Formats](wp3-formats.log) |

The six-format command tests parsing, content generation, metadata, dedup helpers
and fixture-based integration discovery. It does **not** invoke real PDF/OCR,
pandoc, LibreOffice or PowerPoint conversion, clone an authenticated repository,
or fetch authenticated Confluence content. Its zero skipped tests do not prove
those optional prerequisites are installed or live integrations work. WP4 records
actual prerequisite and integration coverage separately.

The initial `npm run test:skills` attempt failed **before tests executed** because
nested Windows PowerShell selected the restricted `npm.ps1` wrapper. Its exact
failure is retained in [the host preflight log](wp3-skills-host-preflight-failure.log).
The same command succeeded through `cmd.exe /d /s /c`, which normally resolves
`npm.cmd`; no execution policy was changed. Installation and home-directory paths
were replaced with neutral placeholders in public logs.

During parallel documentation preparation, an earlier development command
`node --test test/skill-contracts.test.mjs test/drift-guard.test.mjs test/triage-skill-table.test.mjs test/validate-authored.test.mjs`
returned exit 1 with 70 passing tests and one failing recursive-reference check:
`README.md -> missing/outside docs/skill-migration.md`. The README link existed
while that planned file was still being authored. After the file was complete,
the seven contract tests passed, and the full exact gates above passed. The fresh
independent reviewer also ran that combined command successfully (71 tests).
This transient incomplete-tree result is distinct from a candidate regression.

`git diff --check` passed. Candidate-loaded activation and execution remain WP4;
passing helper and contract suites alone does not establish delivery readiness.
Independent review is recorded separately by the coordinator's fresh reviewer.
