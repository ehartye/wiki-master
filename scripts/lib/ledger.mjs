import { readFileSync } from 'node:fs';

// The ownership ledger: a JSON array of vault-relative file paths naming the pages one operation owns. It is the
// `--paths-file` of op-commit, refresh-catalogs and validate-authored, which used to carry three copies of the path
// rule (one also refused a colon, one accepted a byte-order mark). This is the one definition.
//
// A path is exact, with `/` separators, and names one file: no empty entry, no empty, `.` or `..` segment (so no
// leading or trailing slash), no backslash, no NUL, and no colon. A colon is refused anywhere, not only as a drive
// prefix: it cannot be in a file name on Windows (it opens an alternate data stream), the vault is shared between
// machines, and no path in the maintainer's vault has ever held one (checked over its whole history, 2026-10-26).

export class LedgerError extends Error {}

export function ledgerPathProblem(p) {
  if (typeof p !== 'string' || !p) return 'it is not a non-empty string';
  if (p.includes('\\')) return 'it holds a backslash (use / separators)';
  if (p.includes('\0')) return 'it holds a NUL';
  if (p.includes(':')) return 'it holds a colon (a drive prefix on Windows; a shared vault has no colon in a path)';
  if (p.split('/').some((part) => !part || part === '.' || part === '..')) return 'it has an empty, "." or ".." segment (or a leading or trailing slash)';
  return null;
}

// Returns the paths without repeats, in their given order, or throws.
export function checkLedgerPaths(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new LedgerError('the ledger must be a non-empty JSON array of vault-relative paths');
  for (const p of paths) {
    if (ledgerPathProblem(p)) throw new LedgerError(`invalid ledger path ${JSON.stringify(p)}: use vault-relative paths with / separators and no empty, "." or ".." segment, drive prefix, colon or NUL`);
  }
  return [...new Set(paths)];
}

const withoutBom = (text) => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);

// A ledger saved by Windows PowerShell or a Windows editor often starts with a byte-order mark, which JSON.parse refuses.
export function parseLedgerText(text) {
  return JSON.parse(withoutBom(text));
}

export function readLedger(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (error) { throw new LedgerError(`cannot read ledger file ${file}: ${error.code ?? error.message}`); }
  try { return parseLedgerText(text); }
  catch (error) { throw new LedgerError(`ledger file ${file} is not valid JSON: ${error.message}`); }
}
