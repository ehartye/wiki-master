// Checks, or sets up, the Obsidian Git plugin this vault depends on. --check reads the vault's files and calls nothing.
// --apply installs the plugin without enabling it, writes its settings only if it has none, then enables it, so the
// plugin's first load already sees them. An existing settings file is never changed.
//
// The app's CLI exits 0 when it fails, printing "Error: ..." or "Vault not found.", so a step counts as done only when
// its effect is on disk.
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault, obsidian } from './lib/vault.mjs';
import { unknownOption, rejection, cliGuard } from './lib/cli-guard.mjs';
import { OBSIDIAN_GIT_ID, REQUIRED_SETTINGS, compareSettings, obsidianGitDataFile, obsidianGitPrerequisite } from './lib/obsidian-git.mjs';
import { canonical, obsidianSession } from './lib/prerequisites.mjs';
cliGuard(import.meta.url);

const NAME = 'setup-obsidian-git';
const OPTIONS = ['check', 'apply'];
const ID = `id=${OBSIDIAN_GIT_ID}`;
const INSTALL_TIMEOUT_MS = 120_000; // A download from the plugin's releases, unlike every other CLI call here.
const ENABLED_POLLS = 20; // The app saves the enabled list about a second after the command returns.
const ENABLED_POLL_MS = 250;

const settingsList = Object.entries(REQUIRED_SETTINGS).map(([key, value]) => `${key}: ${value}`).join(', ');

function pluginLine({ installed, enabled }) {
  if (!installed) return `Obsidian Git: not installed${enabled ? ', though listed as enabled' : ''}`;
  return `Obsidian Git: installed${enabled ? ' and enabled' : ', not enabled'}`;
}

// Reports the vault as it now stands and returns the exit code: 0 only when the plugin is on and every setting matches.
function report(vaultPath, { out }) {
  const state = obsidianGitPrerequisite(vaultPath);
  const { met, missing, differing } = compareSettings(vaultPath);
  out(`${NAME}: ${vaultPath}`);
  out(`  ${pluginLine(state)}`);
  if (state.settings === 'unreadable') out(`  ${obsidianGitDataFile(vaultPath)} cannot be read, so its settings are unknown.`);
  for (const { key, required } of met) out(`  met: ${key} = ${JSON.stringify(required)}`);
  for (const { key, required, actual } of differing) out(`  differs: ${key} is ${JSON.stringify(actual)}, required ${JSON.stringify(required)}`);
  for (const { key, required } of missing) out(`  missing: ${key}, required ${JSON.stringify(required)}`);
  if (state.settings !== 'absent' && (differing.length || missing.length)) {
    out('  Change these in Obsidian Git\'s settings. Setup never overwrites an existing settings file.');
  }
  return state.installed && state.enabled && !differing.length && !missing.length ? 0 : 1;
}

function manualSteps(vaultPath, { out }) {
  out('Manual steps:');
  out(`  1. Open ${vaultPath} as a vault in Obsidian.`);
  out('  2. Settings > Community plugins: turn off Restricted mode, which every new vault starts with. Any prompt about trusting the vault is the owner\'s to answer.');
  out(`  3. Run ${NAME}.mjs --apply again for this vault: it installs the plugin, writes the settings and enables it.`);
  out(`  If that still fails, by hand: browse community plugins, find "Git" by Vinzent (${OBSIDIAN_GIT_ID}) and install it without enabling it, then run --apply once more.`);
  out(`  Or enable the plugin yourself and set these in its settings: ${settingsList}.`);
}

// Whether the app in this session has this vault open and allows plugins. Returns the reason it cannot go on, or null.
function blocker(vault, { session, cli }) {
  let where;
  try {
    where = session();
  } catch (error) {
    return `could not read the process list to look for Obsidian: ${error.message}`;
  }
  // Calling the CLI with no app running could start one.
  if (where === 'none') return 'Obsidian is not running for this user.';
  if (where === 'other-session') return 'Obsidian is running in another session, so its command line cannot be reached from here.';
  try {
    const reported = cli(['vault', 'info=path']);
    // A name reaches the first registered vault with that folder name, which need not be this one.
    if (!reported || canonical(reported) !== canonical(vault.path)) {
      return isAbsolute(reported) ? `the name ${vault.name} reaches the vault at ${reported}, not this one.` : `Obsidian has not opened this vault (it answered: ${reported || 'nothing'}).`;
    }
    const restricted = cli(['plugins:restrict']);
    if (restricted === 'on') return 'restricted mode is on in this vault, so it allows no community plugins.';
    if (restricted !== 'off') return `could not read restricted mode (it answered: ${restricted}).`;
  } catch (error) {
    return error.message;
  }
  return null;
}

function writeRequiredSettings(file) {
  try {
    writeFileSync(file, `${JSON.stringify(REQUIRED_SETTINGS, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

async function waitForEnabled(vaultPath, delay) {
  for (let poll = 0; poll <= ENABLED_POLLS; poll++) {
    if (obsidianGitPrerequisite(vaultPath).enabled) return true;
    if (poll < ENABLED_POLLS) await delay(ENABLED_POLL_MS);
  }
  return false;
}

// One CLI step. Returns the reason it failed, or null. `success` is the text a step must answer with when, like a
// reload, it leaves nothing on disk to check afterwards.
function runStep(cli, args, options, success) {
  try {
    const output = cli(args, options);
    const failed = success ? !output.startsWith(success) : output.startsWith('Error');
    return failed ? output || 'no answer' : null;
  } catch (error) {
    return error.message;
  }
}

// Does what is left to do. Returns the reason it stopped, or null.
async function apply(vault, deps, { out }) {
  const before = obsidianGitPrerequisite(vault.path);
  const install = !before.installed;
  const configure = before.settings === 'absent';
  // A plugin listed as enabled cannot be enabled again; once its files or settings change, it needs a reload to read them.
  const load = before.enabled ? (install || configure ? 'plugin:reload' : null) : 'plugin:enable';

  // Ahead of the early return: a vault that looks finished on disk can still be restricted, with the plugin never running.
  const blocked = blocker(vault, deps);
  if (blocked) return blocked;
  if (!install && !configure && !load) return null;

  if (install) {
    const failed = runStep(deps.cli, ['plugin:install', ID], { timeout: INSTALL_TIMEOUT_MS });
    if (failed) return `the install did not finish: ${failed}`;
    if (!obsidianGitPrerequisite(vault.path).installed) return `the install reported success, but the plugin is not on disk in ${vault.path}.`;
    out(`${NAME}: installed ${OBSIDIAN_GIT_ID}`);
  }
  // Read again rather than trusting `configure`: only a file that is still absent gets written.
  if (obsidianGitPrerequisite(vault.path).settings === 'absent') {
    try {
      deps.writeSettings(obsidianGitDataFile(vault.path));
    } catch (error) {
      return `the settings could not be written: ${error.message}`;
    }
    out(`${NAME}: wrote the required settings`);
  }
  if (load) {
    const failed = runStep(deps.cli, [load, ID], undefined, load === 'plugin:reload' ? 'Reloaded' : undefined);
    if (failed) return `${load} did not finish: ${failed}. The plugin's files and settings stay in place.`;
    if (!(await waitForEnabled(vault.path, deps.delay))) return `${load} reported success, but community-plugins.json does not list ${OBSIDIAN_GIT_ID}.`;
  }
  return null;
}

// Returns the exit code. `hooks` replaces the real vault, app and output, for tests.
export async function main(argv = process.argv.slice(2), hooks = {}) {
  const { out = console.log, err = console.error } = hooks;
  const unknown = unknownOption(argv, OPTIONS);
  if (unknown !== null) {
    err(rejection(NAME, OPTIONS, unknown));
    return 2;
  }
  if (argv.includes('--check') && argv.includes('--apply')) {
    err(`${NAME}: choose --check or --apply, not both`);
    return 2;
  }
  const vault = hooks.vault ?? resolveVault();
  if (!argv.includes('--apply')) return report(vault.path, { out });

  const deps = {
    session: hooks.session ?? (() => obsidianSession()),
    cli: hooks.cli ?? ((args, options) => obsidian(args, { name: vault.name, ...options })),
    delay: hooks.delay ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    writeSettings: hooks.writeSettings ?? writeRequiredSettings,
  };
  const stopped = await apply(vault, deps, { out });
  if (stopped) {
    err(`${NAME}: not finished: ${stopped}`);
    manualSteps(vault.path, { out });
  }
  const code = report(vault.path, { out });
  return stopped ? 1 : code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`${NAME}: ${error.message}`); process.exitCode = 2; }
}
