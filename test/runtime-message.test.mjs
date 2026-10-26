import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeUnavailableMessage, extractionRuntime } from '../scripts/lib/html-extract.mjs';

// In a checkout with no node_modules the extraction tests failed with "run through the pinned npm exec launcher",
// which sends a developer the wrong way: the fix there is `npm ci`. An installed copy keeps the launcher message.

const LAUNCHER = 'HTML extraction runtime unavailable; run through the pinned npm exec launcher';

function root(t, { git }) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-runtime-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (git === 'dir') mkdirSync(join(dir, '.git'));
  if (git === 'file') writeFileSync(join(dir, '.git'), 'gitdir: ../elsewhere\n'); // a worktree has a .git file
  return dir;
}

test('a development checkout (a .git directory, or the .git file of a worktree) is told to run npm ci', (t) => {
  for (const git of ['dir', 'file']) {
    const message = runtimeUnavailableMessage(root(t, { git }));
    assert.match(message, /npm ci/);
    assert.match(message, /development checkout/);
  }
});

test('an installed copy keeps the launcher message exactly', (t) => {
  assert.equal(runtimeUnavailableMessage(root(t, { git: 'none' })), LAUNCHER);
});

test('when the runtime is present extractionRuntime returns it, and the message is only for its absence', () => {
  // This checkout has its dependencies (npm ci ran before the suite), so the runtime resolves.
  const runtime = extractionRuntime();
  assert.equal(typeof runtime.parseHTML, 'function');
});
