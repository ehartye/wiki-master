import {
  readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BIN_DIR, binPathFor, planPurge, buildManifest, purgeId, planReconcile } from './lib/purge.mjs';
import { resolveVault, assertRunning } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { loadDeclines, recordDecline, removeDecline } from './lib/decline.mjs';
import { writeLogEntry } from './log-entry.mjs';
import { commitPaths, isGitRepo, uncommittedElsewhere } from './lib/git.mjs';
import { main as searchMain } from './search.mjs';

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
    // A vault page whose path happens to be exactly "manifest.json" would land
    // here — the bin's top level, same as the manifest itself. Windows
    // renameSync overwrites an existing destination file rather than erroring,
    // so without this the purge's own manifest is silently replaced: its
    // entries never re-bin on resurrection and its declines never replay,
    // permanently, with nothing to say so. Contrived, but the consequence is
    // total, so it is reported like any other unmoveable entry rather than
    // risked.
    if (to === `${BIN_DIR}/${manifest.id}/manifest.json`) {
      failed.push({ from: e.from, reason: 'destination would overwrite the purge manifest' });
      continue;
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

// ---- CLI ----

const MAX_SEEDS = 25;

// Seeds are wiki pages only, taken by RANK. A clipping joins through the closure
// — "every page citing it is already inside" — never through its own keyword
// score, or one shared source ranking well would drag out evidence another topic
// still needs.
//
// No score threshold, deliberately: search.mjs fuses its channels with RRF
// (mergeRRF, k=60), so a rank-1 hit scores ~1/61. Those numbers order results
// and mean nothing in absolute terms; thresholding them drops everything.
export async function collectSeeds(topic, { searchImpl = searchMain, maxSeeds = MAX_SEEDS, limit = 40 } = {}) {
  const { results = [] } = (await searchImpl(topic, { limit })) ?? {};
  return results
    .filter((h) => h.path.startsWith('wiki/'))
    .slice(0, maxSeeds)
    .map((h) => h.path);
}

function report(plan) {
  const layer = (p) => (p.startsWith('raw/') ? 'raw' : 'wiki');
  console.log(`\nPURGE PLAN — ${plan.purge.length} files\n`);
  for (const group of ['wiki', 'raw']) {
    const rows = plan.purge.filter((p) => layer(p) === group);
    if (!rows.length) continue;
    console.log(`  ${group}/ (${rows.length})`);
    for (const r of rows) console.log(`    ${r}`);
  }
  if (plan.collateral.length) {
    console.log(`\n  COLLATERAL — survive, but reference purged content (${plan.collateral.length}):`);
    for (const c of plan.collateral) console.log(`    ${c}`);
    console.log('  These need their references repaired after the move.');
  }
  if (plan.blocking.length) {
    console.log(`\n  BLOCKING — every source these cite is inside the purge set (${plan.blocking.length}):`);
    for (const b of plan.blocking) console.log(`    ${b}`);
    console.log('  A claim with no evidence is a defect (guardrail #2). Include them or keep their sources.');
  }
  // The full path list above stays — it is what a human decides from. But a
  // 300-file purge gate ends in a wall of paths with nothing to read at a
  // glance, so a summary line closes it out.
  const wiki = plan.purge.filter((p) => layer(p) === 'wiki').length;
  const raw = plan.purge.length - wiki;
  console.log(`\nPURGE: ${wiki} wiki, ${raw} raw, ${plan.collateral.length} collateral, ${plan.blocking.length} blocking`);
}

// applyPurge and assertRunning are injectable for the same reason searchImpl
// is: each guards a real-world condition — a failed move, a dead Obsidian
// CLI — that cannot be reproduced on demand from outside main(). See the
// `if (failed.length)` guard and the empty-seedPaths branch below for what
// each one tests. Splitting main into one function per mode was considered
// and rejected for this task: real refactor, but it would churn this DI
// seam for a benefit this task does not need.
export async function main(argv, {
  searchImpl = searchMain,
  applyPurge: applyPurgeFn = applyPurge,
  assertRunning: assertRunningFn = assertRunning,
} = {}) {
  const { path: vaultPath } = resolveVault();
  const mode = argv[0] ?? '--plan';
  const arg = argv.slice(1).join(' ').trim();

  if (mode === '--restore') {
    const { manifests } = readManifests(vaultPath);
    const manifest = manifests.find((m) => m.id === arg);
    if (!manifest) {
      console.error(`purge: no manifest with id "${arg}"`);
      process.exitCode = 1;
      return;
    }
    const r = applyRestore(vaultPath, manifest);
    console.log(`restored ${r.restored} file(s)`);
    for (const p of r.skipped) console.log(`  skipped (your newer work sits at that path): ${p}`);
    // A gap the manifest claims but the bin cannot supply, in neither the
    // primary slot nor any resurrected-N/. Never silent — an unqualified
    // "restored N" over an unrecoverable gap is the failure this reports.
    for (const p of r.missing) console.error(`  MISSING from the bin, not restored: ${p}`);
    if (r.missing.length) process.exitCode = 1;
    // The inverse of the decline this purge itself recorded on the way out —
    // without this, a restored source's URL stays declined for up to 180
    // days and /wiki-discover silently keeps skipping it. Scoped to exactly
    // this purge's own reason tag (see removeDecline's own comment): a
    // decline the user made independently, on the same URL, must survive.
    let clearedDeclines = 0;
    for (const url of manifest.declines ?? []) {
      clearedDeclines += removeDecline(vaultPath, url, `purged:${manifest.id}`);
    }
    if (clearedDeclines) console.log(`cleared ${clearedDeclines} decline(s) this purge recorded`);
    // A restore that is not committed is a working-tree-only change — the exact
    // state that caused the bug this feature exists to fix.
    if (r.touched.length && isGitRepo(vaultPath)) {
      const c = commitPaths(vaultPath, r.touched, `restore: ${manifest.topic ?? manifest.id} (${manifest.id})`);
      console.log(c.committed ? `committed ${c.sha.slice(0, 7)}` : `not committed: ${c.reason}`);
    }
    return;
  }

  if (mode === '--reconcile') {
    const { manifests, unreadable } = readManifests(vaultPath);
    for (const u of unreadable) console.error(`purge: UNREADABLE manifest ${u} — its files will never re-bin and its declines will never replay`);
    const pages = buildGraph(vaultPath).pages;
    const plan = planReconcile({ manifests, pages, declines: loadDeclines(vaultPath).map((d) => d.url) });
    // reconcile IS the recovery path a stalled --apply is told to run, so its
    // moves must land in a commit like any other — collect what every
    // applyPurge call actually touched, the same way --apply does.
    const touched = [];
    const ids = new Set();
    for (const r of plan.rebin) {
      // Only a HASH match needs forcing: a re-clip has a new filename, so it
      // never collides and would otherwise land at the bin's top level as though
      // the original purge had put it there. A PATH match must NOT be forced —
      // a genuine resurrection already has its slot occupied, so existsSync
      // diverts it correctly on its own, and the only time a path match sees a
      // FREE slot is recovery after a purge crashed partway.
      const res = applyPurge(vaultPath, { id: r.id, entries: [{ from: r.from }] },
                              { asResurrection: r.reason === 'source-hash' });
      touched.push(...res.touched);
      ids.add(r.id);
      console.log(`re-binned ${r.from} (matched by ${r.reason})`);
    }
    for (const url of plan.replayDeclines) recordDecline(vaultPath, url, 'purge-manifest-replay');
    console.log(`reconcile: ${plan.rebin.length} re-binned, ${plan.replayDeclines.length} decline(s) replayed`);
    if (touched.length && isGitRepo(vaultPath)) {
      // The crash reconcile recovers from is "writeManifest ran but the
      // process died before ever committing" — so manifest.json is exactly
      // as uncommitted as the files it describes. Stage it alongside the
      // moves for every id touched, or a "successful" reconcile still leaves
      // it stray on disk, untracked. Harmless to include when it was already
      // committed by a prior, unrelated purge: git stages no-op unchanged.
      const manifestPaths = [...ids].map((id) => `${BIN_DIR}/${id}/manifest.json`);
      const paths = [...new Set([...touched, ...manifestPaths])];
      const c = commitPaths(vaultPath, paths, `purge: reconcile re-binned ${plan.rebin.length} file(s)`);
      console.log(c.committed ? `committed ${c.sha.slice(0, 7)}` : `not committed: ${c.reason}`);
    }
    return;
  }

  if (!arg) {
    console.error('purge: a topic is required — node scripts/purge.mjs --plan "<topic>"');
    process.exitCode = 1;
    return;
  }

  const pages = enrichPages(vaultPath, buildGraph(vaultPath).pages);
  const seedPaths = await collectSeeds(arg, { searchImpl });
  if (!seedPaths.length) {
    // An empty result is indistinguishable from a dead Obsidian CLI unless
    // something checks: keywordSearch (search.mjs) swallows every backend
    // failure into [], while the semantic tier throws unhandled instead —
    // the same broken CLI produces opposite symptoms depending on whether
    // Ollama happens to be present too. Probe only now, lazily, the moment
    // an empty result is about to drive the decision "nothing to plan."
    try {
      assertRunningFn();
      console.log(`purge: search returned no wiki pages for "${arg}" — nothing to plan.`);
    } catch (err) {
      console.error(`purge: cannot trust this empty result — ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }
  console.log(`seeds (${seedPaths.length}):`);
  for (const s of seedPaths) console.log(`  ${s}`);
  const plan = planPurge({ pages, seedPaths });
  report(plan);

  if (mode !== '--apply') {
    console.log('\n(plan only — re-run with --apply to move these files)');
    return;
  }
  if (plan.blocking.length) {
    console.error('\npurge: refusing to apply while pages would be left with no provenance.');
    process.exitCode = 1;
    return;
  }
  // A stale search hit for a page already gone (e.g. re-running --apply
  // against a topic already purged) filters out in planPurge's own
  // known.has(p) check, so an empty purge set with nonempty seedPaths is a
  // real, reachable outcome — not hypothetical. Stop here, before
  // nextFreePurgeId: a manifest with zero entries is not a purge, and
  // writing one anyway commits a no-op under a "purge:" message while
  // whatever ACTUALLY needed attention (a real half-finished purge, if
  // that's why this ran) stays uncommitted and unmentioned.
  if (!plan.purge.length) {
    console.log('\npurge: the closure is empty — nothing to move. Not writing a manifest.');
    return;
  }

  const id = nextFreePurgeId(vaultPath, purgeId(arg));
  const hashes = Object.fromEntries(
    plan.purge.map((p) => [p, sha256(readFileSync(join(vaultPath, p), 'utf8'))])
  );
  const manifest = buildManifest({
    id, topic: arg, date: id.slice(0, 10),
    purge: plan.purge, collateral: plan.collateral, pages, hashes,
  });

  writeManifest(vaultPath, manifest);          // intent first — survives a crash mid-move
  const { moved, touched, failed } = applyPurgeFn(vaultPath, manifest);

  console.log(`\nmoved ${moved} file(s) to .recycle/${id}/`);
  // Windows locks a file against rename whenever any process holds a
  // FILE_SHARE_READ handle — antivirus mid-scan, the Search indexer, a sync
  // client. Measured, not theoretical. Report and stop here, before either
  // declines or the log entry below are written: both describe a move that,
  // for a failed entry, never actually happened.
  if (failed.length) {
    console.error(`\n${failed.length} file(s) could not be moved:`);
    for (const f of failed) console.error(`  ${f.from} — ${f.reason}`);
    console.error('Close whatever holds them open, then run --reconcile to finish this purge');
    console.error(`in place — it re-bins the stragglers into .recycle/${id}/ and commits.`);
    console.error('Do NOT re-run --apply: it starts a SECOND purge under a new id and');
    console.error('fragments this one across two manifests, so neither restores correctly.');
    process.exitCode = 1;
    return;
  }

  // Declines and the log entry are consequences of files having actually
  // moved, so they are recorded only once applyPurge reports zero failures.
  // The manifest (written above, before any of this) already carries the
  // declines for --reconcile to replay if a later crash strands things
  // anyway — nothing below is load-bearing for recovery.
  for (const url of manifest.declines) recordDecline(vaultPath, url, `purged:${id}`);
  const logPath = writeLogEntry({
    vaultPath, op: 'purge', title: arg,
    body: `Purged ${moved} file(s) to \`.recycle/${id}/\`.\n\n` +
          (manifest.collateral.length ? `Collateral needing reference repair:\n${manifest.collateral.map((c) => `- [[${c}]]`).join('\n')}\n` : ''),
  });

  if (manifest.collateral.length) {
    console.log('NEXT: repair references on the collateral pages, then run node scripts/index-gen.mjs');
  }
  if (isGitRepo(vaultPath)) {
    // Exactly what this purge touched, and nothing else. index.md is listed
    // even though index-gen.mjs (the skill's job, not this script's) only
    // regenerates it AFTER this commit — it is byte-identical to what's
    // already committed at the moment this runs, so including it now is a
    // no-op that saves a second commit once it later changes, not evidence
    // this script keeps it in sync itself. The log entry is the audit record
    // of this purge. `.wiki-master/declined.json` is deliberately absent —
    // it is gitignored and does not sync, which is precisely why the
    // manifest carries declines for reconcile to replay.
    const paths = [...new Set([...touched, `${BIN_DIR}/${id}/manifest.json`, 'index.md', logPath])];
    const c = commitPaths(vaultPath, paths, `purge: ${arg} (${id})`);
    console.log(c.committed ? `committed ${c.sha.slice(0, 7)}` : `not committed: ${c.reason}`);
    // .wiki-master/ is where this very purge just wrote declined.json (and
    // where the search embedding cache lives) — gitignored on a vault that
    // has a .gitignore entry for it, but not every vault does. Filtered
    // explicitly rather than trusted to .gitignore, or a vault without one
    // has purge report its own just-written declined.json back to the user
    // as "your work."
    const others = uncommittedElsewhere(vaultPath).filter((o) => !o.startsWith('.wiki-master/'));
    if (others.length) {
      console.log(`\n${others.length} other file(s) in the vault have uncommitted changes. Purge did NOT`);
      console.log('commit them — they are your work, not part of this purge:');
      for (const o of others.slice(0, 10)) console.log(`  ${o}`);
      if (others.length > 10) console.log(`  … and ${others.length - 10} more`);
    }
    console.log('\nRun `git push` from the vault (or ask the skill to) to make this purge visible to your other machines.');
  } else {
    console.log('WARNING: this vault is not a git repository — the purge is local to this machine only.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
