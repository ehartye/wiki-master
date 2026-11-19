import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

function git(dir, ...args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}
const canonical = path => { try { return realpathSync(path); } catch { return resolve(path); } };

export function repositoryFacts(dir) {
  const top = git(dir, 'rev-parse', '--show-toplevel');
  return { remote: git(dir, 'remote', 'get-url', 'origin'), folder: basename(top ?? resolve(dir)) };
}

// All reads use Git's metadata, including separate Git directories. No pathname guessing.
export function discoverRepository(dir, { explicit = false } = {}) {
  let directory = false;
  try { directory = statSync(dir).isDirectory(); } catch { /* handled below */ }
  const fail = message => { throw Object.assign(new Error(message), { exitCode: 2 }); };
  if (!directory) {
    if (explicit) fail(`Repository directory does not exist or cannot be read: ${dir}`);
    return { root: null, configPath: null, inherited: false, diagnostics: ['Current directory is unavailable; using global configuration.'] };
  }
  const top = git(dir, 'rev-parse', '--show-toplevel');
  if (!top) {
    const bare = git(dir, 'rev-parse', '--is-bare-repository') === 'true';
    if (explicit && !bare) fail(`Not a Git repository: ${dir}`);
    return { root: null, configPath: null, inherited: false, diagnostics: [bare ? 'Bare or unsupported repository layout; using global configuration.' : 'Outside a Git repository; using global configuration.'] };
  }
  const root = canonical(top), own = join(root, '.wiki-master.json');
  const facts = repositoryFacts(root);
  if (existsSync(own)) return { root, ...facts, configPath: own, inherited: false, diagnostics: [] };
  const commonRaw = git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const common = commonRaw ? canonical(commonRaw) : null;
  const listing = git(root, 'worktree', 'list', '--porcelain', '-z');
  const primaryRaw = listing?.split('\0').find(line => line.startsWith('worktree '))?.slice(9);
  let primary = primaryRaw && canonical(primaryRaw);
  const diagnostics = [];
  const primaryTop = primary && git(primary, 'rev-parse', '--show-toplevel');
  if (primaryTop) primary = canonical(primaryTop);
  else if (primary) {
    const worktree = git(root, 'config', '--get', 'core.worktree');
    primary = worktree && common ? canonical(resolve(common, worktree)) : null;
    if (!primary) diagnostics.push('Unsupported primary checkout metadata; using global configuration without inherited project settings.');
  }
  if (primary && primary !== root && common) {
    const primaryCommon = git(primary, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const candidate = join(primary, '.wiki-master.json');
    if (primaryCommon && canonical(primaryCommon) === common && existsSync(candidate) &&
        !git(primary, 'ls-files', '--', '.wiki-master.json') && git(primary, 'check-ignore', '--', '.wiki-master.json')) {
      return { root, ...facts, configPath: candidate, inherited: true, diagnostics: [] };
    }
  }
  return { root, ...facts, configPath: null, inherited: false, diagnostics };
}
