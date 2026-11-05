import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
};

export const OBSIDIAN_GIT_ID = 'obsidian-git';

// What the vault's sync depends on. One timer does everything: it commits every 10 minutes, then pulls with a rebase
// and pushes. The separate push and pull timers stay at 0 so that nothing runs outside it.
export const REQUIRED_SETTINGS = Object.freeze({
  autoSaveInterval: 10,
  syncMethod: 'rebase',
  mergeStrategy: 'theirs',
  autoPullOnBoot: true,
  autoPushInterval: 0,
  autoPullInterval: 0,
});

export const obsidianGitDataFile = (vaultPath) => join(vaultPath, '.obsidian', 'plugins', OBSIDIAN_GIT_ID, 'data.json');

// Each required setting against this vault's settings file: { met, missing, differing }, in the order of REQUIRED_SETTINGS.
export function compareSettings(vaultPath) {
  const data = readJson(obsidianGitDataFile(vaultPath));
  const found = data !== null && typeof data === 'object' ? data : {};
  const result = { met: [], missing: [], differing: [] };
  for (const [key, required] of Object.entries(REQUIRED_SETTINGS)) {
    if (!Object.hasOwn(found, key)) result.missing.push({ key, required });
    else if (found[key] === required) result.met.push({ key, required });
    else result.differing.push({ key, required, actual: found[key] });
  }
  return result;
}

// Whether this vault meets the Obsidian Git prerequisite, read from the plugin's files alone, so it needs no running
// app. `settings` is 'read', 'absent' or 'unreadable'. A missing or non-numeric autoSaveInterval is reported as null:
// the plugin's own default is 0, which leaves its timer off.
export function obsidianGitPrerequisite(vaultPath) {
  const obsidianDir = join(vaultPath, '.obsidian');
  const installed = readJson(join(obsidianDir, 'plugins', OBSIDIAN_GIT_ID, 'manifest.json'))?.id === OBSIDIAN_GIT_ID;
  const listed = readJson(join(obsidianDir, 'community-plugins.json'));
  const enabled = Array.isArray(listed) && listed.includes(OBSIDIAN_GIT_ID);
  const dataFile = obsidianGitDataFile(vaultPath);
  const data = readJson(dataFile);
  const settings = data !== undefined ? 'read' : existsSync(dataFile) ? 'unreadable' : 'absent';
  const autoSaveInterval = typeof data?.autoSaveInterval === 'number' ? data.autoSaveInterval : null;
  return { met: installed && enabled && autoSaveInterval > 0, installed, enabled, settings, autoSaveInterval };
}
