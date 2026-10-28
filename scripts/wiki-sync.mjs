import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import {
  isGitRepo, commitPaths, push, rebaseInProgress, upstreamOf, fetchUpstream,
  aheadBehind, dirtyPaths, incomingFiles, rebaseOntoUpstream, isPushRejection, indexLockAgeSeconds,
} from './lib/git.mjs';
import { obsidianGitAutoCommit } from './lib/obsidian-git.mjs';
import { listOperations, STALE_OPERATION_HOURS } from './lib/op-tokens.mjs';
import { notesDue } from './lib/sync-notes.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// Brings this machine's vault and the shared remote to the same state, or says
// precisely why it could not. The plugin owns the vault's git: operations commit
// their own scoped work (op-commit), and this is the one place that moves commits
// between machines. It exists because up to three machines share one remote and a
// bare `git push` from a skill was the only coordination there was.
//
// What it never does: force, merge, resolve a conflict, or touch a file it cannot
// attribute. A conflict aborts the rebase and is reported with the file names, and
// the local commits are still there afterwards.

// Git's stderr as one line for a report: its non-empty lines joined with " | ", at most 400 characters.
function oneLine(text = '') {
  const joined = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' | ');
  return joined.length > 400 ? `${joined.slice(0, 397)}...` : joined;
}

// `hooks.beforePush` runs before every push attempt. It exists so a test can move
// the remote between our fetch and our push, which is the race the retry is for. `hooks.rebaseImpl` replaces the rebase so a test can return a failure no real git run
// produces on demand (a started rebase whose abort failed).
export async function syncVault(vaultPath, { commitLocal = false, staleOperationHours = STALE_OPERATION_HOURS, hooks = {} } = {}) {
  if (!isGitRepo(vaultPath)) return { ok: true, skipped: 'not a git repository' };

  // Age is a cleanup hint, never proof that a paused operation stopped writing.
  // Every extant token blocks a sweep of unattributed hand edits.
  const operations = listOperations(vaultPath, { staleHours: staleOperationHours });
  const report = {
    pulled: 0, pushed: 0, retried: false, committedLocal: null, inSync: false,
    openOperations: operations.map((o) => o.token),
    staleOperations: operations.filter((o) => o.stale).map((o) => o.token),
    obsidianGit: obsidianGitAutoCommit(vaultPath),
  };
  const fail = (code, reason, extra = {}) => ({ ok: false, code, reason, ...report, ...extra });

  if (rebaseInProgress(vaultPath)) {
    return fail('rebase-in-progress', 'a rebase is already in progress in this vault; finish or abort it before syncing');
  }
  report.upstream = upstreamOf(vaultPath);
  if (!report.upstream) {
    return fail('no-upstream', 'the current branch has no upstream; set one with `git branch --set-upstream-to=origin/<branch>`');
  }

  if (commitLocal) {
    // Which dirty files belong to an operation that is still writing? Tokens record
    // what was dirty at open, not what the operation owns, so with one open there is
    // no safe answer, and committing someone's half-written page is the failure
    // this whole design exists to prevent.
    if (report.openOperations.length) {
      return fail('operation-open', `${report.openOperations.length} operation(s) are open (${report.openOperations.join(', ')}); close them with op-commit, or sync without --commit-local`);
    }
    const paths = dirtyPaths(vaultPath);
    if (paths.length) {
      const result = commitPaths(vaultPath, paths, `sync: local edits from ${hostname()}`);
      if (result.failed || !result.committed) {
        return fail('commit-failed', result.reason ?? 'git did not commit the local edits');
      }
      report.committedLocal = { sha: result.sha, paths };
    }
  }

  const integrate = () => {
    const fetched = fetchUpstream(vaultPath);
    if (!fetched.ok) return fail('fetch-failed', fetched.reason);
    const { behind } = aheadBehind(vaultPath);
    if (!behind) return null;
    const dirty = new Set(dirtyPaths(vaultPath));
    const overlap = incomingFiles(vaultPath).filter((p) => dirty.has(p)).sort();
    if (overlap.length) {
      return fail('overlap', `uncommitted edits overlap incoming changes in ${overlap.join(', ')}; commit them (or finish the operation) and sync again`, { overlap });
    }
    const rebased = (hooks.rebaseImpl ?? rebaseOntoUpstream)(vaultPath);
    if (!rebased.ok && rebased.started === false) {
      // The rebase never began (a held index lock, an autostash that could not snapshot): there are no conflict
      // files and nothing was aborted, so this is not the conflict recovery. A result without `started` is read
      // as a started rebase.
      const age = indexLockAgeSeconds(vaultPath);
      return fail('rebase-failed',
        `could not start the rebase onto ${report.upstream}; nothing was changed: ${oneLine(rebased.reason)}${age === null ? '' : ` (index.lock is ${age} s old)`}. `
        + 'If another process holds the index lock, wait for it to finish (never delete a Git lock) and run wiki-sync again',
        { phase: 'rebase', stderr: rebased.reason, lockAgeSeconds: age });
    }
    if (!rebased.ok) {
      return fail('conflict', `rebasing onto ${report.upstream} conflicts in ${rebased.conflicts.join(', ') || 'unknown files'}${rebased.aborted ? '; the rebase was aborted and your commits are intact' : '; the abort failed, inspect the vault'}`, { conflicts: rebased.conflicts });
    }
    report.pulled += behind;
    return null;
  };

  let stopped = integrate();
  if (stopped) return stopped;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { ahead } = aheadBehind(vaultPath);
    if (!ahead) break;
    await hooks.beforePush?.();
    const pushed = hooks.pushImpl ? hooks.pushImpl(vaultPath) : push(vaultPath);
    if (pushed.pushed) {
      report.pushed += ahead;
      await hooks.afterPush?.();
      break;
    }
    if (!isPushRejection(pushed.reason)) return fail('push-failed', pushed.reason);
    if (attempt === 1) return fail('push-rejected', `the remote moved again during the retry: ${pushed.reason}`);
    report.retried = true;
    stopped = integrate();
    if (stopped) return stopped;
  }

  // A fresh fetch, not the tracking ref: a successful `git push` writes that ref
  // itself, so reading it back would only confirm the push agrees with itself.
  const fetched = fetchUpstream(vaultPath);
  if (!fetched.ok) return fail('fetch-failed', `pushed, but could not re-check the remote: ${fetched.reason}`);
  const final = aheadBehind(vaultPath);
  report.behindAfter = final.behind;
  report.inSync = final.ahead === 0 && final.behind === 0;
  if (final.ahead > 0) {
    return fail('not-in-sync', `after syncing, ${final.ahead} local commit(s) are still not on ${report.upstream}`);
  }
  return { ok: true, ...report };
}

const PLUGIN_ADVICE = 'In Obsidian Git settings turn these off so commits and pushes come from wiki-sync and the operation scripts only (auto-pull may stay on): '
  + 'set the auto commit-and-sync interval to 0, turn off "commit on file change", and set the auto push interval to 0.';

export async function main(argv) {
  const allowed = new Set(['--commit-local']);
  const unknown = argv.filter((arg) => !allowed.has(arg));
  if (unknown.length) {
    console.error(`wiki-sync: unknown option ${unknown.join(' ')}\nusage: node scripts/wiki-sync.mjs [--commit-local]`);
    process.exitCode = 1;
    return;
  }
  const { path: vaultPath } = resolveVault();
  const r = await syncVault(vaultPath, { commitLocal: argv.includes('--commit-local') });

  if (r.skipped) {
    console.log(`wiki-sync: ${r.skipped}; nothing to sync.`);
    return;
  }
  if (r.obsidianGit?.unreadable) {
    console.log('⚠ Obsidian Git is installed but its settings could not be read; check that it does not commit or push on its own.');
  } else if (r.obsidianGit?.enabled.length) {
    console.log(`⚠ Obsidian Git is set to commit or push by itself (${r.obsidianGit.enabled.join(', ')}). ${PLUGIN_ADVICE}`);
  }
  // These two describe other writers' operations, not what this sync did: said once per set of tokens, again when the set
  // changes and once a day while it stays true (lib/sync-notes.mjs), not on every run.
  const due = notesDue(vaultPath, { open: r.openOperations, stale: r.staleOperations });
  if (due.open) {
    console.log(`note: ${r.openOperations.length} operation(s) still open (${r.openOperations.join(', ')}); their files are not committed by this sync.`);
  }
  if (due.stale) {
    console.log(`note: ${r.staleOperations.length} abandoned operation token(s) older than ${STALE_OPERATION_HOURS} hours (${r.staleOperations.join(', ')}); age alone does not prove abandonment. Review with: node scripts/op-cleanup.mjs`);
  }
  if (r.committedLocal) {
    console.log(`committed ${r.committedLocal.sha.slice(0, 7)}: ${r.committedLocal.paths.length} local edit(s)`);
    for (const p of r.committedLocal.paths) console.log(`  ${p}`);
  }

  if (!r.ok) {
    console.error(`wiki-sync: ${r.reason}`);
    for (const p of r.conflicts ?? r.overlap ?? []) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`pulled ${r.pulled} commit(s), pushed ${r.pushed} commit(s)${r.retried ? ' (after one retry)' : ''}`);
  console.log(r.inSync
    ? `in sync with ${r.upstream}`
    : `${r.upstream} has ${r.behindAfter} newer commit(s) since; run wiki-sync again to take them`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
