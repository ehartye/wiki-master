# WP1: user workflows and shared policy

Baseline source: `05ea7e104dfb1e1530bb709fafc3e2bd7c8190ca` (0.87.0).
Candidate: uncommitted WP1 delta on the implementation feature branch; the final
candidate revision is recorded by the package coordinator. This is structural
and source-inspection evidence, not candidate-loaded behavioral verification.

## Changes and preservation map

| Baseline artifact or rule | Candidate owner |
|---|---|
| Search entry and normal retrieval steps | `skills/wiki-user/SKILL.md`, `references/search.md` |
| Ranking gate, channel states, raw lookup, evidence-route output and backlog listing | `skills/wiki-user/references/search-details.md` |
| Cited answer and authorized filing procedure | `skills/wiki-user/references/query.md` |
| Authoring steps and canonical placement/validation policy | `skills/wiki-user/references/authoring.md` |
| Root resolution, guarded app access, filesystem fallback, layout and read scope | `skills/wiki-maintainer/references/access.md` |
| Raw immutability, provenance, schema, platform separation, restrictions and editorial licenses | `skills/wiki-maintainer/references/evidence.md` |
| Identity, relationships and factual review | `skills/wiki-maintainer/references/efficacy.md` |
| Token ownership, catalogs, validation, scoped commit, sync and recovery | `skills/wiki-maintainer/references/operations.md` |
| Hash-join backlog, maintenance limits and repair guidance | `skills/wiki-maintainer/references/maintenance.md` |
| Cross-role workflow overview | `skills/wiki-maintainer/references/workflows.md` |

The three retired user entry files were removed without aliases. The canonical
authoring policy was moved rather than retained under maintainer. Existing helper
names, flags, schemas and runtime files are unchanged. Search reports exact paths
and matched lines, selects aliases and ambiguous names by context, explicitly
includes raw evidence, excludes recycle content and discloses missing channels.
Read-only work still opens no operation and performs no log, commit or refresh.
Query filing still requires authorization. Existing publication and purge
authorization rules remain in the shared operations policy.

Private-sized raw-corpus observations and historical project incident statistics
in the moved search/authoring text were replaced with generic guidance. The new
operations paragraph makes explicit that a foreign dirty catalog is not adoptable;
safe project refreshes and a reported global deferral preserve the existing
ownership contract.

## Static load observations

Measured before moving files with Node `fs.readFileSync`, buffer length and
`text.split('\n').length`. These are physical bytes and line counts, **not tokens,
actual actor loads, or measured context savings**. Baseline worktree files used
CRLF while new files use LF, so byte differences also include line endings.

| File | Bytes | Split line count |
|---|---:|---:|
| Baseline `skills/wiki-search/SKILL.md` | 9413 | 146 |
| Baseline `skills/wiki-maintainer/SKILL.md` | 5889 | 92 |
| Baseline `skills/wiki-maintainer/references/access.md` | 4934 | 75 |
| Baseline `skills/wiki-query/SKILL.md` | 3783 | 53 |
| Baseline `skills/wiki-author/SKILL.md` | 5463 | 67 |
| Baseline `skills/wiki-maintainer/references/authoring.md` | 17438 | 201 |
| Candidate `skills/wiki-user/SKILL.md` | 2087 | 35 |
| Candidate `skills/wiki-user/references/search.md` | 3145 | 50 |

The baseline search instructed loading search + maintainer core + access. The
candidate ordinary search instructs loading user + short search, plus applicable
vault instructions. Access shell examples, extended search mechanics, evidence
and mutation references each have conditional loading instructions. No behavior
or actual loaded-reference result is inferred from these static observations.

## Checks and results

- `python <skill-creator>/scripts/quick_validate.py skills/wiki-user`: exit 0,
  `Skill is valid!`. An initial run rejected `argument-hint`, an existing baseline
  convention unsupported by this validator. The new role does not need that
  optional field, so it was removed; no invocation policy was changed.
- `git diff --check`: exit 0.
- `rg -n 'wiki-search|wiki-query|wiki-author|wiki-discover|wiki-ingest|shared core|authoring\.md' skills/wiki-user skills/wiki-maintainer/references`:
  exit 0; only valid `authoring.md` references remain, no retired invocation or
  universal shared-core preamble in owned files.
- Ad hoc Node local-link inspection over the user entry, all four user references
  and six owned maintainer references: 11 files, 47 relative file links,
  zero unexpected missing targets. The user description has 345 characters
  (limit 1,024); the entry contains no fenced shell blocks. Exit 0.

The link inspection enumerated Markdown `[label](target)` links, removed hash
fragments, resolved targets relative to their containing files and checked
`fs.existsSync`. It skipped external URLs and same-file anchors; it did not claim
an anchor-integrity check or recursive whole-package coverage. WP3 supplies the
binding final recursive contract check.

Seven new destinations belong to WP2 and are intentionally pending its sequential
implementation. This is not a claim that all final candidate links resolve:

- `skills/wiki-researcher/SKILL.md`
- `skills/wiki-researcher/references/ingest.md`
- `skills/wiki-maintainer/references/obsidian-cli.md`
- `skills/wiki-maintainer/references/repair.md`
- `skills/wiki-maintainer/references/lint.md`
- `skills/wiki-maintainer/references/health.md`
- `skills/wiki-maintainer/references/relink.md`

WP2 must remove the old maintainer-core preamble and its now-retired authoring
link when it implements the maintenance router. The preserved core invariants
are now directly available in the shared policies listed above. Other incoming
old paths in non-owned skills/tests/documentation remain WP2/WP3 work. Runtime
regression tests and candidate-loaded execution are separate gates; this package
does not claim them from static checks.

Independent review: [PASS for progression to WP2](wp1-review.md), by the
coordinator's fresh reviewer. Behavioral gates remain separate.
