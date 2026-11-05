// What must be true before a refresh writes anything. Every check runs and every failure is reported at once, each
// with the fix an agent should offer the user, so one run shows the whole list instead of one problem per attempt.
//
// Nothing here starts an application or changes a setting, and the Obsidian CLI is called only after a process was
// found. Asking the CLI first would start the app on some systems.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { isAvailable, modelPresent, EMBED_MODEL, OLLAMA_HOST } from './embed.mjs';
import { obsidian } from './vault.mjs';
import { obsidianGitPrerequisite } from './obsidian-git.mjs';

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, windowsHide: true });

// `tasklist /FO CSV /NH` prints one quoted row per process, the fields being image, PID, session name, session number
// and memory. With no match it prints one unquoted line, translated on other systems, so only a quoted row counts.
export function parseTasklist(stdout) {
  const rows = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('"')) continue;
    const fields = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (fields.length < 4) continue;
    rows.push({ image: fields[0], pid: Number(fields[1]), sessionName: fields[2], session: fields[3] });
  }
  return rows;
}

function windowsSession({ username, pid, exec }) {
  const list = (...filters) => parseTasklist(exec('tasklist', ['/FO', 'CSV', '/NH', ...filters.flatMap((f) => ['/FI', f])]));
  const processes = list('IMAGENAME eq Obsidian.exe', `USERNAME eq ${username}`).filter((row) => row.image.toLowerCase() === 'obsidian.exe');
  if (!processes.length) return 'none';
  const own = list(`PID eq ${pid}`).find((row) => row.pid === pid);
  if (!own) throw new Error(`process ${pid} is not in its own process list`);
  return processes.some((row) => row.session === own.session) ? 'this-session' : 'other-session';
}

// A system without session numbers has only "this user": any process of theirs counts as this session.
function posixSession({ uid, exec }) {
  for (const line of exec('/bin/ps', ['-eo', 'uid=,comm=']).split('\n')) {
    const row = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (row && Number(row[1]) === uid && row[2].split('/').pop().toLowerCase() === 'obsidian') return 'this-session';
  }
  return 'none';
}

// Where this user's Obsidian runs, relative to this process: 'none', 'this-session' or 'other-session'.
export function obsidianSession({ platform = process.platform, username = userInfo().username, uid = process.getuid?.(), pid = process.pid, exec = run } = {}) {
  return platform === 'win32' ? windowsSession({ username, pid, exec }) : posixSession({ uid, exec });
}

// Read-only. A vault may sit in a subfolder of its repository: Obsidian Git supports that.
export function gitState(vaultPath, { exec = run } = {}) {
  const revParse = (...args) => exec('git', ['-C', vaultPath, 'rev-parse', ...args]);
  const reason = (error) => String(error.stderr || error.message).trim().split(/\r?\n/)[0];
  try {
    if (revParse('--is-inside-work-tree').trim() !== 'true') return { repo: false, upstream: false, detail: 'the folder is not in a work tree' };
  } catch (error) {
    return { repo: false, upstream: false, detail: reason(error) };
  }
  try {
    revParse('--abbrev-ref', '--symbolic-full-name', '@{upstream}');
    return { repo: true, upstream: true };
  } catch (error) {
    return { repo: true, upstream: false, detail: reason(error) };
  }
}

function canonical(path) {
  let real = resolve(path);
  try { real = realpathSync.native(real); } catch { /* a missing folder has only its given spelling */ }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

const failure = (id, problem, fix) => ({ id, problem, fix });

async function checkOllama({ ollamaUp, modelPulled, model, host }) {
  if (!(await ollamaUp())) return [failure('ollama', `Ollama is not reachable at ${host}.`, 'Offer to start Ollama.')];
  if (!(await modelPulled())) return [failure('ollama-model', `The embedding model ${model} is not pulled.`, `Offer to pull it: ollama pull ${model}.`)];
  return [];
}

function checkObsidian(vault, { session, cli }, notes) {
  let where;
  try {
    where = session();
  } catch (error) {
    return [failure('obsidian-processes', `Could not read the process list to look for Obsidian: ${error.message}.`, 'Rerun; if it fails again, offer to check that Obsidian is running.')];
  }
  if (where === 'none') return [failure('obsidian', 'Obsidian is not running for this user.', 'Offer to start Obsidian with this vault open.')];
  if (where === 'other-session') {
    notes.push('Obsidian is running in another session, so its command line was not called from here.');
    return [];
  }
  let reported;
  try {
    reported = cli(['vault', 'info=path']);
  } catch (error) {
    if (['CLI_BUSY', 'CLI_LOCK'].includes(error.code)) {
      return [failure('obsidian-cli-gate', `The Obsidian CLI gate is busy or failing (${error.code}).`, 'Rerun refresh-index.mjs. Treat a repeat as the CLI being down, and offer to restart Obsidian.')];
    }
    return [failure('obsidian-cli', `The Obsidian CLI did not answer: ${error.message}`, 'Offer to start Obsidian with this vault open and its command line interface enabled.')];
  }
  if (!reported || canonical(reported) !== canonical(vault.path)) {
    return [failure('obsidian-vault', `Obsidian reports the vault at ${reported || '(nothing)'}, not ${vault.path}.`, 'Offer to open this vault in Obsidian.')];
  }
  return [];
}

function checkObsidianGit(vaultPath) {
  const state = obsidianGitPrerequisite(vaultPath);
  const found = [];
  if (!state.installed || !state.enabled) {
    found.push(failure('obsidian-git', `Obsidian Git is not ${state.installed ? 'enabled' : 'installed'} in this vault.`, 'Offer to install and enable it through wiki-setup.'));
  }
  // With no plugin and no settings there is one problem, not two: installing it through setup writes the settings.
  const timerOff = state.settings === 'absent' ? state.installed : !(state.autoSaveInterval > 0);
  if (timerOff) {
    const seen = state.settings === 'read' ? `autoSaveInterval is ${state.autoSaveInterval ?? 'not set'}` : `settings are ${state.settings}, so autoSaveInterval cannot be above 0`;
    found.push(failure('obsidian-git-timer', `Obsidian Git's ${seen}, so its timer is off.`, 'Offer to change it in Obsidian Git\'s settings; setup never overwrites existing settings.'));
  }
  return found;
}

function checkGit(vaultPath, { git }) {
  const state = git(vaultPath);
  if (!state.repo) return [failure('git-repository', `The vault is not a git repository${state.detail ? ` (${state.detail})` : ''}.`, 'The owner sets up the repository and its upstream; ask them to.')];
  if (!state.upstream) return [failure('git-upstream', `The vault's current branch has no upstream${state.detail ? ` (${state.detail})` : ''}.`, 'The owner sets up the upstream; ask them to.')];
  return [];
}

// `vault` is { path, name }. `probes` replaces any real check, for a test or a caller that already knows the answer.
export async function checkPrerequisites({ vault, probes = {} }) {
  const live = {
    model: EMBED_MODEL,
    host: OLLAMA_HOST,
    ollamaUp: () => isAvailable(),
    modelPulled: () => modelPresent(),
    session: () => obsidianSession(),
    cli: (args) => obsidian(args, { name: vault.name }),
    git: (path) => gitState(path),
    ...probes,
  };
  const notes = [];
  const failures = [
    ...(await checkOllama(live)),
    ...checkObsidian(vault, live, notes),
    ...checkObsidianGit(vault.path),
    ...checkGit(vault.path, live),
  ];
  return { ok: failures.length === 0, failures, notes };
}
