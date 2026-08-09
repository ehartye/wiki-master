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
//
// Scoped to the frontmatter block (graph.mjs:69's idiom), not a raw slice of the
// file: a slice risks matching a `source:`-shaped line the clipped BODY happens
// to contain (an article's own prose can read "source: ..."), and a fixed
// character count is a magic number that silently stops working on a long
// frontmatter block. Neither failure occurs in the live vault today, but
// scoping to the actual frontmatter removes the risk instead of relying on that.
//
// The value regex is unified with clip.mjs's knownSourceUrls (scripts/clip.mjs)
// — the other place this repo parses `source:` — so the two never drift back
// out of sync. `[^"\r\n]+?` (not `\S+?`) tolerates a value containing spaces,
// which `\S+?` cannot match at all: a local path like `My Documents\paper.pdf`
// silently produced no match under the old pattern.
//
// Only an http(s) value is recorded as a url: `source:` on a clipping is not
// always a URL — a local file clipped by path (docx/pdf) carries its
// filesystem path there instead, and letting that flow into `p.url` means it
// eventually lands in manifest.declines, a git-tracked, cross-machine-synced
// file, exposing one machine's local directory layout (and, worse, replaying
// as a "decline" on every other machine that reconciles the manifest).
export function enrichPages(vaultPath, pages) {
  return pages.map((p) => {
    if (!p.path.startsWith('raw/') || !p.path.endsWith('.md')) return p;
    try {
      const text = readFileSync(join(vaultPath, p.path), 'utf8');
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)?.[1] ?? '';
      const url = fm.match(/^source:\s*"?([^"\r\n]+?)"?\s*$/m)?.[1];
      return url && /^https?:/.test(url) ? { ...p, url } : p;
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
  const failed = [];
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
    // A locked file (antivirus, the Windows Search indexer, a sync client
    // holding a read-only handle) fails exactly this rename — confirmed on
    // Windows via a FILE_SHARE_READ-only handle — while leaving the source in
    // place: mkdirSync runs first, so a failure here is never a half-made
    // destination directory. Isolating the failure per entry is what turns
    // "one locked file in a 100-file purge" into a reportable retry instead of
    // an uncaught throw that aborts the whole batch mid-loop, uncommitted —
    // the exact stranded state this feature exists to prevent.
    try {
      moveInto(vaultPath, e.from, to);
    } catch (err) {
      failed.push({ from: e.from, reason: err.message });
      continue;
    }
    moved += 1;
    // Both sides of every move, so the caller can stage exactly what changed.
    // The destination is only known here, so returning it is what lets the CLI
    // avoid `git add -A` and its habit of sweeping up the user's own work.
    touched.push(e.from, to);
  }
  return { moved, touched, failed };
}

// The inverse. A file that exists at the original path is NEVER overwritten —
// it is newer work someone did after the purge, and silently clobbering it would
// make restore the destructive operation purge was designed not to be.
export function applyRestore(vaultPath, manifest) {
  let restored = 0;
  const skipped = [];
  const missing = [];
  const touched = [];
  for (const e of manifest.entries) {
    let from = binPathFor(manifest.id, e.from);
    if (!existsSync(join(vaultPath, from))) {
      // The primary slot is empty. Rather than silently report nothing — the
      // gap that let a crash-mid-purge, once reconciled into resurrected-N/,
      // strand files behind an unqualified "restored 1" success message —
      // fall back to the newest resurrected-N/ copy so recovery is automatic.
      let n = 1;
      let latest = null;
      while (existsSync(join(vaultPath, `${BIN_DIR}/${manifest.id}/resurrected-${n}/${e.from}`))) {
        latest = `${BIN_DIR}/${manifest.id}/resurrected-${n}/${e.from}`;
        n += 1;
      }
      if (!latest) {
        missing.push(e.from);
        continue;
      }
      from = latest;
    }
    if (existsSync(join(vaultPath, e.from))) {
      skipped.push(e.from);
      continue;
    }
    moveInto(vaultPath, from, e.from);
    restored += 1;
    // Same reasoning as applyPurge.touched: the CLI stages exactly what a
    // restore touched, never `git add -A`. Only entries actually moved are
    // included — a skipped entry's original path is the user's own newer
    // work and must never be staged under a "restore:" commit message.
    touched.push(from, e.from);
  }
  return { restored, skipped, missing, touched };
}

// Sorted, for the same reason planPurge sorts its pages. planReconcile shares
// one `seen` set across manifests, so when two manifests list the same path the
// one iterated FIRST claims it, and the resurrected copy is filed under that
// purge's id. Left to readdirSync that is filesystem order, so two machines
// would bin the same file under different ids. Ids are date-prefixed, so sorting
// makes the earliest purge win identically everywhere.
//
// Returns { manifests, unreadable } rather than a flat array: a corrupt
// manifest.json was previously indistinguishable from an absent one (both
// produced nothing), so its entries silently never re-bin on resurrection and
// its declines never replay — permanently, with reconcile still printing a
// cheerful "0 re-binned". unreadable makes the corrupt case visible to the
// caller instead of swallowing it.
export function readManifests(vaultPath) {
  const binRoot = join(vaultPath, BIN_DIR);
  if (!existsSync(binRoot)) return { manifests: [], unreadable: [] };
  const manifests = [];
  const unreadable = [];
  for (const id of readdirSync(binRoot).sort()) {
    // A dangling entry (removed mid-scan, a broken symlink) must not take the
    // whole reconcile down over one bin folder.
    let isDir;
    try {
      isDir = statSync(join(binRoot, id)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const f = join(binRoot, id, 'manifest.json');
    if (!existsSync(f)) continue;
    try {
      manifests.push(JSON.parse(readFileSync(f, 'utf8')));
    } catch {
      unreadable.push(`${BIN_DIR}/${id}/manifest.json`);
    }
  }
  return { manifests, unreadable };
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
//
// Named for what it does — finds the next free slot — not "claim" one: it
// makes no reservation. The caller must writeManifest immediately after
// calling this, before anything else can occupy the id it returned.
export function nextFreePurgeId(vaultPath, id) {
  let candidate = id;
  let n = 2;
  while (existsSync(join(vaultPath, BIN_DIR, candidate))) candidate = `${id}-${n++}`;
  return candidate;
}
