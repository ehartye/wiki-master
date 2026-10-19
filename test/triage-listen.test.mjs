// The triage server picks a random port in 49152-65534 and must survive a pick the OS refuses.
// Measured on Windows (2026-10-18): 716 of those 16,383 ports fail to bind with EACCES (reserved
// ranges and ports held exclusively), and 300 real boots with default selection failed 9 times,
// every one `listen EACCES`. The server used to retry only EADDRINUSE, so about 1 launch in 25
// died, and the auth and handoff test suites failed intermittently with "server never wrote
// server-info" because the test discarded the server's stderr.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { bindWithFallback } = createRequire(import.meta.url)('../scripts/triage-ui/listen.cjs');

// A net.Server stand-in whose listen() outcomes are scripted: a code string fails with that
// error code, null succeeds. Deterministic on every platform.
function fakeServer(outcomes) {
  const server = new EventEmitter();
  server.attempts = [];
  server.listen = (port, host) => {
    server.attempts.push([port, host]);
    const code = outcomes.shift();
    setImmediate(() => (code
      ? server.emit('error', Object.assign(new Error(`listen ${code}`), { code }))
      : server.emit('listening')));
    return server;
  };
  return server;
}

function run(outcomes, options = {}) {
  const server = fakeServer(outcomes);
  let next = 50000;
  return new Promise((resolve) => {
    bindWithFallback(server, {
      host: '127.0.0.1', port: 49999, pickPort: () => ++next,
      onBound: (port) => resolve({ server, bound: port }),
      onFailed: (err) => resolve({ server, failed: err }),
      ...options,
    });
  });
}

test('a port the OS refuses with EACCES is replaced rather than killing the server', async () => {
  const { server, bound, failed } = await run(['EACCES', null]);
  assert.equal(failed, undefined);
  assert.equal(bound, 50001);
  assert.deepEqual(server.attempts.map(([port]) => port), [49999, 50001]);
});

test('a port that is already in use is still replaced', async () => {
  const { server, bound } = await run(['EADDRINUSE', 'EACCES', 'EADDRINUSE', null]);
  assert.equal(bound, 50003);
  assert.equal(server.attempts.length, 4);
});

test('it gives up after maxMoves and reports the last error', async () => {
  const { server, bound, failed } = await run(Array(10).fill('EACCES'), { maxMoves: 3 });
  assert.equal(bound, undefined);
  assert.equal(failed.code, 'EACCES');
  assert.equal(server.attempts.length, 4, 'the first port plus three moves');
});

test('an error that is not about the port fails at once instead of looping', async () => {
  const { server, failed } = await run(['EADDRNOTAVAIL', null]);
  assert.equal(failed.code, 'EADDRNOTAVAIL');
  assert.equal(server.attempts.length, 1);
});

test('a successful first bind never asks for another port', async () => {
  let picks = 0;
  const { bound } = await run([null], { pickPort: () => { picks++; return 1; } });
  assert.equal(bound, 49999);
  assert.equal(picks, 0);
});

// The real server, on a port this machine actually refuses. Windows is where such ports exist, so
// elsewhere this is skipped; the scripted tests above cover the logic on every platform.
async function findRefusedPort() {
  for (let port = 49152; port <= 65534; port++) {
    const code = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', (err) => resolve(err.code));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve('ok')));
    });
    if (code === 'EACCES') return port;
  }
  return null;
}

test('the real server starts when its chosen port is refused with EACCES', async (t) => {
  if (process.platform !== 'win32') return t.skip('EACCES ports are a Windows condition');
  const refused = await findRefusedPort();
  if (refused === null) return t.skip('this host refuses no port in the server range');
  const root = mkdtempSync(join(tmpdir(), 'wm-listen-'));
  const dir = join(root, 'session');
  const vault = join(root, 'vault');
  mkdirSync(join(dir, 'content'), { recursive: true });
  mkdirSync(vault, { recursive: true });
  const server = new URL('../scripts/triage-ui/server.cjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  let stderr = '';
  const proc = spawn(process.execPath, [server], {
    env: { ...process.env, WM_TRIAGE_DIR: dir, WM_TRIAGE_VAULT: vault, WM_TRIAGE_PORT: String(refused) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proc.stderr.on('data', (d) => { stderr += d; });
  t.after(() => { try { proc.kill(); } catch {} try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const info = join(dir, 'state', 'server-info');
  for (let i = 0; i < 100 && !existsSync(info); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(existsSync(info), `server never wrote server-info; stderr: ${stderr.trim()}`);
  assert.notEqual(JSON.parse(readFileSync(info, 'utf8')).port, refused);
});
