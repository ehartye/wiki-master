import { execFileSync } from 'node:child_process';

// The single place wiki-master touches git. Deliberately narrow: stage, commit,
// push. No force, no history rewriting, no branch switching, no merge conflict
// resolution — a vault is a user's knowledge base, and an automated tool that
// rewrites its history is a worse failure than the one this feature fixes.
//
// `-c core.quotePath=false` on every invocation: without it, git renders
// non-ASCII bytes (e.g. em-dashes) as octal escapes (\342\200\224) inside the
// quoted path, which `uncommittedElsewhere` would then have to decode. With it,
// git (at least on git-for-windows 2.55) still wraps such a path in a literal
// `"..."` pair, but the bytes inside are the real UTF-8 — so the only cleanup
// left is stripping that outer quote wrapper, not decoding escapes.
// Trims only trailing whitespace, never leading. `git status --porcelain`
// lines are fixed-width (`XY path`, e.g. a leading space in ` M path` means
// "not staged"); a plain .trim() would eat that leading space and shift every
// column left by one, corrupting the very output uncommittedElsewhere parses.
function git(cwd, args, { input } = {}) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', input }).replace(/\s+$/, '');
}

export function isGitRepo(cwd) {
  try {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

// Stages ONLY the paths purge touched — never `git add -A`. A vault whose
// obsidian-git auto-commit is disabled accumulates unrelated edits, and sweeping
// those into a commit titled "purge: <topic>" both mislabels the user's own work
// and makes the purge non-atomic to revert, which is the recoverability the whole
// design rests on.
//
// Paths arrive NUL-delimited on stdin rather than as argv: a topic purge can move
// hundreds of files, and this vault has filenames carrying em-dashes and quotes.
// --pathspec-file-nul sidesteps both the argv length ceiling and every quoting
// question. Requires git 2.25+ (2020).
//
// `git add` stages deletions as well as additions, which is essential here —
// half of what a purge stages is a MOVE: a deletion at the original path and an
// addition under .recycle/.
export function commitPaths(cwd, paths, message) {
  if (!isGitRepo(cwd)) return { committed: false, reason: 'not a git repository' };
  if (!paths.length) return { committed: false, reason: 'nothing to commit' };
  git(cwd, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: paths.join('\0') });
  if (git(cwd, ['diff', '--cached', '--name-only']) === '') {
    return { committed: false, reason: 'nothing to commit' };
  }
  git(cwd, ['commit', '-q', '-m', message]);
  return { committed: true, sha: git(cwd, ['rev-parse', 'HEAD']) };
}

// What purge deliberately did NOT commit, so the CLI can say so rather than
// leaving the user to discover it. Silence would read as "the purge committed
// everything," exactly the wrong impression in a feature built because an
// uncommitted change failed to survive a sync.
export function uncommittedElsewhere(cwd) {
  if (!isGitRepo(cwd)) return [];
  return git(cwd, ['status', '--porcelain'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"(.*)"$/, '$1'));
}

export function push(cwd) {
  if (!isGitRepo(cwd)) return { pushed: false, reason: 'not a git repository' };
  try {
    git(cwd, ['push']);
    return { pushed: true };
  } catch (err) {
    return { pushed: false, reason: (err.stderr || err.message || '').toString().trim() };
  }
}
