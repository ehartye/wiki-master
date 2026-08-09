import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isGitRepo } from './lib/git.mjs';
import { dirtySet } from './lib/op.mjs';

// Same flags scripts/lib/git.mjs's internal git() wrapper uses on every call:
// core.quotePath=false keeps non-ASCII bytes literal (dirtySet only strips the
// surrounding quote pair, it does not decode octal escapes); --literal-pathspecs
// is a no-op for `status` but kept for consistency with the rest of this codebase.
//
// --untracked-files=all is NOT cosmetic here: by default git collapses an
// entirely-untracked directory into one line (`?? wiki/`) instead of listing
// the files inside it. git.mjs's uncommittedElsewhere doesn't need this flag
// because it is display-only, but this snapshot feeds deltaPaths, whose
// output becomes commitPaths's pathspec list — `wiki/` as a literal path
// stages the directory's contents fine (git add honors the trailing slash)
// but then fails commitPaths's own "did OUR paths end up staged" check
// (`git diff --cached --name-only` lists the individual files, never the
// directory), which made commitPaths report "nothing to commit" while having
// silently left real files staged. Reproduced against a fresh untracked
// `wiki/` dir with two new files before this flag was added.
function statusPorcelain(cwd) {
  return execFileSync('git', ['-c', 'core.quotePath=false', '--literal-pathspecs', 'status', '--porcelain', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

// Snapshots what was ALREADY dirty before this operation starts, so op-commit
// can later exclude it from the operation's own commit — the property that
// makes this safe where `git add -A` is not. A vault that is not a git
// repository has nothing to snapshot; op-commit handles that case when it
// tries to commit, not here, so op-begin still succeeds and a skill can still
// bracket the operation.
export function beginOp(vaultPath, op) {
  const dirty = isGitRepo(vaultPath) ? [...dirtySet(statusPorcelain(vaultPath))] : [];
  const token = randomBytes(8).toString('hex');
  const opsDir = join(vaultPath, '.wiki-master', 'ops');
  mkdirSync(opsDir, { recursive: true });
  writeFileSync(
    join(opsDir, `${token}.json`),
    `${JSON.stringify({ op, startedAt: new Date().toISOString(), dirty }, null, 2)}\n`
  );
  return token;
}

export function main(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const op = get('--op');
  if (!op) {
    console.error('usage: node scripts/op-begin.mjs --op <op>');
    process.exitCode = 1;
    return;
  }
  const { path: vaultPath } = resolveVault();
  // Only the token on stdout — a skill captures it with $(...); anything else
  // printed here would get captured right along with it.
  console.log(beginOp(vaultPath, op));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
