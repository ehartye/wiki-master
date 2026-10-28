import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { removeWritten } from './lib/op-ledger.mjs';
import { cliGuard, optionValue } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// A session drops its own operation token without committing: it stopped early, or its work landed another way. op-cleanup refuses
// a token under an hour old and wants a person to verify abandonment; this is for the session that holds the token and knows. It
// removes the one token named and nothing else. A token records only what was already dirty when the operation opened, so the
// files the operation wrote are untouched: they stay in the working tree, uncommitted, for a later operation to commit.
export function abortOperation(vaultPath, token, { now = Date.now() } = {}) {
  // The token is joined into a path and unlinked, so its shape is checked and not assumed (see op-commit).
  if (!/^[0-9a-f]{8,64}$/.test(String(token))) {
    return { ok: false, reason: `malformed operation token "${token}": expected the hex string op-begin printed` };
  }
  const file = join(vaultPath, '.wiki-master', 'ops', `${token}.json`);
  let record;
  try { record = JSON.parse(readFileSync(file, 'utf8')); }
  catch { return { ok: false, reason: `no such operation token "${token}"` }; }
  unlinkSync(file);
  removeWritten(vaultPath, token);
  const startedAt = typeof record.startedAt === 'string' ? record.startedAt : null;
  return {
    ok: true, token, op: typeof record.op === 'string' ? record.op : null, startedAt,
    ageHours: startedAt && Number.isFinite(Date.parse(startedAt)) ? (now - Date.parse(startedAt)) / 3600000 : null,
    dirtyCount: Array.isArray(record.dirty) ? record.dirty.length : 0,
  };
}

export function main(argv = process.argv.slice(2)) {
  const token = optionValue(argv, 'since');
  if (!token) {
    console.error('usage: node scripts/op-abort.mjs --since <token>');
    process.exitCode = 1;
    return;
  }
  const { path: vaultPath } = resolveVault();
  const r = abortOperation(vaultPath, token);
  if (!r.ok) { console.error(`op-abort: ${r.reason}`); process.exitCode = 1; return; }
  const when = r.startedAt ? `started ${r.startedAt}` : 'start time unknown';
  console.log(`op-abort: dropped operation ${r.token} (${r.op ?? 'unknown op'}, ${when}). Files it wrote are still in the working tree, uncommitted; commit them with a new operation (op-commit --include) or review them with git status.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
