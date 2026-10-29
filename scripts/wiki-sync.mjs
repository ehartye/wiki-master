import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import {
  isGitRepo, commitPaths, push, rebaseInProgress, upstreamOf, fetchUpstream,
  aheadBehind, dirtyPaths, incomingFiles, rebaseOntoUpstream, isPushRejection, indexLockAgeSeconds, statusPorcelain,
} from './lib/git.mjs';
import { dirtySet } from './lib/op.mjs';
import { obsidianGitAutoCommit } from './lib/obsidian-git.mjs';
import { listOperations, STALE_OPERATION_HOURS } from './lib/op-tokens.mjs';
import { readWritten, openOperationProblem } from './lib/op-ledger.mjs';
import { readLedger } from './lib/ledger.mjs';
import { notesDue } from './lib/sync-notes.mjs';
import { recordRefusal } from './lib/op-refusals.mjs';
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

// Open operations whose writers recorded paths (op-ledger) that are still uncommitted: work this sync cannot publish, because
// only the operation's own close commits it. Read-only. A ledger that cannot be read is skipped rather than failing the sync,
// whose job is the commits that exist; `op-ledger.mjs show` names a damaged line.
function unpublishedWork(vaultPath, operations) {
  if (!operations.length) return [];
  let dirty;
  try { dirty = dirtySet(statusPorcelain(vaultPath)); } catch { return []; }
  const found = [];
  for (const o of operations) {
    let recorded;
    try { recorded = readWritten(vaultPath, o.token); } catch { continue; }
    const count = recorded.filter((p) => dirty.has(p)).length;
    if (count) found.push({ token: o.token, op: o.op, count });
  }
  return found;
}

// The text of the overlap refusal. With no operation open the dirty files are hand edits and the advice is the original one.
// With operations open, each overlapping file says which open operation's recorded ledger names it (a hint: the ledger is what a
// writer recorded, nothing else is read as ownership) or that none does, then the open operations, then what to do if the edits
// are yours and, in plain words, what not to do if they are not. A ledger that cannot be read attributes nothing.
function overlapMessage(vaultPath, operations, overlap) {
  const head = `uncommitted edits overlap incoming changes in ${overlap.join(', ')}`;
  if (!operations.length) return `${head}; commit them (or finish the operation) and sync again`;
  let dirty;
  try { dirty = dirtySet(statusPorcelain(vaultPath)); } catch { dirty = new Set(overlap); }
  const recording = operations.map((o) => {
    let recorded;
    try { recorded = readWritten(vaultPath, o.token); } catch { recorded = []; }
    return { token: o.token, op: o.op, files: new Set(recorded.filter((p) => dirty.has(p))) };
  });
  const label = (o) => `${o.token} (${o.op ?? 'unknown op'})`;
  const fileLines = overlap.map((p) => {
    const by = recording.filter((o) => o.files.has(p));
    return by.length ? `${p}: recorded by operation ${by.map(label).join(', ')}` : `${p}: not recorded by any open operation`;
  });
  const owners = recording.filter((o) => overlap.some((p) => o.files.has(p)));
  return [
    head,
    ...fileLines,
    `Open operations: ${recording.map(label).join(', ')}`,
    `If you wrote these edits, finish your operation (wiki-sync.mjs --op ${owners.length === 1 ? owners[0].token : '<token>'}) and sync again.`,
    'If you did not, leave them exactly as they are: do not reset, checkout, stash or delete them. Wait for their owner to close the operation, then sync again.',
  ].join('\n');
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
    unpublished: unpublishedWork(vaultPath, operations),
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
      // Counts only, never a name; a failed append changes nothing here.
      recordRefusal(vaultPath, { op: 'wiki-sync', kind: 'sync-overlap', paths: overlap.length });
      return fail('overlap', overlapMessage(vaultPath, operations, overlap), { overlap });
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

const USAGE = 'usage: node scripts/wiki-sync.mjs [--commit-local | --op <token> [--paths-file <ledger.json>] [--title "<title>"]]';

// The command line: `--commit-local`, or `--op <token>` with the optional scope and message of the close it makes. Each value
// is read in either spelling (`--op x`, `--op=x`). Returns { error } for anything it cannot act on, so nothing runs.
export function parseArgs(argv) {
  const out = { commitLocal: false };
  const values = new Set(['op', 'paths-file', 'title']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--commit-local') { out.commitLocal = true; continue; }
    const name = token.startsWith('--') ? token.slice(2).split('=')[0] : null;
    if (!values.has(name)) return { error: `unknown option ${token}` };
    let value;
    if (token.includes('=')) value = token.slice(token.indexOf('=') + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) { value = argv[i + 1]; i += 1; }
    if (!value) return { error: `--${name} needs a value` };
    const key = name === 'paths-file' ? 'pathsFile' : name;
    if (out[key] !== undefined) return { error: `--${name} was given twice` };
    out[key] = value;
  }
  if (out.op !== undefined && out.commitLocal) {
    return { error: '--op and --commit-local cannot be used together: --op closes the one operation it names and publishes it; --commit-local commits hand edits and refuses while any operation is open' };
  }
  if (out.op === undefined && (out.pathsFile !== undefined || out.title !== undefined)) {
    return { error: '--paths-file and --title belong to --op' };
  }
  return out;
}

// Closes the one operation named, through the same commitOp op-commit uses, so a close here is the close op-commit would make.
// The scope is the explicit --paths-file; otherwise the operation's recorded ledger when it has one; otherwise unscoped, which
// commitOp may refuse. Only the token given is ever touched. { ok: false, reason } means nothing was committed and the token is kept.
export async function closeOperation(vaultPath, { token, pathsFile, title }) {
  const problem = openOperationProblem(vaultPath, token);
  if (problem) return { ok: false, reason: problem };
  let paths;
  try {
    if (pathsFile !== undefined) paths = readLedger(pathsFile);
    else {
      const recorded = readWritten(vaultPath, token);
      if (recorded.length) paths = recorded;
    }
  } catch (error) {
    return { ok: false, reason: pathsFile !== undefined ? `cannot read --paths-file scope: ${error.message}` : error.message };
  }
  const op = listOperations(vaultPath).find((o) => o.token === token)?.op ?? 'wiki-sync';
  const { commitOp } = await import('./op-commit.mjs');
  try {
    return commitOp(vaultPath, { op, title: title ?? 'published with wiki-sync --op', token, paths });
  } catch (error) {
    return { ok: false, reason: `the close failed before it committed (the token is kept): ${error.message}` };
  }
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`wiki-sync: ${args.error}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const { path: vaultPath } = resolveVault();

  let closed = null;
  if (args.op !== undefined) {
    closed = await closeOperation(vaultPath, { token: args.op, pathsFile: args.pathsFile, title: args.title });
    if (!closed.ok) {
      console.error(`not committed: ${closed.reason}`);
      process.exitCode = 1;
      return;
    }
    if (closed.committed) console.log(`closed operation ${args.op}: committed ${closed.sha.slice(0, 7)} (${closed.paths.length} file(s))`);
    else console.log(`closed operation ${args.op}: ${closed.reason === 'not a git repository' ? 'not a git repository, nothing to commit' : 'nothing to commit'}`);
    if (closed.wrappedLinks?.length) {
      console.log(`warning: ${closed.wrappedLinks.length} hard-wrapped wikilink(s) in the files just committed; run \`node scripts/repair-wrapped-links.mjs --apply\`:`);
      for (const w of closed.wrappedLinks) console.log(`  ${w.page}`);
    }
  }

  try {
    await syncAndReport(vaultPath, args, closed?.committed ? closed.sha.slice(0, 7) : null);
  } finally {
    // As op-commit does after its commit: the semantic index follows the vault. Never throws, never sets an exit code.
    if (closed?.committed) {
      const { refreshAfterOp } = await import('./op-commit.mjs');
      const { notice } = await refreshAfterOp(vaultPath);
      if (notice) console.log(notice);
    }
  }
}

// `landed` is the short sha of a commit this run's --op made, so a sync that then fails can say the work is committed and not published.
async function syncAndReport(vaultPath, args, landed) {
  const r = await syncVault(vaultPath, { commitLocal: args.commitLocal });

  if (r.skipped) {
    console.log(`wiki-sync: ${r.skipped}; nothing to sync.`);
    return;
  }
  if (r.obsidianGit?.unreadable) {
    console.log('⚠ Obsidian Git is installed but its settings could not be read; check that it does not commit or push on its own.');
  } else if (r.obsidianGit?.enabled.length) {
    console.log(`⚠ Obsidian Git is set to commit or push by itself (${r.obsidianGit.enabled.join(', ')}). ${PLUGIN_ADVICE}`);
  }
  // These describe other writers' operations, not what this sync did: said once per set of tokens, again when the set
  // changes and once a day while it stays true (lib/sync-notes.mjs), not on every run. The unpublished-work line is keyed by
  // token and recorded count, so it is said again when an operation records more.
  const due = notesDue(vaultPath, {
    open: r.openOperations,
    stale: r.staleOperations,
    unpublished: (r.unpublished ?? []).map((u) => `${u.token}:${u.count}`),
  });
  if (due.open) {
    console.log(`note: ${r.openOperations.length} operation(s) still open (${r.openOperations.join(', ')}); their files are not committed by this sync.`);
  }
  if (due.unpublished) {
    // A sync cannot know whose operation this is, so this is a line and never a failure: the exit code is unchanged.
    for (const u of r.unpublished) {
      console.log(`operation ${u.token} (${u.op ?? 'unknown op'}) has ${u.count} recorded path(s) not committed; if it is yours, close and publish it with: node scripts/wiki-sync.mjs --op ${u.token}`);
    }
  }
  if (due.stale) {
    console.log(`note: ${r.staleOperations.length} abandoned operation token(s) older than ${STALE_OPERATION_HOURS} hours (${r.staleOperations.join(', ')}); age alone does not prove abandonment. Review with: node scripts/op-cleanup.mjs`);
  }
  if (r.committedLocal) {
    console.log(`committed ${r.committedLocal.sha.slice(0, 7)}: ${r.committedLocal.paths.length} local edit(s)`);
    for (const p of r.committedLocal.paths) console.log(`  ${p}`);
  }

  if (!r.ok) {
    if (landed) console.error(`committed, not published: ${landed} is committed in the vault but the sync failed: ${r.reason}. Fix the cause and run: node scripts/wiki-sync.mjs`);
    else console.error(`wiki-sync: ${r.reason}`);
    // The overlap refusal lists its files inside its message, and is the one failure that exits 3, so a caller can tell a refusal
    // that changed nothing from a failure.
    if (r.code === 'overlap') {
      process.exitCode = 3;
      return;
    }
    for (const p of r.conflicts ?? []) console.error(`  ${p}`);
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
