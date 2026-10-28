import { listOperations, STALE_OPERATION_HOURS } from './op-tokens.mjs';

// The operations still open in a vault, said where people look: `health` and `session-brief`. An operation token is removed only
// by its own op-commit, so a session that ends before closing leaves one behind, and until now the only sign was a note at the end of
// a sync. This is read-only and says nothing when nothing is open.
const age = (hours) => {
  if (hours < 1) return 'under an hour';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
};

export function openOperationsList(vaultPath, options = {}) {
  return listOperations(vaultPath, options).map((o) => ({
    token: o.token, op: o.op, startedAt: o.startedAt, ageHours: Math.round(o.ageHours * 10) / 10, stale: o.stale,
  }));
}

export function openOperationsLine(vaultPath, options = {}) {
  const ops = listOperations(vaultPath, options);
  if (!ops.length) return null;
  const oldest = ops.reduce((a, b) => (b.ageHours > a.ageHours ? b : a));
  const stale = ops.filter((o) => o.stale).length;
  return `Open vault operations: ${ops.length} (oldest ${age(oldest.ageHours)}, ${oldest.op ?? 'unknown op'} ${oldest.token.slice(0, 8)})`
    + `${stale ? `; ${stale} older than ${STALE_OPERATION_HOURS} hours` : ''}. List them with op-cleanup.mjs; drop one you started with op-abort.mjs --since <token>.`;
}
