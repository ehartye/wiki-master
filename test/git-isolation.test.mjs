import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The sync tests build git repositories in temp directories. They must not depend on the machine's git
// configuration or print warnings from it (a global core.autocrlf=true makes git say "LF will be replaced
// by CRLF" on every add, burying a failing test's detail), and they must clean up everything they make.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the sync suite is isolated from a hostile global git config and leaves no temp directory behind', { timeout: 240000 }, (t) => {
  // A home directory whose .gitconfig turns on autocrlf and a hooks path, as a Windows machine often has.
  const home = mkdtempSync(join(tmpdir(), 'wm-hostile-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.config', 'git'), { recursive: true });
  const hostile = '[core]\n\tautocrlf = true\n\tsafecrlf = warn\n';
  writeFileSync(join(home, '.gitconfig'), hostile);
  writeFileSync(join(home, '.config', 'git', 'config'), hostile);

  // A child `node --test` inside a test run inherits NODE_TEST_CONTEXT and then reports to its parent in
  // a binary protocol instead of running as a normal suite: drop it so the output below is the real one.
  // The child also gets its own temp directory, so what it leaves behind is exactly what is in there
  // afterwards (the runner may be running other test files that use the shared temp directory).
  const scratch = join(home, 'tmp');
  mkdirSync(scratch);
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), TMP: scratch, TEMP: scratch, TMPDIR: scratch };
  delete env.NODE_TEST_CONTEXT;
  delete env.GIT_CONFIG_GLOBAL;
  const r = spawnSync(process.execPath, ['--test', join(ROOT, 'test', 'wiki-sync.test.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 220000, env });
  const output = `${r.stdout}\n${r.stderr}`;
  assert.match(output, /# pass \d+|ℹ pass \d+/, `the child did not run as a normal suite:\n${output.slice(-600)}`);
  assert.equal(r.status, 0, `the sync suite failed:\n${output.slice(-1500)}`);
  assert.doesNotMatch(output, /will be replaced by (CRLF|LF)/i, 'a line-ending warning from the machine configuration reached the output');
  assert.deepEqual(readdirSync(scratch), [], 'the suite leaked temp directories');
});
