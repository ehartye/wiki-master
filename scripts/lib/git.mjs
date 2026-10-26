import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The single place wiki-master touches git. Deliberately narrow: stage, commit,
// push, and the fetch and rebase wiki-sync needs to move commits between machines.
// No force, no history rewriting, no branch switching, no merge conflict
// resolution (a conflicting rebase is aborted and reported) — a vault is a user's knowledge base, and an automated tool that
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
//
// A result is one of three things, and callers must not conflate them: committed;
// a legitimate empty delta (`reason` only: 'nothing to commit' or 'not a git
// repository'); or a git failure (`failed: true`, `reason` is git's stderr): a held
// index.lock, a rejecting hook, a permissions error. Reading the third as the second
// made op-commit report "made no changes" and delete its token while the
// operation's files sat uncommitted (0.41.1, observed twice).
export function commitPaths(cwd, paths, message, { verify } = {}) {
  if (!isGitRepo(cwd)) return { committed: false, reason: 'not a git repository' };
  if (!paths.length) return { committed: false, reason: 'nothing to commit' };

  // git add --pathspec-from-file fails ATOMICALLY: one unmatched path and nothing
  // stages at all. A purged file that was never committed is neither on disk (it
  // moved) nor tracked, so listing it would sink the whole commit and leave the
  // vault with files moved and nothing recorded — the exact failure this module
  // exists to prevent. This is not a rare case: with obsidian-git auto-commit
  // disabled, an untracked clipping or log entry is normal vault state, and
  // purging that topic before the next sync hits it. Keep only what git can
  // stage: still on disk, or tracked so its deletion can be staged.
  let tracked;
  try {
    tracked = new Set(git(cwd, ['ls-files', '-z']).split('\0').filter(Boolean));
  } catch (err) {
    return { committed: false, failed: true, reason: stderrOf(err) };
  }
  const stageable = paths.filter((p) => tracked.has(p) || existsSync(join(cwd, p)));
  if (!stageable.length) return { committed: false, reason: 'nothing to commit' };

  const input = stageable.join('\0');

  try {
    git(cwd, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input });
  } catch (err) {
    return { committed: false, failed: true, reason: stderrOf(err) };
  }

  // "Did any of OUR paths end up staged?" — not "is the index non-empty?".
  // `git diff` doesn't support --pathspec-from-file, so the scoping has to
  // happen in JS: list everything staged (`-z`, NUL-delimited, which also
  // sidesteps quoting entirely regardless of core.quotePath) and intersect it
  // with `stageable`. This is what makes purging nothing, with unrelated work
  // already pre-staged, report {committed:false} instead of committing the
  // user's pre-staged work under a "purge:" message.
  let staged;
  try {
    const out = git(cwd, ['diff', '--cached', '--name-only', '-z']);
    staged = new Set(out.split('\0').filter(Boolean));
  } catch (err) {
    return { committed: false, failed: true, reason: stderrOf(err) };
  }
  if (!stageable.some((p) => staged.has(p))) {
    return { committed: false, reason: 'nothing to commit' };
  }

  // A caller that must certify the bytes it commits (evidence-bytes.mjs) checks the staged state here,
  // after git's own conversions have run and before anything is committed. A refusal unstages exactly
  // the paths this call staged, so the index is left as it was.
  if (verify) {
    const check = verify();
    if (!check.ok) {
      try { git(cwd, ['reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], { input }); } catch { /* the refusal is what matters */ }
      return { committed: false, failed: true, refused: true, reason: check.reason, evidence: check };
    }
  }

  try {
    const commitArgs = ['commit', '-q', '-m', message, '--pathspec-from-file=-', '--pathspec-file-nul'];
    git(cwd, commitArgs, { input });
  } catch (err) {
    return { committed: false, failed: true, reason: stderrOf(err) };
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

// --- Sync primitives (wiki-sync.mjs) -----------------------------------------
//
// The plugin owns the vault's git (decision recorded in the wiki-master vault:
// obsidian-git's auto-commit raced scoped operation commits, and three machines
// share one remote). Syncing is fetch, rebase onto the upstream, push. Still no
// force, no merge commits, no conflict resolution: a conflict aborts the rebase
// and is reported, because the right resolution of two machines' edits to one
// page is a human's or an agent's judgement, not a script's.

// Where git keeps rebase state is not always `.git/` (worktrees, submodules), so
// ask git rather than building the path.
export function rebaseInProgress(cwd) {
  return ['rebase-merge', 'rebase-apply'].some((name) => {
    try {
      return existsSync(resolve(cwd, git(cwd, ['rev-parse', '--git-path', name])));
    } catch {
      return false;
    }
  });
}

export function upstreamOf(cwd) {
  try {
    return git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) || null;
  } catch {
    return null;
  }
}

export function fetchUpstream(cwd) {
  try {
    git(cwd, ['fetch', '-q']);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: stderrOf(err) };
  }
}

export function aheadBehind(cwd) {
  const [ahead, behind] = git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']).split(/\s+/).map(Number);
  return { ahead, behind };
}

// Everything dirty in the working tree. `-z` removes quoting entirely and
// `--no-renames` keeps a staged rename as two plain paths, so every entry is one
// path that can go straight back into commitPaths.
export function dirtyPaths(cwd) {
  return git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'])
    .split('\0').filter(Boolean).map((entry) => entry.slice(3));
}

// Files the upstream changed since the merge base. An uncommitted edit to one of
// these is what a rebase's autostash cannot put back cleanly.
export function incomingFiles(cwd) {
  return git(cwd, ['diff', '--name-only', '-z', 'HEAD...@{u}']).split('\0').filter(Boolean);
}

export function rebaseOntoUpstream(cwd) {
  try {
    git(cwd, ['rebase', '--autostash', '@{u}']);
    return { ok: true };
  } catch (err) {
    let conflicts = [];
    try {
      conflicts = git(cwd, ['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean);
    } catch { /* the conflict list is a courtesy; the abort below is not */ }
    let aborted = false;
    try {
      git(cwd, ['rebase', '--abort']);
      aborted = true;
    } catch { /* reported below */ }
    return { ok: false, conflicts, aborted, reason: stderrOf(err) };
  }
}

// A rejected push means the remote moved after our fetch: the one case worth a
// second attempt. Anything else (auth, network, a hook) is reported as it is.
export function isPushRejection(reason = '') {
  return /rejected|non-fast-forward|fetch first|failed to update ref/i.test(reason);
}
