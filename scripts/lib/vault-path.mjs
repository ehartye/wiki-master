import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// Resolve the nearest existing ancestor, including a dangling link's destination.
// Missing leaves are valid write destinations; unreadable/cyclic ancestors are not.
export function canonicalDestination(path, seen = new Set()) {
  const absolute = resolve(path);
  if (seen.has(absolute)) throw Object.assign(new Error(`Cannot resolve cyclic path: ${path}`), { code: 'ELOOP' });
  seen.add(absolute);
  try { return realpathSync(absolute); }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    try {
      if (lstatSync(absolute).isSymbolicLink()) {
        return canonicalDestination(resolve(dirname(absolute), readlinkSync(absolute)), seen);
      }
    } catch (linkError) { if (!['ENOENT', 'ENOTDIR'].includes(linkError.code)) throw linkError; }
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(canonicalDestination(parent, seen), basename(absolute));
  }
}

export function containsPath(root, target) {
  const fold = p => process.platform === 'win32' ? p.toLowerCase() : p;
  const rel = relative(fold(root), fold(target));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function assertVaultPath(root, target) {
  if (!containsPath(resolve(root), resolve(target)) || !containsPath(canonicalDestination(root), canonicalDestination(target))) {
    throw Object.assign(new Error(`Path is outside the selected vault: ${target}`), { code: 'OUTSIDE_VAULT', exitCode: 2 });
  }
  return target;
}

// Retain the caller's spelling, while checking the actual filesystem destination.
export const vaultPath = (root, ...parts) => assertVaultPath(root, join(root, ...parts));
