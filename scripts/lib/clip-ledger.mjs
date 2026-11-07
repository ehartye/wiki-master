import { appendFileSync, closeSync, openSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isUnder } from './vault.mjs';

// The clip ledger: with `--ledger <file>`, clip.mjs appends one JSON line for every address it handled, so a long run can be read
// back without parsing what the clipper printed. Every row has every field; one that does not apply to an outcome is null.
export const LEDGER_FIELDS = ['url', 'status', 'path', 'sourceHash', 'quality', 'topic', 'extraction', 'fidelity', 'reason', 'twinUrl', 'documentLink', 'expandCoverage', 'unexpandedTabs', 'extractionRetry', 'visibleWords', 'extractedWords'];

// The row for what clip.mjs's main returned. A result names a problem as `error` (a refused command) or `reason`.
export function ledgerRow(result) {
  const row = {};
  for (const field of LEDGER_FIELDS) row[field] = result[field] ?? null;
  row.reason = result.reason ?? result.error ?? null;
  return row;
}

// An address as the ledger may hold it: the same address without a username or password, or null when the text is not an address.
// A credential must not be kept anywhere a later reader will find it.
export function redactAddress(text) {
  try {
    const u = new URL(String(text ?? ''));
    u.username = '';
    u.password = '';
    return u.href;
  } catch { return null; }
}

// Why this file may not be the ledger, or null. A ledger in raw/ would be taken for a clipping and one in wiki/ for a page.
export function ledgerFileProblem(file, vaultPath) {
  if (!file) return '--ledger needs a file: --ledger <file>';
  for (const zone of ['raw', 'wiki']) {
    if (isUnder(file, join(vaultPath, zone))) return `--ledger: ${file} is inside ${zone}/ of the vault; keep the ledger outside raw/ and wiki/`;
  }
  return null;
}

// Why rows cannot be appended to this file, or null: it is opened for append and closed, which creates the file when its folder is
// there. No folder is made for it, so a typo in the path is a refusal and not a new directory.
export function ledgerAppendProblem(file) {
  // Windows opens a directory for append without complaint, so a directory is refused by name.
  try { if (statSync(file, { throwIfNoEntry: false })?.isDirectory()) return `--ledger: ${file} cannot be appended to (EISDIR); nothing was clipped`; closeSync(openSync(file, 'a')); return null; } catch (e) { return `--ledger: ${file} cannot be appended to (${e.code ?? e.message}); nothing was clipped`; }
}

export function appendLedgerRow(file, row) {
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}
