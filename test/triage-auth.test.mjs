// The triage server is reachable from another machine, so every route that
// reads or writes vault state must prove the caller holds the session token.
// These boot the real server and speak real HTTP: an auth gate asserted by
// grepping the source would pass while the gate was wired up wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';

const SERVER = new URL('../scripts/triage-ui/server.cjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wm-auth-'));
  const dir = join(root, 'session');
  const vault = join(root, 'vault');
  mkdirSync(join(dir, 'content'), { recursive: true });
  mkdirSync(vault, { recursive: true });
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WM_TRIAGE_DIR: dir, WM_TRIAGE_VAULT: vault, ...env },
    stdio: 'ignore',
  });
  proc.unref();
  const infoPath = join(dir, 'state', 'server-info');
  for (let i = 0; i < 100 && !existsSync(infoPath); i++) await sleep(50);
  if (!existsSync(infoPath)) throw new Error('server never wrote server-info');
  const info = JSON.parse(readFileSync(infoPath, 'utf8'));
  const stop = () => { try { proc.kill(); } catch {} try { rmSync(root, { recursive: true, force: true }); } catch {} };
  return { info, dir, vault, root, proc, stop, base: `http://127.0.0.1:${info.port}` };
}

function tokenOf(dir) {
  return readFileSync(join(dir, 'state', 'token'), 'utf8').trim();
}

test('an unauthenticated request for the queue is refused', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const res = await fetch(s.base + '/', { redirect: 'manual' });
  assert.equal(res.status, 401);
  const body = await res.text();
  assert.doesNotMatch(body, /class="issue"/, 'no vault content may leak to an unauthenticated caller');
});

test('healthz answers without a token so liveness checks do not spawn duplicates', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const res = await fetch(s.base + '/healthz');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.doesNotMatch(body, /token/i, 'liveness must not disclose the session token');
});

test('the token in the URL is exchanged for a cookie and redirected away', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const res = await fetch(`${s.base}/?t=${tokenOf(s.dir)}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/', 'the token must not survive in the address bar');
  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie, 'a session cookie is set on exchange');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
});

test('a wrong token is refused and sets no cookie', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const res = await fetch(`${s.base}/?t=${'0'.repeat(32)}`, { redirect: 'manual' });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('the cookie from the exchange authorizes the queue', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const ex = await fetch(`${s.base}/?t=${tokenOf(s.dir)}`, { redirect: 'manual' });
  const cookie = ex.headers.get('set-cookie').split(';')[0];
  const res = await fetch(s.base + '/', { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Waiting for a triage screen|class="issue"|Queue is clear/);
});

test('an unauthenticated disposition is refused and writes nothing', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const res = await fetch(s.base + '/disposition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://evil.test/x', kind: 'fidelity', disposition: 'reclip' }),
  });
  assert.equal(res.status, 401);
  assert.equal(existsSync(join(s.vault, '.wiki-master', 'triage.jsonl')), false,
    'a refused disposition must not reach the triage log');
});

test('an unauthenticated upload is refused and writes no file', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const res = await fetch(s.base + '/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-wm-url': 'https://evil.test/x', 'x-wm-kind': 'fidelity', 'x-wm-filename': 'evil.pdf',
    },
    body: Buffer.from('payload'),
  });
  assert.equal(res.status, 401);
  assert.equal(existsSync(join(s.vault, '.wiki-master', 'triage.jsonl')), false);
});

test('the session token survives a restart so the link keeps working', async (t) => {
  const s = await boot();
  const first = tokenOf(s.dir);
  s.proc.kill();
  await sleep(300);
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WM_TRIAGE_DIR: s.dir, WM_TRIAGE_VAULT: s.vault },
    stdio: 'ignore',
  });
  proc.unref();
  t.after(() => { try { proc.kill(); } catch {} s.stop(); });
  await sleep(1000);
  assert.equal(tokenOf(s.dir), first, 'a regenerated token would silently invalidate the link Claude handed out');
});

test('the generated token is long enough not to be guessable', async (t) => {
  const s = await boot();
  t.after(s.stop);
  assert.match(tokenOf(s.dir), /^[0-9a-f]{32,}$/, 'at least 128 bits of hex');
});

// The live-reload socket is a route like any other: it is what tells a browser
// the queue changed, and an unauthenticated one is a channel into the session.
function handshake(port, cookie) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          (cookie ? 'Cookie: ' + cookie + '\r\n' : '') +
          '\r\n'
      );
    });
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      if (buf.includes('\r\n\r\n')) { sock.destroy(); resolve(buf.split('\r\n')[0]); }
    });
    sock.on('error', reject);
    sock.setTimeout(5000, () => { sock.destroy(); resolve(buf.split('\r\n')[0] || 'NO RESPONSE'); });
  });
}

test('a websocket upgrade without the cookie is refused', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const status = await handshake(s.info.port, null);
  assert.doesNotMatch(status, /101/, 'an unauthenticated socket must not be upgraded');
});

test('a websocket upgrade with the session cookie succeeds', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const ex = await fetch(`${s.base}/?t=${tokenOf(s.dir)}`, { redirect: 'manual' });
  const cookie = ex.headers.get('set-cookie').split(';')[0];
  const status = await handshake(s.info.port, cookie);
  assert.match(status, /101/, 'live reload must still work for an authenticated browser');
});

test('a websocket upgrade with a forged cookie is refused', async (t) => {
  const s = await boot();
  t.after(s.stop);
  const status = await handshake(s.info.port, 'wm_triage=' + '0'.repeat(32));
  assert.doesNotMatch(status, /101/);
});

// ===== Reachability =====
// A cookie is scoped to host:port, so an unstable port silently invalidates the
// session on every restart — the "keep up with it" problem, relocated.

test('by default the server is loopback only', async (t) => {
  const s = await boot();
  t.after(s.stop);
  assert.equal(s.info.host, '127.0.0.1');
  assert.match(s.info.url, /^http:\/\/localhost:\d+$/);
});

test('remote mode binds every interface but never advertises 0.0.0.0', async (t) => {
  const s = await boot({ WM_TRIAGE_REMOTE: '1' });
  t.after(s.stop);
  assert.equal(s.info.host, '0.0.0.0');
  assert.doesNotMatch(s.info.url, /0\.0\.0\.0/, 'no browser can open http://0.0.0.0 — Chrome blocks it outright');
  assert.match(s.info.url, /^http:\/\/[^/]+:\d+$/);
});

test('an explicit advertised host wins over the derived one', async (t) => {
  const s = await boot({ WM_TRIAGE_REMOTE: '1', WM_TRIAGE_URL_HOST: 'wiki.example.ts.net' });
  t.after(s.stop);
  assert.match(s.info.url, /^http:\/\/wiki\.example\.ts\.net:\d+$/);
});

test('the advertised link carries the token so entry is one click', async (t) => {
  const s = await boot();
  t.after(s.stop);
  assert.equal(s.info.link, `${s.info.url}/?t=${tokenOf(s.dir)}`);
  assert.doesNotMatch(s.info.url, /t=/, 'the plain url stays clean for liveness checks');
});

test('the port is stable across restarts so the session cookie survives', async (t) => {
  const s = await boot();
  const first = s.info.port;
  s.proc.kill();
  await sleep(400);
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, WM_TRIAGE_DIR: s.dir, WM_TRIAGE_VAULT: s.vault },
    stdio: 'ignore',
  });
  proc.unref();
  t.after(() => { try { proc.kill(); } catch {} s.stop(); });
  await sleep(1200);
  const info = JSON.parse(readFileSync(join(s.dir, 'state', 'server-info'), 'utf8'));
  assert.equal(info.port, first, 'a new port would scope the cookie to a new origin');
});

test('a port already taken is replaced rather than crashing the server', async (t) => {
  const squatter = net.createServer(() => {});
  await new Promise((r) => squatter.listen(0, '127.0.0.1', r));
  const taken = squatter.address().port;
  t.after(() => squatter.close());

  const s = await boot({ WM_TRIAGE_PORT: String(taken) });
  t.after(s.stop);
  assert.notEqual(s.info.port, taken, 'the server must move rather than die on EADDRINUSE');
  const res = await fetch(`http://127.0.0.1:${s.info.port}/healthz`);
  assert.equal(res.status, 200);
});

// ===== The two defects that only show up off-machine =====

import vm from 'node:vm';

// Runs the real client script against a stubbed DOM and reports the URL it
// hands to WebSocket. Asserting on the source text would pass for a file that
// merely mentions wss:// somewhere.
function socketUrlFor(protocol, host) {
  const src = readFileSync(new URL('../scripts/triage-ui/helper.js', import.meta.url), 'utf8');
  let asked = null;
  const el = () => ({
    setAttribute() {}, getAttribute: () => null, classList: { add() {}, remove() {}, toggle() {} },
    querySelector: () => null, querySelectorAll: () => [], style: {}, dataset: {}, textContent: '',
  });
  const sandbox = {
    location: { protocol, host },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      documentElement: el(), addEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    },
    setTimeout() {}, clearTimeout() {}, console,
    WebSocket: function (u) { asked = u; this.close = () => {}; },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return asked;
}

test('the live-reload socket follows the page protocol', () => {
  assert.equal(socketUrlFor('http:', 'box:5000'), 'ws://box:5000');
  assert.equal(
    socketUrlFor('https:', 'wiki.example.ts.net'),
    'wss://wiki.example.ts.net',
    'a hardcoded ws:// is blocked as mixed content behind any HTTPS front, killing live reload silently'
  );
});

test('an idle shutdown exits even with a browser still connected', async (t) => {
  const s = await boot({ WM_TRIAGE_IDLE_MS: '1000' });
  t.after(s.stop);
  const ex = await fetch(`${s.base}/?t=${tokenOf(s.dir)}`, { redirect: 'manual' });
  const cookie = ex.headers.get('set-cookie').split(';')[0];

  // Hold a live-reload socket open, exactly as a tab left open on a laptop does.
  const sock = net.connect(s.info.port, '127.0.0.1', () => {
    sock.write(
      'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
        'Sec-WebSocket-Version: 13\r\nCookie: ' + cookie + '\r\n\r\n'
    );
  });
  sock.on('data', () => {});
  sock.on('error', () => {});
  t.after(() => sock.destroy());

  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 12000);
    s.proc.on('exit', () => { clearTimeout(timer); resolve(true); });
  });
  assert.equal(exited, true,
    'server.close() never calls back while a websocket is open, so the process lingers holding the port and refusing new connections while the page still shows itself connected');
});

test('the frame sends no referrer, so a token in the URL cannot leak outward', () => {
  const html = readFileSync(new URL('../scripts/triage-ui/frame-template.html', import.meta.url), 'utf8');
  assert.match(html, /<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/i,
    'the page loads Google Fonts and links out to triage sources; the modern default hides the query string, but that default must not be the only thing standing between the token and a third party');
});
