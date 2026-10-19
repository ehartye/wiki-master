import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Obsidian Git plugin stays installed for its source-control UI and for
// pulling, but the plugin scripts own commits and pushes (scripts/wiki-sync.mjs).
// These three settings are the ones that make the plugin commit or push by itself,
// which races an operation's scoped commit: it can commit a half-finished edit
// under "vault backup" and leave op-commit an empty delta (measured here: the
// 0.9.0 design spec saw one such auto-commit sweep a settings change in with
// eight in-progress files). Auto-pull is deliberately not listed.
const COMMITTING_SETTINGS = ['autoSaveInterval', 'autoBackupAfterFileChange', 'autoPushInterval'];

// null: the plugin is not installed in this vault. { enabled: [...] }: the
// committing settings that are on (empty is the supported configuration).
// { unreadable: true }: the plugin is there but its config could not be parsed;
// that is unknown, and must not be reported as off.
export function obsidianGitAutoCommit(vaultPath) {
  const file = join(vaultPath, '.obsidian', 'plugins', 'obsidian-git', 'data.json');
  if (!existsSync(file)) return null;
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { enabled: [], unreadable: true };
  }
  const on = (value) => (typeof value === 'number' ? value > 0 : value === true);
  return { enabled: COMMITTING_SETTINGS.filter((key) => on(settings?.[key])) };
}
