import { spawnSync } from 'node:child_process';

function processSnapshot(timeout) {
  const result = spawnSync('/bin/ps', ['-eo', 'pid=,ppid=,lstart='], {
    timeout, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) throw Error(`process snapshot failed: ${result.error?.code ?? result.status}`);
  const rows = result.stdout.trim().split('\n').filter(Boolean).map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) throw Error('invalid process snapshot');
    return { pid: Number(match[1]), ppid: Number(match[2]), start: match[3].trim() };
  });
  if (new Set(rows.map(r => r.pid)).size !== rows.length) throw Error('duplicate process identity');
  return rows;
}

// This is bounded cleanup of an ordinary converter tree, not containment of a
// hostile daemon. Re-snapshot while the owned root is open; never signal a stale
// PID after yielding. Keep ancestors alive until their children have disappeared
// (including zombies), so their normal waitpid handlers can reap them.
export async function reapProbeDescendants(root, {
  deadline, isRootOpen, now = () => performance.now(), snapshot = processSnapshot,
  signal = (pid) => process.kill(pid, 'SIGKILL'),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  // PPid establishes current ancestry, not lifetime identity: an orphaned zombie
  // changes parent while remaining the same un-reaped process.
  const identity = row => `${row.pid}:${row.start}`;
  const pending = new Set();
  let rootIdentity, rounds = 0, signalled = 0;
  try {
    while (now() < deadline && rounds++ < 128) {
      if (!isRootOpen()) throw Error('owned root closed before descendant cleanup was confirmed');
      const rows = snapshot(Math.max(1, Math.min(250, Math.floor(deadline - now()))));
      if (!isRootOpen() || now() >= deadline) throw Error('cleanup deadline or root closure during snapshot');
      const rootRow = rows.find(row => row.pid === root);
      if (!rootRow) throw Error('owned root missing from process snapshot');
      rootIdentity ??= identity(rootRow);
      if (identity(rootRow) !== rootIdentity) throw Error('owned root identity changed');
      const present = new Set(rows.map(identity));
      for (const id of pending) if (!present.has(id)) pending.delete(id);
      // Do not kill ancestors until already-signalled leaves have been reaped.
      if (pending.size) { await pause(Math.min(10, Math.max(1, deadline - now()))); continue; }
      const descendants = [], seen = new Set([root]);
      const visit = parent => {
        for (const row of rows) if (row.ppid === parent) {
          if (seen.has(row.pid)) throw Error('cyclic process ancestry');
          seen.add(row.pid); descendants.push(row); visit(row.pid);
        }
      };
      visit(root);
      if (!descendants.length) return { outcome: 'passed', signalled, snapshots: rounds };
      const parents = new Set(descendants.map(row => row.ppid));
      for (const row of descendants.filter(row => !parents.has(row.pid))) {
        // Fresh snapshot ancestry + start identity; no delayed PID signalling.
        if (!isRootOpen() || now() >= deadline) throw Error('cleanup deadline or root closure before signal');
        try { signal(row.pid); pending.add(identity(row)); signalled++; }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      await pause(Math.min(10, Math.max(1, deadline - now())));
    }
    throw Error('descendant disappearance not confirmed within cleanup budget');
  } catch (error) {
    return { outcome: 'unusable', reason: error.message, signalled, snapshots: rounds };
  }
}
