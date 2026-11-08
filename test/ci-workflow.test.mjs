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
// job's `runs-on:` and `matrix:` lines sit inside its block. Returns { name: { runsOn, matrix } }.
export function jobsOf(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  assert.ok(start >= 0, 'the workflow has a jobs: section');
  const jobs = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const name = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (name) { current = jobs[name[1]] = { runsOn: null, matrix: false }; continue; }
    if (!current) continue;
    const runsOn = /^ {4}runs-on:\s*(\S+)\s*$/.exec(line);
    if (runsOn) current.runsOn = runsOn[1];
    if (/^ {4,}matrix:/.test(line)) current.matrix = true;
  }
  return jobs;
}

// What the branch rule and the macOS gate rely on. Returns the problems found, empty when the workflow is as expected.
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
  return problems;
}

const real = readFileSync(WORKFLOW, 'utf8');

test('the workflow keeps the job `test` on ubuntu, `test-macos` on macOS and `test-browser`', () => {
  assert.deepEqual(problemsIn(real), []);
});

test('the check fails on a workflow whose test job was renamed, moved, made a matrix or dropped', () => {
  assert.deepEqual(problemsIn(real.replace(/^ {2}test:\s*$/m, '  unit:')), ['no job named test']);
  assert.deepEqual(problemsIn(real.replace(/^ {2}test-macos:\s*$/m, '  macos:')), ['no job named test-macos']);
  const moved = real.replace(/(^ {2}test:\s*\r?\n {4}runs-on:) ubuntu-latest/m, '$1 macos-latest');
  assert.deepEqual(problemsIn(moved), ['job test runs on macos-latest, not ubuntu-latest']);
  const matrix = real.replace(/(^ {2}test:\s*\r?\n {4}runs-on:) ubuntu-latest/m, '$1 ${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest]');
  assert.ok(problemsIn(matrix).length > 0);
  const stripped = real.slice(0, real.search(/^ {2}test-browser:/m));
  assert.deepEqual(problemsIn(stripped), ['no job named test-browser']);
});

test('the workflow says required checks are a repository setting and names the command that reads them', () => {
  assert.match(real, /repository setting/);
  assert.match(real, /gh api repos\/<owner>\/<repo>\/branches\/main\/protection\/required_status_checks --jq \.contexts/);
  assert.doesNotMatch(real, /not a required check yet/);
});
