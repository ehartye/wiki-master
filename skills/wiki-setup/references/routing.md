# Register vaults and project routes

Use this procedure for authorized configuration work. Context discovery alone
changes nothing. Read [the configuration contracts](../../../docs/multi-vault.md)
and [access](../../wiki-maintainer/references/access.md) first. There is no registry
writer command: prepare and inspect exact files with ordinary filesystem edits.

## Preserve and describe

1. Inspect existing registry, repository `.wiki-master.json`, applicable `AGENTS.md`,
   root `VAULT.md` and `vault-schema.md` before editing. Record prior default and
   current task values of `WIKI_MASTER_VAULT`, `WIKI_MASTER_VAULT_NAME`,
   `WIKI_MASTER_VAULT_ID`, `WIKI_MASTER_CONFIG` and `WIKI_MASTER_PROJECT_ROOT`.
   Detect legacy root/name settings before adopting a registry. Preserve that
   intended default unless the owner instructs otherwise.
2. Register existing vaults without migration or scaffolding over their content.
   For an authorized empty root, run `init.mjs --bootstrap "<absolute-root>"` and
   follow [initialization](initialization.md) for its prerequisites and completion.
   Bootstrap is only an initialization escape hatch; ordinary capture has no
   bootstrap bypass. Registration alone does not imply a native app registration.
3. Use [the descriptor template](../../../templates/setup/VAULT.md) only when the
   root has no `VAULT.md`; set its own ID, purpose, includes and excludes. Preserve
   existing customized descriptors and all unrelated bytes on repeat setup. An
   incompatible existing descriptor needs an explicit scoped correction, not a
   wholesale replacement. Choose distinct native names/IDs and verify returned
   canonical paths with the guarded `obsidian.mjs vault info=path` after binding
   each target. App access may activate/open it and fail on its first closed-target
   probe; report that failure without automatic retry or fallback.
4. Create or merge the machine-local registry at `~/.config/wiki-master/vaults.json`
   (or an explicit absolute `WIKI_MASTER_CONFIG`) using the documented version-1
   fields. Preserve unrelated entries. Verify IDs, nonnested canonical roots,
   distinct native selectors and descriptor matches. Never put machine paths in
   a repository or another vault's descriptor.

## Project file and worktrees

Use [the project template](../../../templates/setup/.wiki-master.json) at the Git
repository root, after replacing example identity and IDs. Inspect the chosen
documentation vault for its existing overview `repo:` mapping first; a conflict
must be corrected rather than silently creating a duplicate project. Omitted
documentation and research settings each inherit the global default independently.

Follow an existing owner preference. Otherwise explain the two storage choices:

- **Tracked file:** share portable logical routes with collaborators.
  **Time:** less repeated setup than ignored (rank 1 of 2); each machine still needs a registry.
  **Risk:** greater chance of a missing collaborator ID (rank 2 of 2); strict refusal prevents wrong writes.
  **Complexity:** fewer per-checkout differences (rank 1 of 2).
  **Best practice:** preferred for shared project policy (rank 1 of 2).
  **Maintainability:** one reviewed routing file (rank 1 of 2).
- **Gitignored file:** keep routing local; add `/.wiki-master.json` to the repository's
  ignore rules, preserving other rules, then verify it is ignored using the project repository tooling.
  **Time:** additional local setup (rank 2 of 2).
  **Risk:** fewer shared-ID conflicts (rank 1 of 2), but local drift remains possible.
  **Complexity:** local inheritance needs attention (rank 2 of 2).
  **Best practice:** appropriate for intentionally local policy (rank 2 of 2 for shared policy).
  **Maintainability:** each machine maintains its choice (rank 2 of 2).

Repository tracking checks concern the **project repository**, never the wiki vault.
A tracked file follows the project's normal delivery workflow. Do not auto-stage it
as part of wiki setup. Current-worktree configuration wins. If absent, inheritance
requires an ignored primary-checkout file and the same canonical Git common
directory; never copy a tracked primary file that is absent/deleted in a worktree.
Run context in both checkouts and inspect `projectConfigPath` and
`inheritedProjectConfig`. Invalid current configuration must fail without fallback.
Unsupported layouts report global routing with a diagnostic instead of guessing.

## Legacy environment transition

Legacy root/name variables become strict assertions after registration. They
can therefore agree with the global default yet conflict with a project override.
Do not silently change the intended default to make a check pass. Do not disable
conflict validation. Explain the detected settings and reconcile **only the task's
invocation environment**: temporarily unset the old root/name and any stale request
ID, retain the intended registry, and explicitly bind the repository for project work.

In PowerShell save all five prior values listed above, use `try/finally` to restore
them, and within the block use `$env:WIKI_MASTER_VAULT = $null`,
`$env:WIKI_MASTER_VAULT_NAME = $null` and `$env:WIKI_MASTER_VAULT_ID = $null`.
Set `WIKI_MASTER_CONFIG` to the registry. In POSIX use a subshell with `unset` and
`export`; its environment disappears on exit. Do not edit OS settings or shell profiles.

Within that same reconciled environment, verify both:

1. The default: clear `WIKI_MASTER_PROJECT_ROOT`, run from a known nonrepository
   directory and invoke `context.mjs --purpose documentation --json`.
2. The override: invoke `context.mjs --purpose documentation --repo "<repository>" --json`;
   also inspect `context.mjs --purpose research --repo "<repository>" --json`.

Compare the actual IDs, roots, configuration origin and selection requirement to
the intended routes. A deliberately retained conflicting legacy value must still
fail. Repeating setup preserves customized files, registry entries and project
choices. Record checked results and any unresolved app verification separately.

A child process cannot change its parent's environment. If startup settings remain,
future invocations can reintroduce the conflict. State this limitation and show the
task-scoped reconciliation to repeat; let the owner manage persistent settings.
Never claim a successful reconciled child invocation fixed future shells.
