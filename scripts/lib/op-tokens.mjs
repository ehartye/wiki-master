import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// An operation token (scripts/op-begin.mjs) is a file under .wiki-master/ops/. Its
// own op-commit deletes it, so a token that is still there is either a running
// operation or an abandoned one (a crashed session, or a close that failed and kept
// its token on purpose). Nothing else ever removes it: the live vault had twelve,
// the oldest from 2026-09-06.
//
// Age is the only signal that separates the two. Operations take minutes to hours;
// 24 hours is long enough that a session paused overnight is not mistaken for dead
// and short enough that a leaked token stops blocking `wiki-sync --commit-local`
// by the next day.
export const STALE_OPERATION_HOURS = 24;

const TOKEN_FILE = /^([0-9a-f]{8,64})\.json$/;

// Start time from the token itself; the file's modification time when the token is
// unreadable or lacks one, so a corrupt token still ages out instead of blocking
// forever, and a freshly written one is never called old.
function startedMs(file) {
  try {
    const startedAt = Date.parse(JSON.parse(readFileSync(file, 'utf8')).startedAt);
    if (Number.isFinite(startedAt)) return startedAt;
  } catch { /* fall through to the file time */ }
  return statSync(file).mtimeMs;
}

function opOf(file) {
  try {
    const op = JSON.parse(readFileSync(file, 'utf8')).op;
    return typeof op === 'string' ? op : null;
  } catch {
    return null;
  }
}

export function listOperations(vaultPath, { staleHours = STALE_OPERATION_HOURS, now = Date.now() } = {}) {
  const dir = join(vaultPath, '.wiki-master', 'ops');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const ops = [];
  for (const name of names.sort()) {
    const match = TOKEN_FILE.exec(name);
    if (!match) continue;
    const file = join(dir, name);
    let started;
    try {
      started = startedMs(file);
    } catch {
      continue; // vanished between readdir and stat: its own op-commit just closed it
    }
    const ageHours = (now - started) / 3600000;
    ops.push({ token: match[1], op: opOf(file), startedAt: new Date(started).toISOString(), ageHours, stale: ageHours >= staleHours, file });
  }
  return ops;
}
