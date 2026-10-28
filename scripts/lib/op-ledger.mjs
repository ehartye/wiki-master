import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { LedgerError, checkLedgerPaths, ledgerPathProblem } from './ledger.mjs';
import { optionValue } from './cli-guard.mjs';

// The paths one operation wrote, recorded by the writers when they write them.
//
// The set used to be rebuilt afterwards from the nearest lossy channel: `git show --name-only` (which prints a non-ASCII
// name as "a\342\200\224b.md" unless told otherwise, so a clipping with an em dash in its name fell out of a list of 24),
// a page's `sources:` line, a free-text report from a delegated worker. A writer knows the exact path at the moment it
// writes, so it says so once, here, keyed by the operation token it was given with `--since`.
//
// One file per operation, beside the token: `.wiki-master/ops/<token>.paths.jsonl`, one JSON string per line, UTF-8, the
// vault-relative path with / separators. The name does not match the token pattern (`<hex>.json`), so it is never counted as
// an operation. op-commit, op-abort and op-cleanup remove it with the token.
//
// A call appends all its lines with one appendFileSync, so a batch is whole or absent. [measured 2026-10-28, win32]
// three processes, 1,000 calls each, three paths per call: 9,000 whole lines, none torn, none lost. The test repeats a
// smaller run, so CI measures ubuntu and macos too.

const TOKEN = /^[0-9a-f]{8,64}$/;

export const writtenLedgerFile = (vaultPath, token) => join(vaultPath, '.wiki-master', 'ops', `${token}.paths.jsonl`);

// null when the token names an open operation, otherwise what is wrong. The shape is checked before the token is joined into
// a path, as op-commit and op-abort do: it arrives from a command line an agent assembled.
export function openOperationProblem(vaultPath, token) {
  if (!TOKEN.test(String(token))) return `malformed operation token "${token}": expected the hex string op-begin printed`;
  if (!existsSync(join(vaultPath, '.wiki-master', 'ops', `${token}.json`))) return `no open operation "${token}": was op-begin run, and is it still open?`;
  return null;
}

// A path as the ledger holds it: vault-relative with / separators. An absolute path must be inside the vault. A relative one
// may arrive with Windows separators from a command line; the ledger rule refuses a backslash anywhere, so it is mended here.
function toVaultRelative(vaultPath, p) {
  if (typeof p !== 'string') return p;
  if (!isAbsolute(p)) return p.replaceAll('\\', '/');
  const rel = relative(vaultPath, p);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new LedgerError(`path is outside the vault: ${JSON.stringify(p)}`);
  return rel.split(sep).join('/');
}

// Appends the given paths to the operation's ledger and returns them as stored. All or nothing: one bad path refuses the call.
export function recordWritten(vaultPath, token, paths) {
  const problem = openOperationProblem(vaultPath, token);
  if (problem) throw new LedgerError(problem);
  if (!Array.isArray(paths) || !paths.length) throw new LedgerError('no path given to record');
  const stored = checkLedgerPaths(paths.map((p) => toVaultRelative(vaultPath, p)));
  appendFileSync(writtenLedgerFile(vaultPath, token), stored.map((p) => `${JSON.stringify(p)}\n`).join(''));
  return stored;
}

// The recorded paths without repeats, in first-seen order. No ledger yet is an empty list; a damaged line is an error that
// names it, because a path silently dropped from the ledger is the failure this file exists to prevent.
export function readWritten(vaultPath, token) {
  const file = writtenLedgerFile(vaultPath, token);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new LedgerError(`cannot read ${file}: ${error.code ?? error.message}`);
  }
  const seen = new Set();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line) return;
    let value;
    try { value = JSON.parse(line); } catch { throw new LedgerError(`${file} line ${i + 1} is not a JSON string`); }
    const bad = ledgerPathProblem(value);
    if (bad) throw new LedgerError(`${file} line ${i + 1}: ${bad}`);
    seen.add(value);
  });
  return [...seen];
}

export function removeWritten(vaultPath, token) {
  rmSync(writtenLedgerFile(vaultPath, token), { force: true });
}

// Tokens that have a ledger file but no operation any more (the token was removed some other way). Nothing can read such a
// ledger, so it is only listed; op-cleanup removes it when its token is named.
export function orphanLedgers(vaultPath) {
  let names;
  try { names = readdirSync(join(vaultPath, '.wiki-master', 'ops')); } catch { return []; }
  const open = new Set(names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)));
  return names.map((n) => /^([0-9a-f]{8,64})\.paths\.jsonl$/.exec(n)?.[1]).filter((token) => token && !open.has(token)).sort();
}

// What a clipper or other writer calls after it has written. Without `--since` it does nothing, so a clip outside an
// operation behaves as before. After a write has already succeeded, a failure to record is said (with the path and the
// command that adds it) and not thrown: the file is on disk, and `op-ledger.mjs show` lists it as unclaimed until it is added.
export function writtenRecorder(vaultPath, argv, { warn = (message) => console.error(message) } = {}) {
  const token = optionValue(argv, 'since');
  if (token === undefined) return () => {};
  return (paths) => {
    const list = [paths].flat();
    try { recordWritten(vaultPath, token, list); } catch (error) {
      // The command is ready to run: vault-relative, quoted, and not a JSON-escaped absolute path.
      const shown = list.map((p) => { try { return toVaultRelative(vaultPath, p); } catch { return p; } });
      warn(`not recorded in the operation ledger (${error.message}); record it with: node scripts/op-ledger.mjs add --since ${token} ${shown.map((p) => `"${p}"`).join(' ')}`);
    }
  };
}
