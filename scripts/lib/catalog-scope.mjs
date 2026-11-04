import { execFileSync } from 'node:child_process';
import { markdownPage } from './graph.mjs';

const git = (vaultPath, args, options = {}) => execFileSync('git', args, {
  cwd: vaultPath, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options,
});

function headOf(vaultPath) {
  try { return git(vaultPath, ['rev-parse', '--verify', '--quiet', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch (error) {
    // Only an unborn branch permits the legacy tracked-working-files fallback.
    // A corrupt/detached/unreadable HEAD must not publish foreign working bytes.
    if (error.status !== 1) throw error;
    const ref = git(vaultPath, ['symbolic-ref', '--quiet', 'HEAD'], { encoding: 'utf8' }).trim();
    try { git(vaultPath, ['show-ref', '--verify', '--quiet', ref]); }
    catch (missing) { if (missing.status === 1) return null; throw missing; }
    throw error;
  }
}

// Object IDs pin every read to the same commit. Batch by blob ID, not pathname:
// spaces, newlines, Unicode and Git pathspec characters remain literal.
function committedMarkdown(vaultPath, head, paths) {
  const entries = git(vaultPath, ['ls-tree', '-r', '-l', '-z', head], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const objects = entries.flatMap(entry => {
    const tab = entry.indexOf('\t');
    const [mode, type, oid, size] = entry.slice(0, tab).trim().split(/\s+/);
    const path = entry.slice(tab + 1);
    return paths.has(path) && type === 'blob' && mode !== '120000' ? [{ path, oid, size: Number(size) }] : [];
  });
  const texts = new Map();
  if (!objects.length) return texts;
  // Bound each response by bytes, not page count: large raw clippings should
  // not make an otherwise ordinary catalog exceed one process output limit.
  const batches = [];
  let batch = [], bytes = 0;
  for (const object of objects) {
    if (batch.length && bytes + object.size > 16 * 1024 * 1024) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(object); bytes += object.size;
  }
  if (batch.length) batches.push(batch);
  for (const batch of batches) {
    const output = git(vaultPath, ['cat-file', '--batch'], {
      input: batch.map(o => o.oid).join('\n') + '\n',
      maxBuffer: Math.max(64 * 1024 * 1024, batch.reduce((sum, o) => sum + o.size + 128, 0)),
    });
    let offset = 0;
    for (const { path, oid } of batch) {
      const end = output.indexOf(10, offset);
      const [actual, type, sizeText] = output.subarray(offset, end).toString('ascii').split(' ');
      const size = Number(sizeText);
      if (end < 0 || actual !== oid || type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || end + size + 1 >= output.length) {
        throw new Error(`cannot read committed catalog page: ${path}`);
      }
      texts.set(path, output.subarray(end + 1, end + 1 + size).toString('utf8'));
      offset = end + size + 2;
    }
  }
  return texts;
}

// What a ledger-scoped catalog refresh may publish. A page counts when it is in the last commit or the
// ownership ledger names it: a page another writer has only staged is not committed work, and `git ls-files`
// lists it. A repository with no commit yet has no last commit, so what is tracked stands in for it.
export function committedPaths(vaultPath, head = headOf(vaultPath)) {
  const list = (args) => new Set(execFileSync('git', args, {
    cwd: vaultPath, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).split('\0').filter(Boolean));
  if (head === null) {
    return list(['ls-files', '-z']);
  }
  // NUL delimiters preserve spaces, Unicode and literal pathspec characters.
  return list(['ls-tree', '-r', '-z', '--name-only', head]);
}

// Splits a graph for an operation that owns `ownedPaths`: the pages a catalog may list (committed, or named by
// the ledger) and the rest, which belong to someone else's unfinished work.
export function scopeGraph(vaultPath, graph, ownedPaths) {
  const head = headOf(vaultPath);
  const committed = committedPaths(vaultPath, head);
  const owned = new Set(ownedPaths);
  const listed = (p) => committed.has(p.path) || owned.has(p.path);
  const pages = graph.pages.filter(listed);
  const foreign = new Set(pages.filter(p => committed.has(p.path) && !owned.has(p.path) && p.path.endsWith('.md')).map(p => p.path));
  const texts = head === null ? new Map() : committedMarkdown(vaultPath, head, foreign);
  // Start from existing paths, so a deletion or rename is not silently resurrected.
  // Never fall back to working bytes when a committed snapshot cannot be read.
  if (head !== null) for (const path of foreign) {
    if (!texts.has(path)) throw new Error(`cannot read committed catalog page: ${path}`);
  }
  return {
    graph: { ...graph, pages: pages.map(p => texts.has(p.path)
      ? { ...markdownPage(p.path, texts.get(p.path)), catalogMarkdown: texts.get(p.path) } : p) },
    excluded: graph.pages.filter(p => !listed(p)),
    snapshot: { policy: head === null ? 'tracked-working-tree-no-head' : 'owned-working-tree-foreign-head', head },
  };
}

const FENCE =/%% BEGIN GENERATED CATALOG[^\n]*%%([\s\S]*?)%% END GENERATED CATALOG %%/;
const baseName = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '').toLowerCase();

// The link targets inside the generated fence of a catalog file, lower-cased, without alias or `.md`.
export function mentionedTargets(text) {
  const targets = new Set();
  const fence = text.match(FENCE)?.[1];
  if (fence === undefined) return targets;
  for (const m of fence.matchAll(/\[\[([^\]|#]+)/g)) targets.add(m[1].trim().replace(/\.md$/i, '').toLowerCase());
  return targets;
}

// The pages a scoped refresh left out that this catalog already lists. A refresh regenerates the fence from
// the pages it was allowed to see, so without this it would delete the line another writer's own catalog run
// put in the working copy. The page must still exist (it is in `excluded`, which comes from the files on
// disk), so a line for a page that is really gone is still removed. A bare name keeps a page only when no
// other page has that name, since the line may refer to the other page.
export function keptByMention(excluded, allPages, catalogText) {
  const targets = mentionedTargets(catalogText);
  if (!targets.size) return [];
  const count = new Map();
  for (const p of allPages) count.set(baseName(p.path), (count.get(baseName(p.path)) ?? 0) + 1);
  return excluded.filter((p) => {
    if (targets.has(p.path.replace(/\.md$/i, '').toLowerCase())) return true;
    const name = baseName(p.path);
    return targets.has(name) && count.get(name) === 1;
  });
}
