import { readFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isGitRepo, commitPaths } from './lib/git.mjs';
import { dirtySet, deltaPaths } from './lib/op.mjs';

// See op-begin.mjs for why --untracked-files=all is load-bearing, not cosmetic.
function statusPorcelain(cwd) {
  return execFileSync('git', ['-c', 'core.quotePath=false', '--literal-pathspecs', 'status', '--porcelain', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

// How many local commits have not reached the upstream, so the gap between
// "committed" and "durable on other machines" stays visible without this
// script acting on it. Never pushes — same rule as purge: pushing is
// outward-facing and belongs to an explicit confirmation step, not a script
// that could run unattended. No upstream configured is tolerated, not an
// error: a freshly cloned or local-only vault has none.
function unpushedCount(cwd) {
  try {
    const out = execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd, encoding: 'utf8' }).trim();
    return Number(out);
  } catch {
    return null;
  }
}

// Reads the token op-begin wrote, computes what THIS operation touched (dirty
// now minus dirty then), commits exactly that, and deletes the token whether
// or not there was anything to commit — an op that ran and found nothing to
// do, or ran against a vault that isn't a git repo, still finished; it should
// not leave scratch state behind for the next run to trip over.
export function commitOp(vaultPath, { op, title, token }) {
  const tokenPath = join(vaultPath, '.wiki-master', 'ops', `${token}.json`);
  let record;
  try {
    record = JSON.parse(readFileSync(tokenPath, 'utf8'));
  } catch {
    // Covers both a missing token (readFileSync throws) and a corrupt one
    // (JSON.parse throws) — an unbracketed op must not look successful, so
    // both end up here rather than one silently producing an empty commit.
    return { ok: false, reason: `no such operation token "${token}" — was op-begin run first?` };
  }
  const before = new Set(record.dirty ?? []);

  let outcome;
  if (!isGitRepo(vaultPath)) {
    outcome = {
      ok: true, committed: false, reason: 'not a git repository',
      paths: [], before: [...before].sort(), unpushed: null,
    };
  } else {
    const after = dirtySet(statusPorcelain(vaultPath));
    const paths = deltaPaths(before, after);
    // No `if (paths.length)` guard here, deliberately: commitPaths already
    // returns { committed: false, reason: 'nothing to commit' } on an empty
    // array before it runs a single git command (lib/git.mjs), so a local
    // copy of that check would be untested dead weight, not a second layer
    // of defense — confirmed by mutation testing, not assumed.
    const result = commitPaths(vaultPath, paths, `${op}: ${title}`);
    outcome = {
      ok: true,
      committed: result.committed,
      sha: result.sha,
      reason: result.reason,
      paths,
      before: [...before].sort(),
      unpushed: result.committed ? unpushedCount(vaultPath) : null,
    };
  }
  unlinkSync(tokenPath);
  return outcome;
}

export function main(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const op = get('--op');
  const title = get('--title');
  const token = get('--since');
  if (!op || !title || !token) {
    console.error('usage: node scripts/op-commit.mjs --op <op> --title "<title>" --since <token>');
    process.exitCode = 1;
    return;
  }
  const { path: vaultPath } = resolveVault();
  const r = commitOp(vaultPath, { op, title, token });

  if (!r.ok) {
    console.error(`op-commit: ${r.reason}`);
    process.exitCode = 1;
    return;
  }
  if (r.reason === 'not a git repository') {
    console.log('op-commit: this vault is not a git repository — nothing to commit.');
    return;
  }
  if (r.committed) {
    console.log(`committed ${r.sha.slice(0, 7)}: ${r.paths.length} file(s)`);
    for (const p of r.paths) console.log(`  ${p}`);
  } else {
    console.log(`op-commit: "${op}" made no changes — nothing to commit.`);
  }
  if (r.before.length) {
    console.log(`left alone (already dirty before this operation, not part of it): ${r.before.length} file(s)`);
    for (const p of r.before) console.log(`  ${p}`);
  }
  if (typeof r.unpushed === 'number' && r.unpushed > 0) {
    console.log(`${r.unpushed} commit(s) unpushed. Run \`git push\` from the vault to sync.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
