import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { listOperations, STALE_OPERATION_HOURS } from './lib/op-tokens.mjs';
import { orphanLedgers, removeWritten } from './lib/op-ledger.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// Removes operation tokens left behind by operations that never closed. A token
// only records what was already dirty when its operation opened, so deleting an
// abandoned one loses nothing but the ability to op-commit that dead operation.
//
// Dry run unless --apply. A recent token is never removed, whatever the flags: the
// cut-off has a floor of one hour, and explicit token IDs require the caller to verify abandonment.
// Named "cleanup" and not "purge" because wiki-purge already means deleting topics.
const MIN_HOURS = 1;

export function cleanupOperations(vaultPath, { hours = STALE_OPERATION_HOURS, apply = false, tokens } = {}) {
  if (!Number.isFinite(hours) || hours < MIN_HOURS) throw new Error('hours must be finite and at least 1');
  if (apply && (!Array.isArray(tokens) || !tokens.length)) throw new Error('Explicit --token IDs are required with --apply; age does not prove abandonment');
  const all = listOperations(vaultPath, { staleHours: hours });
  const stale = all.filter((o) => o.stale);
  // A ledger of the paths an operation's writers recorded (lib/op-ledger.mjs) goes with its token. One whose token is already
  // gone is listed, and removed only when its token is named, like a token.
  const orphans = orphanLedgers(vaultPath);
  const removed = [];
  const removedLedgers = [];
  if (apply) {
    for (const o of stale.filter(o => tokens.includes(o.token))) {
      // force: a token its own op-commit closed a moment ago is already gone, not an error
      rmSync(o.file, { force: true });
      removeWritten(vaultPath, o.token);
      removed.push(o.token);
    }
    for (const token of orphans.filter((t) => tokens.includes(t))) {
      removeWritten(vaultPath, token);
      removedLedgers.push(token);
    }
  }
  return { applied: apply, hours, stale, removed, orphanLedgers: orphans, removedLedgers, kept: all.filter((o) => !o.stale).map((o) => o.token) };
}

export async function main(argv) {
  const usage = 'usage: node scripts/op-cleanup.mjs [--hours <n>] [--apply]';
  let hours = STALE_OPERATION_HOURS;
  let apply = false;
  const tokens = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--token' && /^[0-9a-f]{8,64}$/.test(argv[i + 1] ?? '')) tokens.push(argv[++i]);
    else if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--hours') {
      const raw = argv[i + 1];
      i += 1;
      hours = raw !== undefined && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
      if (!(hours >= MIN_HOURS)) {
        console.error(`op-cleanup: --hours needs a number of at least ${MIN_HOURS}, with explicit IDs required for removal\n${usage}`);
        process.exitCode = 1;
        return;
      }
    } else {
      console.error(`op-cleanup: unknown option ${argv[i]}\n${usage}`);
      process.exitCode = 1;
      return;
    }
  }
  const { path: vaultPath } = resolveVault();
  let r;
  try { r = cleanupOperations(vaultPath, { hours, apply, tokens }); }
  catch (err) { console.error(err.message); process.exitCode = 1; return; }
  if (r.orphanLedgers.length) {
    const left = r.orphanLedgers.filter((t) => !r.removedLedgers.includes(t));
    if (r.removedLedgers.length) console.log(`removed ${r.removedLedgers.length} written-paths ledger(s) whose operation was already gone.`);
    if (left.length) console.log(`written-paths ledger(s) with no operation (${left.join(', ')}): remove each with --apply --token <id> once you have checked its paths were committed or are no longer wanted.`);
  }
  if (!r.stale.length) {
    console.log(`op-cleanup: no abandoned operation tokens (older than ${hours} hours); ${r.kept.length} recent kept.`);
    return;
  }
  for (const o of r.stale) {
    console.log(`${o.token}  ${o.op ?? 'unknown op'}  started ${o.startedAt} (${Math.floor(o.ageHours / 24)}d ${Math.floor(o.ageHours % 24)}h ago)`);
  }
  if (!apply) {
    console.log(`dry run: ${r.stale.length} abandoned token(s) older than ${hours} hours would be removed, ${r.kept.length} recent kept. After verifying abandonment, use --apply --token <id> (repeat --token for each).`);
    return;
  }
  console.log(`removed ${r.removed.length} abandoned token(s); kept ${r.kept.length} recent.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
