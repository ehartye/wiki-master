import { appendFileSync, closeSync, lstatSync, openSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { redactSecrets } from './url-safety.mjs';

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

// An address as the ledger may hold it: the same address without a username or password and with the value of each secret query
// parameter replaced by `redacted` (lib/url-safety.mjs), or null when the text is not an address. A secret must not be kept
// anywhere a later reader will find it.
export const redactAddress = redactSecrets;

// Where a path really lands: the real path of the nearest part of it that exists (every link in it followed, by the operating system,
// so a ".." after a link means what the system makes of it) with the part that does not exist yet put back on the end. A link that
// points nowhere is followed to where it would create a file.
function landing(file) {
  let head = isAbsolute(file) ? file : process.cwd() + sep + file;
  const tail = [];
  for (let hops = 0; hops < 64;) {
    try { return normalize(join(realpathSync.native(head), ...[...tail].reverse())); } catch { /* not there, or not all of it */ }
    let link = null;
    try { if (lstatSync(head).isSymbolicLink()) link = readlinkSync(head); } catch { /* nothing at this name */ }
    if (link !== null) {
      head = isAbsolute(link) ? link : join(dirname(head), link);
      hops++;
      continue;
    }
    const parent = dirname(head);
    if (parent === head) break;
    tail.push(basename(head));
    head = parent;
  }
  return resolve(file);
}

// True when "target" is "root" or inside it. macOS and Windows file systems ignore case, so the two are compared folded there.
function within(root, target) {
  const fold = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
  const rel = relative(fold(root), fold(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// The device and inode of a folder, or null when there is none or the file system does not give a usable one (an inode of 0 is how
// some file systems say "no identity"). Two spellings of one folder, such as C:\vault and \\localhost\C$\vault, share both.
function identityOf(path, stat) {
  try {
    const s = stat(path, { bigint: true });
    return s && s.ino !== 0n && s.ino !== 0 ? `${s.dev}:${s.ino}` : null;
  } catch { return null; }
}

// True when the target, or any ancestor of it that exists, is the folder with this identity. Only existing ancestors are
// stat-ed: a part that is not there yet cannot be the folder.
function hasAncestorWithIdentity(identity, target, stat) {
  for (let at = target, hops = 0; hops < 256; hops++) {
    const id = identityOf(at, stat);
    if (id !== null && id === identity) return true;
    const parent = dirname(at);
    if (parent === at) return false;
    at = parent;
  }
  return false;
}

// Why this file may not be the ledger, or null. A ledger in raw/ would be taken for a clipping and one in wiki/ for a page. The path
// is judged by where it lands (links, "..", letter case), not by how it is spelled. Where the text of a path cannot say so (a UNC
// spelling of a local folder), the folder's identity does: the device and inode of raw/ or wiki/ against those of every existing
// ancestor of the target. `stat` is a test's own.
export function ledgerFileProblem(file, vaultPath, { stat = statSync } = {}) {
  if (!file) return '--ledger needs a file: --ledger <file>';
  const real = landing(file);
  for (const zone of ['raw', 'wiki']) {
    const dir = join(vaultPath, zone);
    const own = identityOf(dir, stat);
    if (within(landing(dir), real) || within(resolve(dir), resolve(file)) || (own !== null && hasAncestorWithIdentity(own, real, stat))) return `--ledger: ${file} is inside ${zone}/ of the vault; keep the ledger outside raw/ and wiki/`;
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
