// triage.mjs decides whether a server is already up and hands the user the way
// in. With the routes gated, a liveness probe against '/' reads 401 as "dead"
// and spawns a duplicate on every run — so this exercises the real script.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TRIAGE = new URL('../scripts/triage.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function runTriage(vault, args = []) {
  const out = execFileSync(process.execPath, [TRIAGE, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      WIKI_MASTER_VAULT: vault,
      // Any server this leaves behind reaps itself shortly after the test.
      WM_TRIAGE_IDLE_MS: '8000',
    },
  });
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
  return JSON.parse(line);
}

function freshVault(t) {
  const v = mkdtempSync(join(tmpdir(), 'wm-handoff-'));
  t.after(() => { try { rmSync(v, { recursive: true, force: true }); } catch {} });
  return v;
}

test('the queue is handed over as a link that carries the token', (t) => {
  const vault = freshVault(t);
  const res = runTriage(vault);
  assert.equal(res.type, 'triage-ready');
  assert.match(res.link, /^http:\/\/[^/]+:\d+\/\?t=[0-9a-f]{32,}$/,
    'the user must get a one-click way in, not a bare URL they cannot open');
});

test('a second run reuses the running server instead of spawning another', (t) => {
  const vault = freshVault(t);
  const first = runTriage(vault);
  const second = runTriage(vault);
  assert.equal(second.link, first.link,
    'probing the gated "/" would read 401 as dead and start a duplicate server every run');
});

test('remote mode is carried through to the server', (t) => {
  const vault = freshVault(t);
  runTriage(vault, ['--remote']);
  const info = JSON.parse(
    readFileSync(join(vault, '.wiki-master', 'triage-ui', 'state', 'server-info'), 'utf8')
  );
  assert.equal(info.remote, true);
  assert.equal(info.host, '0.0.0.0');
  assert.doesNotMatch(info.url, /0\.0\.0\.0/);
});
