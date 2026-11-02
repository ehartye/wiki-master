# WP3 companion migration

Four maintained caller files are migrated in isolated feature worktrees. No
release, merge, installation or installed-cache edit was performed.

| Source | Base revision | Owned change |
|---|---|---|
| hartye-skills | `89d272d4baa012d05ab45442c37f541d9d9d0f07` | spec-plan searches through wiki-search and saves through wiki-project; q-master records its note through wiki-project |
| agent-game-studio | `12fcd55073a36d3d882277d39e74a0a2a22cb4e6` | plugin-map separates retrieval, original writing, required authoring checks, validation-only/reporting and initialization |
| agent-unreal | `ebf5bccec6480e4c12000278b3622e40d9e60708` | sibling-skills.json wiki-master block contains exactly the six candidate names |

Each worktree is the sibling `<repository>-worktrees/wiki-role-split` on
`feat/wiki-role-split`. Hartye's main source was rechecked and still equals its
feature base; its installed cache had advanced independently to 0.9.3. The cache
is not the source used by these changes or candidate dependency checks.

The Unreal block was generated using its documented
`skill-citations.mjs --write-snapshot <isolated-candidate-folder> --plugins wiki-master --merge`
command. The temporary folder held only candidate wiki-master skill entries.
The other fourteen plugin blocks are byte-equivalent as parsed JSON.

## Checks

- Studio: `node scripts/check.mjs`, **123/123 pass**, no skips.
- Unreal: `node --test scripts/release-consistency.test.mjs`, **17/17 pass**, no skips.
- Both changed Hartye skill files retain identical frontmatter and have no missing
  relative Markdown file targets. All three companion `git diff --check` calls pass.
- [After inventory](caller-inventory-after.json): all Git-tracked text in fifteen
  available sources, using candidate worktrees for the three changed repositories,
  has zero unresolved maintained old-name/path callers. The dated studio design
  specification remains historical. Agent-draw source remains unavailable; its
  prior installed observation is not a source-compatibility claim. Unknown third
  parties remain outside scope.
- Independent review found the initial after-scan omitted h-superpowers because
  its source checkout uses the alias `Hartye-superpowers`. The corrected runner
  maps that alias, and the [actual rescan](companion-alias-rescan.json) found no
  maintained old-name/path callers. The after inventory now explicitly counts
  fifteen successfully scanned sources and one unavailable source (agent-draw).
  The earlier incomplete inventory is retained as
  `caller-inventory-after-before-alias-correction.json`; its implied coverage was
  overstated and is superseded by the corrected receipt.
- [Machine-readable checks](companion-checks.json) retain exact changed-file hashes
  and references to full check output. The initial studio check failed because an
  edit split the existing required situation row. The row's established title was
  restored, with separate writer/validation destinations in its handoff text, and
  the check passed. The original output remains in
  `companion-studio-check-initial.txt`; no test assertion was weakened.

## Dependency execution

The fresh pre-edit actor used the isolated six-role candidate catalog and the four
unchanged callers. Its actual tool errors include:

```text
<tool_use_error>Unknown skill: wiki-master:wiki-user</tool_use_error>
<tool_use_error>Unknown skill: wiki-master:wiki-init</tool_use_error>
```

The complete request, caller snapshots, transcript and activation observations are
in `companions-baseline/`. Its numerical prose about the JSON catalog is internally
inconsistent; the actual set has three matching names, eighteen stale names and
three missing names. It attempted Bash and Glob despite the read/activation-only
brief; those attempts were denied. No shell or vault procedure executed. Retain
those limitations rather than treating the actor's final summary as a grade.

After the workflow author confirmed stable main files, the fresh post-edit actor
resolved the four directly referenced roles: wiki-search, wiki-researcher,
wiki-project and wiki-setup. A final actor in `companions-candidate-final/` repeated
the check after the studio dependency paragraph explicitly distinguished six-role
catalog compatibility from older helper version minimums. Its actual Skill calls
all resolved, and the session catalog and Unreal JSON block both contain exactly
the six target names. No installed-cache catalog supplied resolution.

The final actor attempted one denied Glob, then used allowed direct reads. It
executed no shell or wiki workflow. Its closing paraphrase overgeneralizes setup's
read-only report rule to initialization; the loaded setup instructions explicitly
allow authorized initialization. Preserve this reporting limit, and grade actual
activation separately from prose. The earlier candidate actor and all baseline
attempts remain retained. Public transcripts are sanitized, including denied
MSYS-style shell paths; no command or behavior is removed by redaction.

`companion-harness.mjs` accepts the candidate plugin, three companion roots,
Claude executable and phase. It retains exact caller snapshots, uses only the
candidate plugin catalog and refuses to overwrite a retained phase. Independent
review must inspect actual resolution events and semantic destinations. This is
dependency activation evidence, not end-to-end spec-plan, q-master or studio
workflow execution.

## Coordinated delivery

The four caller changes depend on the new wiki-master catalog and should be
delivered together with it. Keep the old installed caches untouched until the
separate release/install action. Rebase each feature branch before eventual squash
integration. No product version is advanced by this preparation.
