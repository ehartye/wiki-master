import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { contextEnv } from '../scripts/lib/context.mjs';

// `npm test` runs test/run-suite.mjs, which gives the run its own temp root: every test's tmpdir() is inside it,
// it is removed when the run passes and kept, with its path printed, when the run fails. The tests also get a HOME
// inside that root and none of the parent's vault-binding variables. The fixture test files are written
// outside the repository at run time, because `node --test` runs every .mjs below test/.

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'run-suite.mjs');

function fixture(t, name, source) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'wm-run-suite-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, name), typeof source === 'function' ? source(dir) : source);
  return { dir, file: join(dir, name) };
}
function run(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (!('NODE_TEST_CONTEXT' in extraEnv)) delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', env, timeout: 60000 });
}
// The variables a vault-bound command hands its children (contextEnv), with every optional binding present: the
// runner must keep all of them from the tests, so this list follows the product code rather than a copy of it.
const VAULT_BINDING = Object.keys(contextEnv({ selected: { id: 'docs', path: join(tmpdir(), 'vault'), selector: 'vault', available: false },
  configPath: join(tmpdir(), 'vaults.json'), repositoryRoot: join(tmpdir(), 'repo') }, {}));
const rootOf = (stdout) => /run-suite: temp root (.+)$/m.exec(stdout)?.[1]?.trim();

test('a passing run that leaks one folder reports it, removes its root and exits 0', (t) => {
  const { dir, file } = fixture(t, 'leak.test.mjs', (d) => `import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('leaks one folder', () => { writeFileSync(${JSON.stringify(join(d, 'where.txt'))}, mkdtempSync(join(tmpdir(), 'wm-leak-'))); });
`);
  const r = run([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /left behind: 1\b/);
  const root = rootOf(r.stdout);
  assert.ok(root, r.stdout);
  assert.match(root.split(/[\\/]/).pop(), /^wm-run-[A-Za-z0-9]{6}$/);
  assert.ok(readFileSync(join(dir, 'where.txt'), 'utf8').startsWith(root), 'the test\'s tmpdir() was inside the run root');
  assert.equal(existsSync(root), false, 'a passing run removes its root');
});

test('a failing run keeps its root, prints its path and exits 1', (t) => {
  const { file } = fixture(t, 'fail.test.mjs', `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('fails', () => { assert.equal(1, 2); });
`);
  const r = run([file]);
  const root = rootOf(r.stdout);
  t.after(() => root && rmSync(root, { recursive: true, force: true }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(root && existsSync(root), 'a failing run keeps its root');
  assert.match(r.stdout, new RegExp(`kept .*${root.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
});

test('imported by another module rather than started, the runner does nothing', (t) => {
  // An empty folder as the working directory: if the guard failed, node --test would find no tests to run here.
  const { dir } = fixture(t, 'empty.txt', '');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(RUNNER).href)});`],
    { encoding: 'utf8', env, cwd: dir, timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, '');
});

test('a node --test killed by a signal exits 128 plus the signal number', { skip: process.platform === 'win32' && 'Windows reports a process killed by another as exit 1, with no signal' }, (t) => {
  // The test file's parent is the node --test process the runner started.
  const { file } = fixture(t, 'kill.test.mjs', `import { test } from 'node:test';
test('stops its runner', () => { process.kill(process.ppid, 'SIGKILL'); });
`);
  const r = run([file]);
  const root = rootOf(r.stdout);
  t.after(() => root && rmSync(root, { recursive: true, force: true }));
  assert.equal(r.status, 128 + 9, r.stdout + r.stderr);
});

test('the tests get a HOME inside the run root and no inherited vault binding, and keep USERPROFILE and the browser guard', (t) => {
  const { dir, file } = fixture(t, 'env.test.mjs', (d) => `import { test } from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
test('records what it sees', () => {
  writeFileSync(${JSON.stringify(join(d, 'seen.json'))}, JSON.stringify({ env: process.env, homedir: homedir(), tmpdir: tmpdir(), homeIsThere: existsSync(process.env.HOME) }));
});
`);
  const machineHome = join(dir, 'machine-home');
  const machineProfile = join(dir, 'machine-profile');
  const inherited = {
    HOME: machineHome, USERPROFILE: machineProfile, XDG_CONFIG_HOME: join(machineHome, '.config'),
    ...Object.fromEntries(VAULT_BINDING.map((name) => [name, join(dir, `machine-${name.toLowerCase()}`)])),
    WIKI_MASTER_BROWSER: join(dir, 'recording-stub.sh'), WIKI_MASTER_BROWSER_RECORD: join(dir, 'browser-launches.txt'),
  };
  assert.deepEqual([...VAULT_BINDING].sort(),
    ['WIKI_MASTER_CONFIG', 'WIKI_MASTER_PROJECT_ROOT', 'WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_ID', 'WIKI_MASTER_VAULT_NAME'],
    'the parent sets every vault binding, the optional ones included');
  const r = run([file], inherited);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const root = rootOf(r.stdout);
  assert.ok(root, r.stdout);
  const seen = JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf8'));
  const home = join(root, 'home');
  assert.equal(seen.env.HOME, home);
  assert.equal(seen.env.USERPROFILE, machineProfile, 'USERPROFILE is left alone: some Windows PDF tools crash without the real profile');
  assert.equal(seen.env.XDG_CONFIG_HOME, join(home, '.config'));
  // Node's os.homedir() reads USERPROFILE on Windows and HOME elsewhere; the registry lookup reads HOME first on both.
  assert.equal(seen.homedir, process.platform === 'win32' ? machineProfile : home);
  assert.ok(seen.homeIsThere, 'the run home exists while the tests run');
  for (const name of VAULT_BINDING) assert.equal(seen.env[name], undefined, `${name} does not reach the tests`);
  assert.equal(seen.env.WIKI_MASTER_BROWSER, inherited.WIKI_MASTER_BROWSER);
  assert.equal(seen.env.WIKI_MASTER_BROWSER_RECORD, inherited.WIKI_MASTER_BROWSER_RECORD);
  assert.equal(seen.tmpdir, root, 'the temp folder is still the run root');
  for (const name of ['APPDATA', 'LOCALAPPDATA']) assert.equal(seen.env[name], process.env[name], `${name} is left alone`);
  assert.match(r.stdout, /left behind: 0\b/, 'the run home is the runner\'s own, not a leftover');
});

test('loaded as a test file by node --test, the runner does nothing', () => {
  const r = run([], { NODE_TEST_CONTEXT: 'child-v8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});
