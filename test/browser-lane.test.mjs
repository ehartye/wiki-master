import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Real-browser tests are a lane of their own, so npm test must never reach a browser. In CI the npm test step points
// WIKI_MASTER_BROWSER at a recording stub and a following step fails on any record. These tests keep that check able
// to fail: GitHub Actions cannot be run from here, and a stub that does not start would record nothing and pass.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = join(ROOT, 'test', 'browser', 'recording-stub.sh');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');

function job(name) {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `no ${name} job`);
  const next = WORKFLOW.slice(start + 1).search(/\n {2}(#|[\w-]+:\n)/);
  return next === -1 ? WORKFLOW.slice(start) : WORKFLOW.slice(start, start + 1 + next);
}

test('without the lane switch every browser test file skips, and none runs', () => {
  const files = readdirSync(join(ROOT, 'test', 'browser')).filter((f) => f.endsWith('.test.mjs')).map((f) => join(ROOT, 'test', 'browser', f));
  assert.ok(files.length >= 1, 'the lane has no tests');
  const env = { ...process.env, WIKI_MASTER_BROWSER: '/no/such/browser' };
  delete env.WIKI_MASTER_BROWSER_TESTS;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ℹ pass 0/);
  assert.match(r.stdout, /ℹ skipped [1-9]/);
});

test('the stub records a launch through the real render path', { skip: process.platform === 'win32' && 'a shell stub cannot start without a shell on Windows' }, () => {
  // The deliberate launch. It has its own record, so the CI check on the suite's record stays empty.
  const dir = mkdtempSync(join(tmpdir(), 'wm-browser-stub-'));
  try {
    const record = join(dir, 'launches.txt');
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'render-page.mjs'), 'http://127.0.0.1:9/never-reached', join(dir, 'out.html')], {
      encoding: 'utf8', env: { ...process.env, WIKI_MASTER_BROWSER: STUB, WIKI_MASTER_BROWSER_RECORD: record },
    });
    assert.equal(r.status, 1, `the render should fail at the launch: ${r.stderr}`);
    assert.match(readFileSync(record, 'utf8'), /--window-position/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the npm test steps run under the stub, and a following step fails on any record', () => {
  for (const name of ['test', 'test-macos']) {
    const steps = job(name);
    const step = /- run: npm test\n\s+env:\n\s+WIKI_MASTER_BROWSER: (.+)\n\s+WIKI_MASTER_BROWSER_RECORD: \$\{\{ runner\.temp \}\}\/(.+)\n/.exec(steps);
    assert.ok(step, `${name}: npm test does not run under the stub`);
    assert.match(step[1], /test\/browser\/recording-stub\.sh$/);
    const after = steps.slice(step.index + step[0].length);
    assert.ok(after.includes(`-s "$RUNNER_TEMP/${step[2]}"`), `${name}: no step checks the record`);
    assert.match(after, /exit 1/);
  }
});

test('the browser lane has its own job: Chromium from the pinned package, under xvfb', () => {
  const steps = job('test-browser');
  assert.match(steps, /runs-on: ubuntu-latest/);
  assert.match(steps, /run: npm ci/);
  assert.match(steps, /npx --no -- playwright-core install --with-deps chromium/);
  assert.match(steps, /WIKI_MASTER_BROWSER=.*executablePath\(\).*"\$GITHUB_ENV"/);
  assert.ok(steps.includes('WIKI_MASTER_BROWSER_TESTS=1 xvfb-run -a node --test "test/browser/*.test.mjs"'));
});
