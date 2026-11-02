---
name: wiki-init
description: Use when asked to initialize or scaffold a new wiki-master vault. Existing-vault health reporting belongs to wiki-maintainer; this is not a migration or repair workflow.
---

# Initialize a vault

Read [setup](references/setup.md), [access](../wiki-maintainer/references/access.md)
and [operation completion](../wiki-maintainer/references/operations.md).
Verify the intended new vault root before scaffolding and open the operation
before its first write. Preserve existing content; initialization does not
authorize migration, repair or creation of a Git remote.

Validate the generated layout, schema and templates. Complete scoped publication
when configured and authorized; otherwise report local-only initialization.
Report app registration separately from filesystem completion: a health report
does not establish that Obsidian can reach the vault.
