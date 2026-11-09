import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Branch protection on main requires a check named `test`. GitHub names a job's check after the job, so renaming that
// job, or turning it into a matrix (whose checks are named `test (ubuntu-latest)`), silently leaves the rule waiting for
// a check that never reports. Which checks are required is a repository setting, not something this file can read; see
// the comment above the jobs in the workflow for the command that does.

const WORKFLOW = fileURLToPath(new URL('../.github/workflows/test.yml', import.meta.url));

// The workflow is regular enough to read without a YAML parser: job names sit two spaces in under `jobs:`, and each
// job's `runs-on:`, `matrix:`, `node-version:` and `- run:` lines sit inside its block.
// Returns { name: { runsOn, matrix, nodeVersion, runs } }, with runs in step order.
export function jobsOf(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  assert.ok(start >= 0, 'the workflow has a jobs: section');
  const jobs = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const name = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (name) { current = jobs[name[1]] = { runsOn: null, matrix: false, nodeVersion: null, runs: [] }; continue; }
    if (!current) continue;
    const runsOn = /^ {4}runs-on:\s*(\S+)\s*$/.exec(line);
    if (runsOn) current.runsOn = runsOn[1];
    if (/^ {4,}matrix:/.test(line)) current.matrix = true;
    const node = /^ {8,}node-version:\s*(\S+)\s*$/.exec(line);
    if (node) current.nodeVersion = node[1];
    const run = /^ {6}- run:\s*(.*?)\s*$/.exec(line);
    if (run) current.runs.push(run[1]);
  }
  return jobs;
}

// Branch protection requires `test` alone. The other jobs report but never block a merge; a job added to the workflow
// must be listed in one of the two.
export const REQUIRED_JOBS = ['test'];
export const NON_REQUIRED_JOBS = ['test-macos', 'test-browser', 'test-windows'];

// The Windows job runs the subset that covers the vault walk, the validators and their caches, not the whole suite.
export const WINDOWS_SUBSET = [
  'test/validate-authored.test.mjs', 'test/integrity.test.mjs', 'test/graph.test.mjs', 'test/graph-walk.test.mjs',
  'test/graph-cache.test.mjs', 'test/quote-match.test.mjs', 'test/drift.test.mjs',
];

// What the branch rule and the macOS and Windows gates rely on. Returns the problems found, empty when the workflow is
// as expected.
export function problemsIn(text) {
  const jobs = jobsOf(text);
  const problems = [];
  const expect = (name, runsOn) => {
    if (!jobs[name]) problems.push(`no job named ${name}`);
    else if (jobs[name].runsOn !== runsOn) problems.push(`job ${name} runs on ${jobs[name].runsOn}, not ${runsOn}`);
    else if (jobs[name].matrix) problems.push(`job ${name} is a matrix, which renames its check`);
  };
  expect('test', 'ubuntu-latest');
  expect('test-macos', 'macos-latest');
  expect('test-browser', 'ubuntu-latest');
  expect('test-windows', 'windows-latest');
  const windows = jobs['test-windows'];
  if (windows) {
    if (windows.nodeVersion !== '22') problems.push(`job test-windows uses Node ${windows.nodeVersion}, not 22`);
    const want = ['npm ci', `node --test ${WINDOWS_SUBSET.join(' ')}`];
    if (JSON.stringify(windows.runs) !== JSON.stringify(want)) {
      problems.push(`job test-windows runs ${JSON.stringify(windows.runs)}, not ${JSON.stringify(want)}`);
    }
  }
  for (const name of Object.keys(jobs)) {
    if (!REQUIRED_JOBS.includes(name) && !NON_REQUIRED_JOBS.includes(name)) problems.push(`job ${name} is not listed as required or non-required`);
  }
  return problems;
}

const real = readFileSync(WORKFLOW, 'utf8');

test('the workflow keeps the job `test` on ubuntu, `test-macos` on macOS, `test-windows` on Windows and `test-browser`', () => {
  assert.deepEqual(problemsIn(real), []);
});

test('the check fails on a workflow whose test job was renamed, moved, made a matrix or dropped', () => {
  assert.deepEqual(problemsIn(real.replace(/^ {2}test:\s*$/m, '  unit:')),
    ['no job named test', 'job unit is not listed as required or non-required']);
  assert.deepEqual(problemsIn(real.replace(/^ {2}test-macos:\s*$/m, '  macos:')),
    ['no job named test-macos', 'job macos is not listed as required or non-required']);
  const moved = real.replace(/(^ {2}test:\s*\r?\n {4}runs-on:) ubuntu-latest/m, '$1 macos-latest');
  assert.deepEqual(problemsIn(moved), ['job test runs on macos-latest, not ubuntu-latest']);
  const matrix = real.replace(/(^ {2}test:\s*\r?\n {4}runs-on:) ubuntu-latest/m, '$1 ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest]');
  assert.ok(problemsIn(matrix).length > 0);
  const stripped = real.slice(0, real.search(/^ {2}test-browser:/m));
  assert.deepEqual(problemsIn(stripped), ['no job named test-browser']);
});

test('test-windows is a non-required job on Node 22 that runs npm ci, then node --test on exactly the Windows subset', () => {
  assert.ok(NON_REQUIRED_JOBS.includes('test-windows'));
  assert.ok(!REQUIRED_JOBS.includes('test-windows'));
  const jobs = jobsOf(real);
  assert.equal(jobs['test-windows']?.runsOn, 'windows-latest');
  assert.equal(jobs['test-windows'].nodeVersion, '22');
  assert.deepEqual(jobs['test-windows'].runs, ['npm ci', `node --test ${WINDOWS_SUBSET.join(' ')}`]);
  // Each edit touches the test-windows block alone: the text before it is kept as is.
  const at = real.search(/^ {2}test-windows:/m);
  const edited = (edit) => real.slice(0, at) + edit(real.slice(at));
  assert.deepEqual(problemsIn(edited((b) => b.replace('node-version: 22', 'node-version: 24'))),
    ['job test-windows uses Node 24, not 22']);
  assert.match(problemsIn(edited((b) => b.replace(' test/drift.test.mjs', ''))).join('\n'), /job test-windows runs/);
  assert.match(problemsIn(edited((b) => b.replace(/- run: npm ci\r?\n/, ''))).join('\n'), /job test-windows runs/);
  assert.match(problemsIn(edited((b) => b.replace('node --test test/', 'npm test -- test/'))).join('\n'), /job test-windows runs/);
  assert.deepEqual(problemsIn(edited((b) => b.replace(/^ {2}test-windows:/, '  windows:'))),
    ['no job named test-windows', 'job windows is not listed as required or non-required']);
});

test('the workflow says required checks are a repository setting and names the command that reads them', () => {
  assert.match(real, /repository setting/);
  assert.match(real, /gh api repos\/<owner>\/<repo>\/branches\/main\/protection\/required_status_checks --jq \.contexts/);
  assert.doesNotMatch(real, /not a required check yet/);
});
