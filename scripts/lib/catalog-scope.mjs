import { execFileSync } from 'node:child_process';

// What a ledger-scoped catalog refresh may publish. A page counts when it is in the last commit or the
// ownership ledger names it: a page another writer has only staged is not committed work, and `git ls-files`
// lists it. A repository with no commit yet has no last commit, so what is tracked stands in for it.
export function committedPaths(vaultPath) {
  const list = (args) => new Set(execFileSync('git', args, {
    cwd: vaultPath, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }).split('\0').filter(Boolean));
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: vaultPath, stdio: 'ignore' });
  } catch {
    return list(['ls-files', '-z']);
  }
  // NUL delimiters preserve spaces, Unicode and literal pathspec characters.
  return list(['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
}

// Splits a graph for an operation that owns `ownedPaths`: the pages a catalog may list (committed, or named by
// the ledger) and the rest, which belong to someone else's unfinished work.
export function scopeGraph(vaultPath, graph, ownedPaths) {
  const committed = committedPaths(vaultPath);
  const owned = new Set(ownedPaths);
  const listed = (p) => committed.has(p.path) || owned.has(p.path);
  return { graph: { ...graph, pages: graph.pages.filter(listed) }, excluded: graph.pages.filter((p) => !listed(p)) };
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
