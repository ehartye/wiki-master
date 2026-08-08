import { execFileSync } from 'node:child_process';

// The single place wiki-master touches git. Deliberately narrow: stage, commit,
// push. No force, no history rewriting, no branch switching, no merge conflict
// resolution — a vault is a user's knowledge base, and an automated tool that
// rewrites its history is a worse failure than the one this feature fixes.

// `-c core.quotePath=false` on every invocation: without it, git renders
// non-ASCII bytes (e.g. em-dashes) as octal escapes (\342\200\224) inside the
// quoted path, which `uncommittedElsewhere` would then have to decode. With it,
// git (at least on git-for-windows 2.55) still wraps such a path in a literal
// `"..."` pair, but the bytes inside are the real UTF-8 — so the only cleanup
// left is stripping that outer quote wrapper, not decoding escapes.
//
// `--literal-pathspecs` on every invocation: without it, pathspec magic and
// globs (`:(exclude)`, `:!`, `:/`, `*`, `[...]`) are honored in every path we
// pass. `[` is a legal NTFS filename character, so purging `Notes [draft].md`
// while the user edits an unrelated `Notes d.md` would otherwise sweep the
// unrelated edit in as a glob match. This runs on the user's other machines
// too, some of them POSIX, where the pathspec surface is wider still.
//
// Trims only trailing whitespace, never leading. `git status --porcelain`
// lines are fixed-width (`XY path`; a leading space in ` M path` means "not
// staged"); a plain .trim() would eat that leading space and shift every
// column left by one, corrupting the very output uncommittedElsewhere parses.
//
// maxBuffer matches the convention in scripts/lib/vault.mjs: `git status` on a
// large vault is the realistic way to overflow Node's default 1MB buffer.
function git(cwd, args, { input } = {}) {
  return execFileSync('git', ['-c', 'core.quotePath=false', '--literal-pathspecs', ...args], {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
  }).replace(/\s+$/, '');
}

function stderrOf(err) {
  return (err.stderr || err.message || '').toString().trim();
}

export function isGitRepo(cwd) {
  try {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

// Stages and commits ONLY the paths purge touched — never `git add -A`, and
// never a bare `git commit` (which commits the whole index regardless of what
// was just staged). A vault whose obsidian-git auto-commit is disabled
// accumulates unrelated edits — pre-staged as often as not — and either
// mistake would sweep those into a commit titled "purge: <topic>", both
// mislabelling the user's own work and making the purge non-atomic to revert,
// which is the recoverability the whole design rests on.
//
// Paths arrive NUL-delimited on stdin rather than as argv: a topic purge can
// move hundreds of files, and this vault has filenames carrying em-dashes and
// ampersands. --pathspec-file-nul sidesteps both the argv length ceiling and
// every delimiting question. Requires git 2.25+ (2020). `git commit` accepts
// the same flag, so the commit is scoped exactly like the add — this is what
// keeps pre-staged, unrelated work out of the purge commit.
//
// `git add` stages deletions as well as additions, which is essential here —
// half of what a purge stages is a MOVE: a deletion at the original path and
// an addition under .recycle/.
//
// Every git call here is wrapped: by the time this function runs, purge has
// already moved files on disk. A raw throw (e.g. a path that matches nothing,
// a .gitignore'd destination, `git commit` refusing an empty scoped diff)
// would leave the move done but uncommitted with no way for the caller to
// know — the exact working-tree-only state this feature exists to prevent,
// reached by crash instead of by bug.
export function commitPaths(cwd, paths, message) {
  if (!isGitRepo(cwd)) return { committed: false, reason: 'not a git repository' };
  if (!paths.length) return { committed: false, reason: 'nothing to commit' };

  const input = paths.join('\0');

  try {
    git(cwd, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input });
  } catch (err) {
    return { committed: false, reason: stderrOf(err) };
  }

  // "Did any of OUR paths end up staged?" — not "is the index non-empty?".
  // `git diff` doesn't support --pathspec-from-file, so the scoping has to
  // happen in JS: list everything staged (`-z`, NUL-delimited, which also
  // sidesteps quoting entirely regardless of core.quotePath) and intersect it
  // with `paths`. This is what makes purging nothing, with unrelated work
  // already pre-staged, report {committed:false} instead of committing the
  // user's pre-staged work under a "purge:" message.
  let staged;
  try {
    const out = git(cwd, ['diff', '--cached', '--name-only', '-z']);
    staged = new Set(out.split('\0').filter(Boolean));
  } catch (err) {
    return { committed: false, reason: stderrOf(err) };
  }
  if (!paths.some((p) => staged.has(p))) {
    return { committed: false, reason: 'nothing to commit' };
  }

  try {
    const commitArgs = ['commit', '-q', '-m', message, '--pathspec-from-file=-', '--pathspec-file-nul'];
    git(cwd, commitArgs, { input });
  } catch (err) {
    return { committed: false, reason: stderrOf(err) };
  }
  return { committed: true, sha: git(cwd, ['rev-parse', 'HEAD']) };
}

// What purge deliberately did NOT commit, so the CLI can say so rather than
// leaving the user to discover it. Silence would read as "the purge committed
// everything," exactly the wrong impression in a feature built because an
// uncommitted change failed to survive a sync.
//
// These are display strings, not paths: a rename comes back as one string
// `"old.md -> new.md"`, and an untracked directory comes back as
// `"untracked-dir/"`. Fine for showing the user what's outstanding; do not
// feed these into any path comparison or another git call.
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
    return { pushed: false, reason: stderrOf(err) };
  }
}
