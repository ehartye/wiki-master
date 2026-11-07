import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

export function appendLedgerRow(file, row) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}
