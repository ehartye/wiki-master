// `npm test`: runs `node --test <arguments>` with its own temp root, so the suite's temp folders stop piling up in
// the system temp folder. The root is wm-run-XXXXXX under the real temp folder; TMPDIR, TEMP and TMP point at it,
// so every os.tmpdir() in the tests and in the processes they start lands inside it. Tests are not rewritten.
//
// The tests also never see the machine's home folder or the vault the parent shell is bound to. HOME and USERPROFILE
// point at an empty home folder beside the root, <root>-home (Git reads HOME; Node and, on Windows, Python read
// USERPROFILE, so both move together), and XDG_CONFIG_HOME at its .config, so no test resolves the machine's vault
// registry. The home is outside the tests' temp directory on purpose: the default vault under it is then refused by
// the test-vault guard, so a test that names no vault fails instead of sharing one with every other test. The
// variables a vault-bound command hands its children (contextEnv in scripts/lib/context.mjs) are removed, and so is
// WIKI_MASTER_REQUIRE_VAULT. Every other variable passes through, WIKI_MASTER_BROWSER and WIKI_MASTER_BROWSER_RECORD
// included, and APPDATA and LOCALAPPDATA stay, because tool discovery reads them. A test that needs its own home,
// registry or strict-vault switch still sets it; its value wins.
//
//   npm test                         # the whole suite
//   npm test -- test/x.test.mjs      # arguments are passed to node --test
//
// When the run ends it prints how many entries the tests left in the root and how many new wm-* entries appeared
// in the real temp folder outside it (another suite running at the same time adds its own). A passing run removes
// the root; a failing run keeps it and prints its path, because a failed test's leftovers are its evidence. The home
// is removed either way, and is not counted in either number; what the tests wrote in it is printed as its own count.
// Nothing the runner did not create is ever deleted. Exits with the code of node --test, or 128 plus the signal number when
// a signal stopped it.
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const wmEntries = (dir) => new Set(readdirSync(dir).filter((n) => n.startsWith('wm-')));

// The variables contextEnv (scripts/lib/context.mjs) sets to bind a child process to a vault. run-suite.test.mjs
// derives the same list from contextEnv and fails if they differ.
const VAULT_BINDING = ['WIKI_MASTER_CONFIG', 'WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_ID', 'WIKI_MASTER_VAULT_NAME', 'WIKI_MASTER_PROJECT_ROOT'];
// Also removed: the strict-vault switch the README tells a shell that must not touch the real vault to set. The
// tests' own vaults are under the temp root already; a test that needs the switch sets it itself. run-suite.test.mjs
// classifies every WIKI_MASTER_* name the scripts read as dropped or kept, so a new one must be placed there.
const VAULT_GUARDS = ['WIKI_MASTER_REQUIRE_VAULT'];
// The variables that name the home folder: Git reads HOME; Node's os.homedir() and Python on Windows read USERPROFILE.
const HOME_VARIABLES = ['HOME', 'USERPROFILE'];
const entriesIn = (dir) => { try { return readdirSync(dir).length; } catch { return 0; } };
const remove = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });

// The child's environment. Windows treats variable names case-insensitively, so a name is matched in any case there.
function testEnv(parent, root, home) {
  const key = (name) => (process.platform === 'win32' ? name.toUpperCase() : name);
  const set = { TMPDIR: root, TEMP: root, TMP: root, XDG_CONFIG_HOME: join(home, '.config') };
  for (const name of HOME_VARIABLES) set[name] = home;
  const drop = new Set([...VAULT_BINDING, ...VAULT_GUARDS, ...Object.keys(set)].map(key));
  const env = Object.fromEntries(Object.entries(parent).filter(([name]) => !drop.has(key(name))));
  return { ...env, ...set };
}

// Started as the entry point, not imported. The loader names a module by its real path, so argv[1] is resolved
// the same way; a start through a link or junction still runs the suite.
function startedDirectly() {
  if (!process.argv[1]) return false;
  let entry = process.argv[1];
  try { entry = realpathSync(entry); } catch { /* compare the spelling given */ }
  return import.meta.url === pathToFileURL(entry).href || import.meta.url === pathToFileURL(process.argv[1]).href;
}

// `node --test` loads every .mjs below test/ as a test file, this one included; only a direct start runs the suite.
if (startedDirectly() && !process.env.NODE_TEST_CONTEXT) {
  const systemTemp = realpathSync(tmpdir());
  const before = wmEntries(systemTemp);
  const root = mkdtempSync(join(systemTemp, 'wm-run-'));
  const home = `${root}-home`;
  mkdirSync(home, { mode: 0o700 }); // as private as the mkdtemp root, on a shared temp folder too
  console.log(`run-suite: temp root ${root}`);
  const child = spawn(process.execPath, ['--test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: testEnv(process.env, root, home),
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('close', (code, signal) => {
    const status = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 0);
    const left = readdirSync(root).length;
    const ours = new Set([root, home]);
    const outside = [...wmEntries(systemTemp)].filter((n) => !before.has(n) && !ours.has(join(systemTemp, n))).length;
    console.log(`run-suite: left behind: ${left} in the temp root`);
    console.log(`run-suite: new wm-* entries in ${systemTemp} outside the root: ${outside}`);
    const written = entriesIn(home);
    try {
      remove(home);
      console.log(`run-suite: removed the run home ${home} (${written} entries written in it)`);
    } catch (error) {
      console.log(`run-suite: could not remove the run home ${home}: ${error.message}`);
    }
    if (status === 0) {
      try {
        remove(root);
        console.log(`run-suite: removed ${root}`);
      } catch (error) {
        console.log(`run-suite: could not remove ${root}: ${error.message}`);
      }
    } else {
      console.log(`run-suite: kept ${root} (the run failed; its temp folders are evidence)`);
    }
    process.exitCode = status; // not process.exit, which can cut off the lines above when stdout is a pipe
  });
}
