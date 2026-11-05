import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
};

// Whether this vault meets the Obsidian Git prerequisite, read from the plugin's files alone, so it needs no running
// app. `settings` is 'read', 'absent' or 'unreadable'. A missing or non-numeric autoSaveInterval is reported as null:
// the plugin's own default is 0, which leaves its timer off.
export function obsidianGitPrerequisite(vaultPath) {
  const obsidianDir = join(vaultPath, '.obsidian');
  const pluginDir = join(obsidianDir, 'plugins', 'obsidian-git');
  const installed = readJson(join(pluginDir, 'manifest.json'))?.id === 'obsidian-git';
  const listed = readJson(join(obsidianDir, 'community-plugins.json'));
  const enabled = Array.isArray(listed) && listed.includes('obsidian-git');
  const dataFile = join(pluginDir, 'data.json');
  const data = readJson(dataFile);
  const settings = data !== undefined ? 'read' : existsSync(dataFile) ? 'unreadable' : 'absent';
  const autoSaveInterval = typeof data?.autoSaveInterval === 'number' ? data.autoSaveInterval : null;
  return { met: installed && enabled && autoSaveInterval > 0, installed, enabled, settings, autoSaveInterval };
}
