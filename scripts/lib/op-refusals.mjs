import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A counts-only record of the op-commit closes that were refused, so the noise a refusal causes can be measured. One JSON line
// per refused close in `.wiki-master/op-refusals.jsonl` (git-ignored, like the rest of `.wiki-master/`), with the keys
// `at` (ISO time), `op`, `kind` and `paths`. `paths` is a number and never a path name: a vault path can be private.
//
// The three kinds are the three places commitOp refuses a close and keeps its token:
//   pre-dirty  paths named in the ledger were already dirty before op-begin; `paths` is how many were not adopted.
//   evidence   a declared size or hash does not match what git would store; `paths` is the size of the evidence map.
//   unscoped   the close had no --paths-file while another operation was open; `paths` is how many delta paths it would
//              have committed.
//
// Recording is a courtesy to the measurement and never to the close: a failed append (a directory in the file's place, a
// read-only disk) changes neither the result nor the exit code.

export const REFUSAL_KINDS = ['pre-dirty', 'evidence', 'unscoped'];

export const refusalsFile = (vaultPath) => join(vaultPath, '.wiki-master', 'op-refusals.jsonl');

export function recordRefusal(vaultPath, { op, kind, paths }, { now = new Date() } = {}) {
  try {
    if (!REFUSAL_KINDS.includes(kind)) return false;
    const count = Number.isInteger(paths) && paths >= 0 ? paths : 0;
    mkdirSync(join(vaultPath, '.wiki-master'), { recursive: true });
    appendFileSync(refusalsFile(vaultPath), `${JSON.stringify({ at: now.toISOString(), op: typeof op === 'string' ? op : null, kind, paths: count })}\n`);
    return true;
  } catch {
    return false;
  }
}

// The totals by kind. An absent, unreadable or empty file, and any line that is not a record of a known kind, count as nothing.
export function readRefusalCounts(vaultPath) {
  const counts = { total: 0, preDirty: 0, evidence: 0, unscoped: 0 };
  let text;
  try { text = readFileSync(refusalsFile(vaultPath), 'utf8'); } catch { return counts; }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let kind;
    try { kind = JSON.parse(line)?.kind; } catch { continue; }
    if (kind === 'pre-dirty') counts.preDirty++;
    else if (kind === 'evidence') counts.evidence++;
    else if (kind === 'unscoped') counts.unscoped++;
    else continue;
    counts.total++;
  }
  return counts;
}

// The one health line, or null when nothing was recorded.
export function refusalsLine(counts) {
  if (!counts || !(counts.total > 0)) return null;
  return `Recorded op-commit refusals: ${counts.total} (pre-dirty ${counts.preDirty}, evidence ${counts.evidence}, unscoped ${counts.unscoped}).`;
}
