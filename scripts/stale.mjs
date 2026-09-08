import { obsidianJson, resolveVault } from './lib/vault.mjs';
import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseNote } from './lib/note.mjs';

const DAY = 86_400_000;
const THRESHOLDS = { fresh: 30, aging: 90, stale: 180 }; // days; beyond stale => rotten

function ageDays(page, today) {
  const reviewed = page.reviewed ? new Date(page.reviewed).getTime() : NaN;
  if (!Number.isFinite(reviewed)) return Infinity;
  return (today.getTime() - reviewed) / DAY;
}

export function computeStale(pages, { today = new Date() } = {}) {
  const buckets = { fresh: [], aging: [], stale: [], rotten: [] };
  const missingReview = [];
  for (const p of pages) {
    const age = ageDays(p, today);
    if (!Number.isFinite(age)) missingReview.push(p.path);
    const withAge = { ...p, ageDays: age };
    if (age < THRESHOLDS.fresh) buckets.fresh.push(withAge);
    else if (age < THRESHOLDS.aging) buckets.aging.push(withAge);
    else if (age < THRESHOLDS.stale) buckets.stale.push(withAge);
    else buckets.rotten.push(withAge);
  }
  const report =
    `Freshness: fresh ${buckets.fresh.length} · aging ${buckets.aging.length} · ` +
    `stale ${buckets.stale.length} · rotten ${buckets.rotten.length} · missing review ${missingReview.length}`;
  return { buckets, report, missingReview };
}

function filesystemPages(vaultPath) {
  const root = resolve(vaultPath);
  const wiki = join(root, 'wiki');
  const pages = [];
  try {
    if (!statSync(root).isDirectory() || !statSync(wiki).isDirectory()) throw new Error('expected a vault directory containing wiki/');
    const walk = (folder, relative) => {
      for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        // Do not follow symlinks or traverse excluded material, even if nested.
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === '_templates') continue;
        const path = `${relative}/${entry.name}`;
        if (entry.isDirectory()) walk(join(folder, entry.name), path);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const { metadata } = parseNote(readFileSync(join(folder, entry.name), 'utf8'));
          pages.push({ path, reviewed: metadata.reviewed, updated: metadata.updated, type: metadata.type });
        }
      }
    };
    walk(wiki, 'wiki');
    return pages;
  } catch (err) {
    throw new Error(`Freshness unavailable: cannot read vault wiki metadata at ${wiki}: ${err.message}`, { cause: err });
  }
}

function cliPages(rows) {
  if (!Array.isArray(rows)) throw new Error('invalid stale.base rows: expected an array');
  if (!rows.length) throw new Error('empty stale.base result; checking wiki files before reporting emptiness');
  return rows.map(row => {
    const path = row?.['file.path'] ?? row?.path ?? row?.file;
    if (typeof path !== 'string' || !path.startsWith('wiki/') || !path.toLowerCase().endsWith('.md') || path.split('/').some(part => !part || part.startsWith('.') || part === '_templates')) {
      throw new Error('invalid stale.base row: expected a wiki-relative Markdown path');
    }
    return { path, reviewed: row.reviewed, updated: row.updated, type: row.type };
  });
}

// Prefer the native dashboard. A failed or empty query is independently checked
// against only wiki/ metadata at the resolved root; this report never writes.
export function main({ vaultPath, today = new Date(), obsidianJsonImpl = obsidianJson, log = console.log } = {}) {
  const vault = resolveVault();
  const root = vaultPath ?? vault.path;
  let pages, backend = 'obsidian', reason = null;
  try {
    const pathIdentity = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if (pathIdentity(root) !== pathIdentity(vault.path)) {
      throw new Error('registered Obsidian vault name is unknown for this alternate root; reading its wiki files directly');
    }
    pages = cliPages(obsidianJsonImpl(['base:query', 'file=stale.base', 'view=all'], { name: vault.name }));
  } catch (err) {
    backend = 'filesystem';
    reason = err.message;
    pages = filesystemPages(root);
  }
  const r = { ...computeStale(pages, { today }), backend, reason };
  if (!pages.length) r.report += ' · no wiki pages found';
  log(`Freshness backend: ${backend}${reason ? ` (${reason})` : ''}`);
  log(r.report);
  for (const p of [...r.buckets.stale, ...r.buckets.rotten]) {
    log(`  ${Number.isFinite(p.ageDays) ? `${Math.round(p.ageDays)}d` : 'missing review'}  ${p.path}`);
  }
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
