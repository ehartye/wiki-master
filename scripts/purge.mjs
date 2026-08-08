import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { BIN_DIR, binPathFor } from './lib/purge.mjs';

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// buildGraph reads the frontmatter keys the graph needs; `source:` is not one of
// them. The manifest records a decline per purged clipping, which needs the URL,
// so read it here rather than widening the graph for one consumer.
export function enrichPages(vaultPath, pages) {
  return pages.map((p) => {
    if (!p.path.startsWith('raw/') || !p.path.endsWith('.md')) return p;
    try {
      const head = readFileSync(join(vaultPath, p.path), 'utf8').slice(0, 2000);
      const url = head.match(/^source:\s*"?(\S+?)"?\s*$/m)?.[1];
      return url ? { ...p, url } : p;
    } catch {
      return p;
    }
  });
}

function moveInto(vaultPath, from, to) {
  const dest = join(vaultPath, to);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(join(vaultPath, from), dest);
}

// Moves every manifest entry into the bin. Re-running is safe and is how
// reconcile re-bins a resurrection: when the bin slot is taken, the returning
// copy parks in resurrected-N so the original capture is never overwritten.
export function applyPurge(vaultPath, manifest, { asResurrection = false } = {}) {
  let moved = 0;
  const touched = [];
  for (const e of manifest.entries) {
    const src = join(vaultPath, e.from);
    if (!existsSync(src)) continue;
    let to = binPathFor(manifest.id, e.from);
    // asResurrection matters for the HASH-matched case: a re-clip under a new
    // filename never collides, so without the flag it lands at the bin's top
    // level, indistinguishable from a file the original purge moved there and
    // absent from that folder's manifest.json.
    if (asResurrection || existsSync(join(vaultPath, to))) {
      let n = 1;
      while (existsSync(join(vaultPath, `${BIN_DIR}/${manifest.id}/resurrected-${n}/${e.from}`))) n += 1;
      to = `${BIN_DIR}/${manifest.id}/resurrected-${n}/${e.from}`;
    }
    moveInto(vaultPath, e.from, to);
    moved += 1;
    // Both sides of every move, so the caller can stage exactly what changed.
    // The destination is only known here, so returning it is what lets the CLI
    // avoid `git add -A` and its habit of sweeping up the user's own work.
    touched.push(e.from, to);
  }
  return { moved, touched };
}

// The inverse. A file that exists at the original path is NEVER overwritten —
// it is newer work someone did after the purge, and silently clobbering it would
// make restore the destructive operation purge was designed not to be.
export function applyRestore(vaultPath, manifest) {
  let restored = 0;
  const skipped = [];
  for (const e of manifest.entries) {
    const from = binPathFor(manifest.id, e.from);
    if (!existsSync(join(vaultPath, from))) continue;
    if (existsSync(join(vaultPath, e.from))) {
      skipped.push(e.from);
      continue;
    }
    moveInto(vaultPath, from, e.from);
    restored += 1;
  }
  return { restored, skipped };
}

// Sorted, for the same reason planPurge sorts its pages. planReconcile shares
// one `seen` set across manifests, so when two manifests list the same path the
// one iterated FIRST claims it, and the resurrected copy is filed under that
// purge's id. Left to readdirSync that is filesystem order, so two machines
// would bin the same file under different ids. Ids are date-prefixed, so sorting
// makes the earliest purge win identically everywhere.
export function readManifests(vaultPath) {
  const binRoot = join(vaultPath, BIN_DIR);
  if (!existsSync(binRoot)) return [];
  const out = [];
  for (const id of readdirSync(binRoot).sort()) {
    if (!statSync(join(binRoot, id)).isDirectory()) continue;
    const f = join(binRoot, id, 'manifest.json');
    if (!existsSync(f)) continue;
    try {
      out.push(JSON.parse(readFileSync(f, 'utf8')));
    } catch {
      console.error(`purge: skipping unreadable manifest ${BIN_DIR}/${id}/manifest.json`);
    }
  }
  return out;
}

export function writeManifest(vaultPath, manifest) {
  const dir = join(vaultPath, BIN_DIR, manifest.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

// purgeId slugifies free text, so "AI safety", "AI-safety" and "ai_safety" all
// yield the same id on the same day — and an all-punctuation or all-non-ASCII
// topic yields the bare `<date>-purge` fallback. Two such purges sharing a
// folder is silent data loss: writeManifest would overwrite the first manifest,
// and applyPurge's per-file guard would file the second purge's files under
// resurrected-<n>/ inside the first purge's folder. A lost manifest costs
// exactly what manifests are for — its entries never re-bin on resurrection and
// its declines never replay.
//
// Never reuse an occupied id, even for the same topic: a second purge of one
// topic is still a second purge with its own entries. id.slice(0, 10) still
// yields the date with a suffix attached.
export function claimPurgeId(vaultPath, id) {
  let candidate = id;
  let n = 2;
  while (existsSync(join(vaultPath, BIN_DIR, candidate))) candidate = `${id}-${n++}`;
  return candidate;
}
