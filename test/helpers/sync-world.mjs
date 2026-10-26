import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

// Three machines share one vault through one remote. A bare repository plus clones of it is the same shape:
// each clone is a machine, `origin` is the remote. core.autocrlf is pinned off at clone time so the tests can
// assert on bytes and see no line-ending warnings.

export const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function machine(remote, name) {
  const dir = mkdtempSync(join(dirname(remote), `${name}-`));
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', remote, dir], { stdio: ['ignore', 'pipe', 'ignore'] });
  sh(dir, 'config', 'user.email', `${name}@example.com`);
  sh(dir, 'config', 'user.name', name);
  return dir;
}

export function world() {
  const root = mkdtempSync(join(tmpdir(), 'wm-sync-root-'));
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  const a = machine(remote, 'a');
  writeFileSync(join(a, '.gitignore'), '.wiki-master/\n');
  writeFileSync(join(a, 'shared.md'), 'one\ntwo\nthree\n');
  sh(a, 'add', '-A');
  sh(a, 'commit', '-q', '-m', 'initial');
  sh(a, 'push', '-q', '-u', 'origin', 'HEAD:main');
  sh(a, 'branch', '-q', '--set-upstream-to=origin/main');
  const b = machine(remote, 'b');
  return { root, remote, a, b, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function commitFile(dir, file, text, message = `edit ${file}`) {
  writeFileSync(join(dir, file), text);
  sh(dir, 'add', file);
  sh(dir, 'commit', '-q', '-m', message);
}

export const remoteHead = (remote) => sh(remote, 'rev-parse', 'main');
