import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// What sync has already told this machine about other writers' operations. "N operations still open" and "an abandoned token" describe
// ambient state, not what the sync did, and in a vault with several writers one of them is nearly always true, so every sync repeated
// them. Each note is said once for a given set of tokens, again when the set changes, and again once a day while it stays true.
// The memory is a local file under `.wiki-master/` (never committed or shared); if it cannot be read or written, the note is said.
export const REPEAT_HOURS = 24;

const memoryFile = (vaultPath) => join(vaultPath, '.wiki-master', 'sync-notes.json');

function readMemory(vaultPath) {
  try {
    const value = JSON.parse(readFileSync(memoryFile(vaultPath), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// `sets` maps a note name to the tokens it would list. Returns which notes to say now, and records them as said. A note whose
// set is empty is cleared, so the next time it is true it is said again.
export function notesDue(vaultPath, sets, { now = Date.now(), repeatHours = REPEAT_HOURS } = {}) {
  const memory = readMemory(vaultPath);
  const due = {};
  let changed = false;
  for (const [kind, tokens] of Object.entries(sets)) {
    const key = [...tokens].sort().join(',');
    if (!key) {
      if (memory[kind]) { delete memory[kind]; changed = true; }
      due[kind] = false;
      continue;
    }
    const seen = memory[kind];
    const age = seen ? now - Date.parse(seen.at) : Infinity;
    due[kind] = !seen || seen.tokens !== key || !(age < repeatHours * 3600 * 1000);
    if (due[kind]) { memory[kind] = { tokens: key, at: new Date(now).toISOString() }; changed = true; }
  }
  if (changed) {
    try {
      mkdirSync(dirname(memoryFile(vaultPath)), { recursive: true });
      writeFileSync(memoryFile(vaultPath), JSON.stringify(memory));
    } catch { /* a note that cannot be remembered is said every time, which is the old behaviour */ }
  }
  return due;
}
