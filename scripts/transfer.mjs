import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vaultPath as checkedPath } from './lib/vault-path.mjs';
import { resolveContext, requireSelectedTarget, contextEnv, ContextError } from './lib/context.mjs';
import { commandLines } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { buildManifest, purgeId, binPathFor } from './lib/purge.mjs';
import { planTransfer, pagesUnder, sha256Bytes, DEFAULT_DEPTH } from './lib/transfer.mjs';
import { clippingHash } from './lib/clipping-hash.mjs';
import { readManifests, writeManifest, nextFreePurgeId, applyPurge, enrichPages } from './purge.mjs';
import { loadDeclines, recordDecline } from './lib/decline.mjs';
import { writeLogEntry } from './log-entry.mjs';
import { cliGuard, optionValues } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// Copy or move wiki content between two registered vaults. The planning is lib/transfer.mjs; this file binds
// the two vaults, prints the plan, and applies a reviewed one. It runs no git command: Obsidian Git publishes
// what lands in each vault.

const REFRESH = fileURLToPath(new URL('./refresh-index.mjs', import.meta.url));
const PURGE = fileURLToPath(new URL('./purge.mjs', import.meta.url));

class UsageError extends Error { constructor(message) { super(message); this.exitCode = 2; } }

// Both vaults come from the registry by ID. A vault named some other way in the environment would be a third
// opinion about which vault is meant, so those variables are left out of the resolution.
export function bindVault(id, env = process.env) {
  const clean = { ...env };
  for (const key of ['WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_NAME', 'WIKI_MASTER_VAULT_ID']) delete clean[key];
  if (!resolveContext(clean, { purpose: 'maintenance', discoverLegacyProject: false }).configPath) {
    throw new UsageError('transfer needs a vault registry: register both vaults first (wiki-setup), then name them with --from and --to');
  }
  const context = resolveContext(clean, { purpose: 'maintenance', select: id, discoverLegacyProject: false });
  const target = requireSelectedTarget(context, { available: true });
  return { id: target.id, path: target.path, env: contextEnv(context, clean) };
}

const readIn = (vault) => (path) => {
  try { return readFileSync(checkedPath(vault.path, path)); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') return null; throw error; }
};

export function parseArgs(argv) {
  const plan = argv.includes('--plan');
  const apply = argv.includes('--apply');
  if (plan && apply) throw new UsageError('give --plan or --apply, not both');
  const one = (name) => {
    const values = optionValues(argv, name);
    if (values.length > 1) throw new UsageError(`--${name} was given more than once`);
    if (values.length && !values[0]) throw new UsageError(`--${name} needs a value`);
    return values[0];
  };
  const from = one('from');
  const to = one('to');
  if (!from || !to) throw new UsageError('name both vaults: --from <vault-id> --to <vault-id>');
  if (from === to) throw new UsageError('--from and --to name the same vault');
  const seeds = optionValues(argv, 'seeds').flatMap((v) => v.split(',')).map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
  const folders = optionValues(argv, 'seed-folder').map((s) => s.trim()).filter(Boolean);
  if (optionValues(argv, 'seeds').some((v) => !v) || optionValues(argv, 'seed-folder').some((v) => !v)) throw new UsageError('--seeds and --seed-folder need a value');
  if (!seeds.length && !folders.length) throw new UsageError('name the seed pages: --seeds a.md,b.md or --seed-folder <folder>');
  const depthText = one('depth');
  const depth = depthText === undefined ? DEFAULT_DEPTH : /^\d+$/.test(depthText) ? Number(depthText) : NaN;
  if (Number.isNaN(depth)) throw new UsageError(`--depth must be a whole number of 0 or more (got "${depthText}")`);
  const mode = one('mode') ?? 'copy';
  if (!['copy', 'move'].includes(mode)) throw new UsageError(`--mode must be copy or move (got "${mode}")`);
  const onConflict = one('on-conflict') ?? 'refuse';
  if (!['refuse', 'keep-destination'].includes(onConflict)) throw new UsageError(`--on-conflict must be refuse or keep-destination (got "${onConflict}")`);
  const expect = one('expect');
  if (apply && !expect) throw new UsageError('--apply needs --expect <plan-id>, the id a reviewed --plan printed');
  return { apply, from, to, seeds, folders, depth, mode, onConflict, expect, allowHashMismatch: argv.includes('--allow-hash-mismatch'), json: argv.includes('--json') };
}

function loadVault(vault) {
  const { pages } = buildGraph(vault.path);
  return { id: vault.id, pages, read: readIn(vault) };
}

export function computePlan(args, source, destination) {
  const src = loadVault(source);
  const dst = loadVault(destination);
  const { manifests } = readManifests(destination.path);
  dst.recycled = manifests.flatMap((m) => m.entries ?? []);
  const seeds = [...args.seeds];
  for (const folder of args.folders) {
    const under = pagesUnder(src.pages, folder);
    if (!under.length) return { errors: [`--seed-folder ${folder} holds no page in vault ${source.id}`] };
    seeds.push(...under);
  }
  return planTransfer({ source: src, destination: dst, seeds, depth: args.depth, mode: args.mode, onConflict: args.onConflict, allowHashMismatch: args.allowHashMismatch });
}

const kb = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function report(plan, log = console.log) {
  log(`TRANSFER PLAN ${plan.id} — ${plan.mode} from vault ${plan.from} to vault ${plan.to}, depth ${plan.depth}`);
  log(`  seeds (${plan.seeds.length}):`);
  for (const s of plan.seeds) log(`    ${s}`);
  for (const [reason, title] of [['seed', 'seeds'], ['linked', 'linked or cited by a selected page'], ['cited', 'source pages named in sources:'], ['evidence', 'raw evidence cited or embedded']]) {
    const rows = plan.entries.filter((e) => e.reason === reason);
    if (!rows.length || reason === 'seed') continue;
    log(`\n  ${title} (${rows.length}):`);
    for (const e of rows) log(`    ${e.path}${e.depth ? ` (depth ${e.depth})` : ''}  <- ${e.via}`);
  }
  const states = (s) => plan.entries.filter((e) => e.state === s);
  if (states('present').length) log(`\n  already at the destination, identical (${states('present').length}): skipped on apply`);
  if (states('keep-destination').length) {
    log(`\n  KEEP DESTINATION — conflicting files left as the destination has them (${states('keep-destination').length}):`);
    for (const e of states('keep-destination')) log(`    ${e.path} — ${e.conflict}`);
  }
  if (plan.linkChanges.length) {
    log(`\n  LINKS CHANGED (${plan.linkChanges.length}):`);
    let page = null;
    for (const c of plan.linkChanges) {
      if (c.page !== page) { page = c.page; log(`    ${page}`); }
      log(`      ${c.kind === 'plain' ? 'outside the selection, becomes text' : 'full path, so it resolves to the same file'}: ${c.from} -> ${c.to}`);
    }
  }
  if (plan.notes.attaches.length) {
    log(`\n  NOTE — links unresolved in ${plan.from} that will resolve at ${plan.to} (${plan.notes.attaches.length}):`);
    for (const a of plan.notes.attaches) log(`    ${a.page}: ${a.link} -> ${a.resolves}`);
  }
  if (plan.notes.mismatched.length) {
    log(`
  HASH MISMATCH ACCEPTED — copied byte for byte, the mismatch kept and named in both logs (${plan.notes.mismatched.length}):`);
    for (const p of plan.notes.mismatched) log(`    ${p}`);
  }
  if (plan.notes.unhashed.length) {
    log(`\n  NOTE — clippings with no source-hash, verified by their bytes only (${plan.notes.unhashed.length}); adopt-clipping.mjs can stamp them:`);
    for (const p of plan.notes.unhashed) log(`    ${p}`);
  }
  if (plan.removal) {
    log(`\n  MOVE — removed at ${plan.from} through a purge transaction (${plan.removal.remove.length})`);
    if (plan.removal.keep.length) {
      log(`  kept at ${plan.from} as well, because pages outside the selection refer to them or to a page that does (${plan.removal.keep.length}):`);
      for (const k of plan.removal.keep) log(`    ${k.path}${k.by.length ? `  <- ${k.by.slice(0, 3).join(', ')}${k.by.length > 3 ? ` and ${k.by.length - 3} more` : ''}` : ''}`);
    }
    if (plan.removal.collateral.length) {
      log(`  COLLATERAL — pages staying at ${plan.from} that link to removed pages; repair them as plain text naming vault ${plan.to} (${plan.removal.collateral.length}):`);
      for (const c of plan.removal.collateral) log(`    ${c}`);
    }
  }
  if (plan.conflicts.length) {
    log(`\n  CONFLICTS — refused unless --on-conflict keep-destination (${plan.conflicts.length}):`);
    for (const c of plan.conflicts) log(`    ${c.path} — ${c.detail}`);
  }
  if (plan.blocking.length) {
    log(`\n  BLOCKING — apply refuses until these are resolved (${plan.blocking.length}):`);
    for (const b of plan.blocking) log(`    ${b.path} — ${b.reason}: ${b.detail}`);
  }
  const plain = plan.linkChanges.filter((c) => c.kind === 'plain').length;
  log(`\nTRANSFER: ${plan.totals.wiki} wiki, ${plan.totals.raw} raw, ${kb(plan.totals.bytes)}; ${plain} link(s) become text, ${plan.linkChanges.length - plain} get a full path; ${plan.conflicts.length} conflict(s), ${plan.blocking.length} blocking`);
  log(`plan id: ${plan.id}`);
}

// Written next to its destination and renamed into place, so a reader never sees half a file, and checked
// before the rename, so a file that does not hash as planned never lands.
function writeVerified(vaultPath, path, bytes, expected) {
  const dest = checkedPath(vaultPath, path);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = checkedPath(vaultPath, dirname(path), `.${basename(path)}.transfer-${process.pid}.tmp`);
  writeFileSync(tmp, bytes);
  if (sha256Bytes(readFileSync(tmp)) !== expected) { rmSync(tmp, { force: true }); throw new Error(`${path}: the written copy does not hash as planned`); }
  renameSync(tmp, dest);
}

// One log entry per vault per transfer, however many times an interrupted apply is resumed.
function hasLogEntry(vaultPath, op, id) {
  let names;
  try { names = readdirSync(checkedPath(vaultPath, 'log')); } catch { return false; }
  return names.some((n) => n.includes(`-${op}-`) && n.endsWith('.md') && readFileSync(checkedPath(vaultPath, 'log', n), 'utf8').includes(`Transfer \`${id}\``));
}

const list = (title, paths) => (paths.length ? `\n${title}\n${paths.map((p) => `- \`${p}\``).join('\n')}\n` : '');

function destinationBody(plan, written) {
  const plain = plan.linkChanges.filter((c) => c.kind === 'plain').length;
  const hashed = plan.entries.filter((e) => e.sourceHash && !e.hashMismatch && e.state !== 'keep-destination').length;
  return `Transfer \`${plan.id}\` (${plan.mode}) from vault \`${plan.from}\`: ${plan.totals.wiki} wiki page(s) and ${plan.totals.raw} raw file(s), ${kb(plan.totals.bytes)}.\n` +
    `Raw files are byte-identical to vault \`${plan.from}\`; ${hashed} source-hash(es) verified. ${plain} link(s) to pages outside the selection became plain text naming vault \`${plan.from}\`; ` +
    `${plan.linkChanges.length - plain} link(s) were given their full path.\n` +
    list('Seeds:', plan.seeds) +
    list('Written:', written) +
    list('Copied as they are, their text already not matching their source-hash at the source:', plan.notes.mismatched) +
    list('Kept as this vault had them (conflicts):', plan.entries.filter((e) => e.state === 'keep-destination').map((e) => e.path));
}

function sourceBody(plan, removal) {
  const transferred = plan.entries.filter((e) => e.state !== 'keep-destination').map((e) => e.path);
  let body = `Transfer \`${plan.id}\` (${plan.mode}) to vault \`${plan.to}\`: ${transferred.length} file(s) copied there.\n` + list('Seeds:', plan.seeds);
  body += list('Copied as they are, their text already not matching their source-hash here:', plan.notes?.mismatched ?? []);
  if (!removal) return body + list('Copied:', transferred);
  if (removal.purgeId) body += `\nRemoved here through purge \`${removal.purgeId}\`, restorable with \`purge.mjs --restore ${removal.purgeId}\`.\n`;
  else body += '\nNothing was removed here.\n';
  body += list('Removed:', removal.removed);
  body += list('Copied and kept here, because pages outside the selection refer to them or to a page that does:', plan.removal.keep.map((k) => k.path));
  body += list('Changed since the plan, so not removed:', removal.changed);
  if (plan.removal.collateral.length) body += `\nCollateral needing reference repair:\n${plan.removal.collateral.map((c) => `- [[${c}]]`).join('\n')}\n`;
  return body;
}

// purge.mjs hashes the text it reads, and its --restore compares with that, so the manifest's hashes are made
// the same way.
const utf8Sha = (bytes) => createHash('sha256').update(bytes.toString('utf8')).digest('hex');

// Moves the manifest's entries into the source's bin. The manifest is written before anything moves and names
// the transfer, so an interrupted removal is found and finished by the next apply of the same plan. A file whose
// text is no longer what the manifest recorded is someone's newer work and stays where it is. Once every move has
// succeeded, each removed clipping's address is declined at the source under the purge's own reason, as purge.mjs
// does: otherwise discovery there could clip it again and the next --reconcile would bin the new copy by its hash.
// --restore clears exactly these declines.
function removeAtSource(source, manifest) {
  const changed = [];
  const entries = [];
  for (const e of manifest.entries) {
    const bytes = readIn(source)(e.from);
    if (bytes === null) continue;
    if (utf8Sha(bytes) !== e.sha256) changed.push(e.from);
    else entries.push(e);
  }
  const { failed } = applyPurge(source.path, { ...manifest, entries });
  const removed = manifest.entries.filter((e) => existsSync(checkedPath(source.path, binPathFor(manifest.id, e.from)))).map((e) => e.from);
  if (!failed.length) {
    const reason = `purged:${manifest.id}`;
    const have = new Set(loadDeclines(source.path).filter((d) => d.reason === reason).map((d) => d.url));
    for (const e of manifest.entries) {
      if (!e.url || !removed.includes(e.from) || have.has(e.url)) continue;
      recordDecline(source.path, e.url, reason);
      have.add(e.url);
    }
  }
  return { removed, changed, failed };
}

function finish(source, destination, plan, removal, log, err) {
  if (removal?.failed.length) {
    for (const x of removal.failed) err(`  could not be removed: ${x.from} — ${x.reason}`);
    err('Close whatever holds them open, then run the same --apply again to finish this transfer.');
    return 1;
  }
  for (const p of removal?.changed ?? []) log(`  changed at ${plan.from} since it was planned, so left in place: ${p}`);
  if (!hasLogEntry(source.path, 'transfer-out', plan.id)) {
    writeLogEntry({ vaultPath: source.path, op: 'transfer-out', title: `to ${plan.to} ${plan.id}`, body: sourceBody(plan, removal) });
  }
  log('\nThe transfer is on disk in both vaults. Obsidian Git publishes each on its next run.');
  log('NEXT: refresh the destination');
  for (const line of commandLines(REFRESH, '', destination.env)) log(`  ${line}`);
  if (plan.mode === 'move') {
    log(plan.removal.collateral.length ? 'then repair the collateral pages at the source and refresh it' : 'and refresh the source');
    for (const line of commandLines(REFRESH, '', source.env)) log(`  ${line}`);
    if (removal?.purgeId) {
      log(`To undo the removal at ${plan.from}:`);
      for (const line of commandLines(PURGE, ` --restore ${removal.purgeId}`, source.env)) log(`  ${line}`);
    }
  }
  return 0;
}

// What a move's manifest keeps of the plan: enough to finish the removal and write its log entry.
const planRecord = (plan) => ({
  id: plan.id, from: plan.from, to: plan.to, mode: plan.mode, seeds: plan.seeds, totals: plan.totals, notes: { mismatched: plan.notes.mismatched },
  entries: plan.entries.map(({ path, state }) => ({ path, state })),
  removal: plan.removal,
});

export async function main(argv = process.argv.slice(2), { log = console.log, err = console.error } = {}) {
  const args = parseArgs(argv);
  const source = bindVault(args.from);
  const destination = bindVault(args.to);

  if (args.apply) {
    // A move whose copy finished and whose removal began: the source no longer matches the plan, by design.
    const pending = readManifests(source.path).manifests.find((m) => m.transfer?.plan?.id === args.expect);
    if (pending) {
      const plan = pending.transfer.plan;
      log(`resuming the removal of transfer ${plan.id} at ${plan.from} (purge ${pending.id})`);
      const r = removeAtSource(source, pending);
      return finish(source, destination, plan, { purgeId: pending.id, ...r }, log, err);
    }
  }

  const plan = computePlan(args, source, destination);
  if (plan.errors) { for (const e of plan.errors) err(`transfer: ${e}`); return 2; }
  if (!args.apply) {
    if (args.json) log(JSON.stringify(plan, null, 2));
    else {
      report(plan, log);
      log(`(plan only — nothing was written. To apply it, rerun the same command with --apply --expect ${plan.id})`);
    }
    return 0;
  }

  if (plan.id !== args.expect) {
    err(`transfer: the plan is now ${plan.id}, not the reviewed ${args.expect}: a file, a link or the destination changed since the review. Run --plan again and review it.`);
    return 1;
  }
  if (plan.blocking.length || plan.conflicts.length) {
    report(plan, err);
    err('transfer: refusing to apply while anything is blocking or in conflict.');
    return 1;
  }

  // Copy every file not already there, each verified before it lands; then verify every transferred file.
  const written = [];
  for (const e of plan.entries) {
    if (e.state !== 'write') continue;
    writeVerified(destination.path, e.path, plan.outputs.get(e.path), e.outSha);
    written.push(e.path);
  }
  const dst = readIn(destination);
  const transferred = plan.entries.filter((e) => e.state !== 'keep-destination');
  const bad = transferred.filter((e) => {
    const there = dst(e.path);
    if (there === null || sha256Bytes(there) !== e.outSha) return true;
    return Boolean(e.sourceHash) && !e.hashMismatch && e.path.endsWith('.md') && clippingHash(there.toString('utf8')) !== e.sourceHash;
  });
  if (bad.length) {
    for (const e of bad) err(`transfer: ${e.path} at ${plan.to} does not match the plan`);
    err('transfer: verification failed, and nothing was removed at the source. Inspect those files, then run --plan again.');
    return 1;
  }
  log(`copied ${written.length} file(s) to ${plan.to}; ${transferred.length - written.length} were already there; all ${transferred.length} verified`);
  if (!hasLogEntry(destination.path, 'transfer-in', plan.id)) {
    writeLogEntry({ vaultPath: destination.path, op: 'transfer-in', title: `from ${plan.from} ${plan.id}`, body: destinationBody(plan, transferred.map((e) => e.path)) });
  }
  if (plan.mode !== 'move') return finish(source, destination, plan, null, log, err);

  // Remove at the source what the plan said, through a purge transaction. A file changed since the plan was
  // computed is left in place.
  const src = readIn(source);
  const srcSha = new Map(plan.entries.map((e) => [e.path, e.srcSha]));
  const removable = [];
  const changed = [];
  for (const p of plan.removal.remove) {
    const now = src(p);
    if (now === null) continue;
    (sha256Bytes(now) === srcSha.get(p) ? removable : changed).push(p);
  }
  if (!removable.length) return finish(source, destination, plan, { purgeId: null, removed: [], changed, failed: [] }, log, err);
  const id = nextFreePurgeId(source.path, purgeId(`transfer to ${plan.to}`));
  const pages = enrichPages(source.path, buildGraph(source.path).pages);
  const hashes = Object.fromEntries(removable.map((p) => [p, utf8Sha(src(p))]));
  const manifest = buildManifest({ id, topic: `transfer to ${plan.to}`, date: id.slice(0, 10), purge: removable, collateral: plan.removal.collateral, pages, hashes });
  // A figure sidecar carries its clipping's address too; one decline per address.
  manifest.declines = [...new Set(manifest.declines)];
  manifest.transfer = { plan: planRecord(plan) };
  writeManifest(source.path, manifest);
  const r = removeAtSource(source, manifest);
  log(`removed ${r.removed.length} file(s) at ${plan.from} into .recycle/${id}/`);
  return finish(source, destination, plan, { purgeId: id, ...r, changed: [...changed, ...r.changed] }, log, err);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    if (error instanceof ContextError || error instanceof UsageError || error.exitCode) { console.error(`transfer: ${error.message}`); process.exitCode = error.exitCode ?? 2; }
    else throw error;
  }
}
