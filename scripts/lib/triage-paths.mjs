import { join } from 'node:path';
import { assertVaultPath } from './vault-path.mjs';

// Both entrypoints use the same boundary, and recheck final leaves at each use:
// a long-lived server's directories can change after its initial preflight.
export function triagePaths(vaultPath, sessionDir = join(vaultPath, '.wiki-master', 'triage-ui')) {
  const check = (...parts) => assertVaultPath(vaultPath, join(...parts));
  const content = check(sessionDir, 'content');
  const state = check(sessionDir, 'state');
  const stateFile = name => check(state, name);
  const screenFile = name => check(content, name);
  const ledger = () => check(vaultPath, '.wiki-master', 'triage.jsonl');
  for (const name of ['token', 'port', 'server-info', 'server-stopped', `server-info.${process.pid}.tmp`]) stateFile(name);
  ledger();
  return { check, content, state, stateFile, screenFile, ledger };
}
