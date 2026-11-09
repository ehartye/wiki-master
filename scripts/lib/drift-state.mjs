import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// What drift.mjs has evaluated on this machine, so `--limit` can pick pages it has not seen or that changed
// instead of the same first pages every run. Machine-local, under .wiki-master/ (gitignored), and safe to delete:
// a missing file only means every page counts as never evaluated.
//
//   { "format": 1, "root": "<canonical vault path>", "pages": { "<path>": { "evaluatedAt": "<ISO time>", "pageHash": "<sha256 of the page file text>" } } }
//
// A file with another format, another root, or that cannot be read or parsed is ignored as a whole.

export const DRIFT_STATE_FORMAT = 1;
export const DRIFT_STATE_FILE = 'drift-state.json';

export function canonicalRoot(vaultPath) {
  try { return realpathSync.native(vaultPath); } catch { return vaultPath; }
}

export function readDriftState(dir, vaultPath) {
  let data;
  try { data = JSON.parse(readFileSync(join(dir, DRIFT_STATE_FILE), 'utf8')); } catch { return {}; }
  if (data?.format !== DRIFT_STATE_FORMAT || data.root !== canonicalRoot(vaultPath)) return {};
  if (!data.pages || typeof data.pages !== 'object' || Array.isArray(data.pages)) return {};
  return data.pages;
}

// Writes the whole state through a temporary file in the same directory and a rename, so a reader never sees a
// half-written file and an interrupted write leaves the previous one.
export function writeDriftState(dir, vaultPath, pages) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, DRIFT_STATE_FILE);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ format: DRIFT_STATE_FORMAT, root: canonicalRoot(vaultPath), pages }, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
