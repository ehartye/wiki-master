import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isGitRepo, statusPorcelain } from './lib/git.mjs';
import { dirtySet } from './lib/op.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// The status snapshot is lib/git.mjs `statusPorcelain`: core.quotePath=false keeps non-ASCII bytes literal (dirtySet only
// strips the surrounding quote pair, it does not decode octal escapes), and --untracked-files=all lists the files inside an
// untracked directory, which the delta that becomes commitPaths' pathspec list needs. Reproduced against a fresh untracked
// `wiki/` dir with two new files: commitPaths reported "nothing to commit" while real files stayed staged.

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
