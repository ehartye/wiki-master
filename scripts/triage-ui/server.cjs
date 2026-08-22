// Triage UI server for wiki-master.
//
// Serves the newest generated screen from CONTENT_DIR, wrapped in the vendored
// theme frame, and accepts disposition POSTs which it appends to the vault's
// triage.jsonl. Dependency-free by design: this ships inside a plugin and must
// not require an install step.
//
// WebSocket framing below is adapted from h-superpowers' brainstorming companion
// (same author, same theme) — vendored rather than imported because that plugin's
// cache path is version-pinned and wiki-master must work without it installed.

const crypto = require('crypto');
const os = require('os');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== WebSocket (RFC 6455, text frames only) ==========

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0a };
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

function encodeFrame(opcode, payload) {
  const fin = 0x80;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const secondByte = buffer[1];
  const opcode = buffer[0] & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;
  let offset = 2;
  if (!masked) throw new Error('Client frames must be masked');
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const dataOffset = offset + 4;
  const totalLen = dataOffset + payloadLen;
  if (buffer.length < totalLen) return null;
  const mask = buffer.slice(offset, dataOffset);
  const data = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) data[i] = buffer[dataOffset + i] ^ mask[i % 4];
  return { opcode, payload: data, bytesConsumed: totalLen };
}

// ========== Configuration ==========

// Remote is opt-in. Binding every interface is a change in exposure, and it
// should never happen because a machine merely had an env var lying around.
const REMOTE = process.argv.includes('--remote') || process.env.WM_TRIAGE_REMOTE === '1';
const HOST = process.env.WM_TRIAGE_HOST || (REMOTE ? '0.0.0.0' : '127.0.0.1');

// http://0.0.0.0 is not an address a browser can open — Chrome blocks it
// outright — so a wildcard bind must advertise something reachable instead of
// echoing back the bind address.
function advertisedHost(bind) {
  if (bind === '127.0.0.1' || bind === '::1') return 'localhost';
  if (bind !== '0.0.0.0' && bind !== '::') return bind;
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const ni of iface || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return os.hostname();
}
const URL_HOST = process.env.WM_TRIAGE_URL_HOST || advertisedHost(HOST);

const SESSION_DIR = process.env.WM_TRIAGE_DIR;
const VAULT_PATH = process.env.WM_TRIAGE_VAULT;
let ownerPid = process.env.WM_TRIAGE_OWNER_PID ? Number(process.env.WM_TRIAGE_OWNER_PID) : null;

if (!SESSION_DIR || !VAULT_PATH) {
  console.error('WM_TRIAGE_DIR and WM_TRIAGE_VAULT are required');
  process.exit(2);
}

const CONTENT_DIR = path.join(SESSION_DIR, 'content');
const STATE_DIR = path.join(SESSION_DIR, 'state');
const TRIAGE_LOG = path.join(VAULT_PATH, '.wiki-master', 'triage.jsonl');

// ========== Session token ==========
//
// The terminal Claude is already talking to you in is an authenticated channel,
// so the credential is delivered there rather than being a password you keep. It
// lives beside server-info in the gitignored state dir, and it is STABLE across
// restarts on purpose: regenerating it would silently invalidate the link the
// user was handed, which is the very problem this is meant to avoid.
//
// 128 bits is what lets the login be a link rather than a form. A short PIN would
// need a rate limiter, a lockout table and per-IP attempt state to survive being
// reachable from another machine; entropy removes all of that machinery.
const COOKIE = 'wm_triage';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

function sessionToken() {
  const f = path.join(STATE_DIR, 'token');
  try {
    const existing = fs.readFileSync(f, 'utf-8').trim();
    if (/^[0-9a-f]{32,}$/.test(existing)) return existing;
  } catch (e) {
    // First run for this vault.
  }
  const t = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(f, t + '\n', { mode: 0o600 });
  return t;
}

const TOKEN = sessionToken();

// The session cookie is scoped to host:port, so a fresh random port on every
// start would invalidate it silently and demand a new handshake each run. The
// port that worked is remembered beside the token and reused.
function randomPort() {
  return 49152 + crypto.randomInt(16383);
}

function rememberedPort() {
  if (process.env.WM_TRIAGE_PORT) return Number(process.env.WM_TRIAGE_PORT);
  try {
    const n = Number(fs.readFileSync(path.join(STATE_DIR, 'port'), 'utf-8').trim());
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  } catch (e) {
    // First run for this vault.
  }
  return randomPort();
}

function rememberPort(n) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, 'port'), String(n) + '\n');
}

// Length is checked first because timingSafeEqual throws on a length mismatch,
// and that throw would itself be the timing signal the call exists to remove.
function sameToken(candidate) {
  if (typeof candidate !== 'string' || candidate.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(TOKEN));
}

function cookieToken(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

function authed(req) {
  const c = cookieToken(req);
  return c === null ? false : sameToken(c);
}

function deny(res) {
  res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Unauthorized. Open the link wiki-master printed in your terminal.\n');
}

// Read per request, not once at startup. A long-lived server that cached these
// would keep serving the theme and client JS it booted with, so an edit to either
// would appear to have no effect — you would be debugging code the browser never
// received. These are small local files; the read cost is irrelevant next to that
// failure mode.
function frameTemplate() {
  return fs.readFileSync(path.join(__dirname, 'frame-template.html'), 'utf-8');
}
function helperInjection() {
  return '<script>\n' + fs.readFileSync(path.join(__dirname, 'helper.js'), 'utf-8') + '\n</script>';
}

const WAITING = `<div class="empty"><div class="big">Waiting for a triage screen…</div>
<div>Run <code>/wiki-triage</code> in Claude Code.</div></div>`;

// ========== HTTP ==========

function newestScreen() {
  if (!fs.existsSync(CONTENT_DIR)) return null;
  const files = fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => {
      const fp = path.join(CONTENT_DIR, f);
      return { path: fp, mtime: fs.statSync(fp).mtime.getTime() };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].path : null;
}

function render() {
  const f = newestScreen();
  const content = f ? fs.readFileSync(f, 'utf-8') : WAITING;
  const html = frameTemplate().replace('<!-- CONTENT -->', content);
  return html.replace('</body>', helperInjection() + '\n</body>');
}

function handleRequest(req, res) {
  touchActivity();

  // Unauthenticated by design, and deliberately contentless: triage.mjs uses this
  // to decide whether a server is already up. Gating it would make every liveness
  // check read as "dead" and spawn a duplicate server on every run.
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok\n');
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    // A token arriving in the query is traded for a cookie and redirected away,
    // so the credential does not linger in the address bar, in a bookmark, or in
    // a screenshot of the browser. The clean '/' is what survives in history.
    const offered = new URL(req.url, 'http://placeholder').searchParams.get('t');
    if (offered !== null) {
      if (!sameToken(offered)) return deny(res);
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': `${COOKIE}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
      });
      res.end();
      return;
    }
    if (!authed(req)) return deny(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(render());
    return;
  }

  // A paywalled source is fetched by hand, and the browser will not disclose the
  // picked file's path (by design), so "browse" uploads the bytes to this local
  // server instead. They land OUTSIDE the vault — a binary is never vault content
  // — and the saved path rides along in the disposition's note, so the re-clip
  // needs no filename or title matching at all.
  if (req.method === 'POST' && req.url === '/upload') {
    // Refuse before a single byte is read: an unauthenticated caller must not be
    // able to spend 256MB of disk on its way to being rejected.
    if (!authed(req)) return deny(res);
    const url = req.headers['x-wm-url'];
    const kind = req.headers['x-wm-kind'];
    const name = path.basename(String(req.headers['x-wm-filename'] || 'source')).replace(/[^\w.\-]+/g, '_');
    if (!url || !kind) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"upload needs x-wm-url and x-wm-kind"}');
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 256 * 1024 * 1024) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const dir = path.join(os.tmpdir(), 'wiki-master-uploads');
        fs.mkdirSync(dir, { recursive: true });
        const saved = path.join(dir, `${Date.now()}-${name}`);
        fs.writeFileSync(saved, Buffer.concat(chunks));
        const event = {
          t: 'disposition', url: String(url), kind: String(kind),
          disposition: 'downloaded', note: saved,
          at: new Date().toISOString(), via: 'triage-ui',
        };
        fs.mkdirSync(path.dirname(TRIAGE_LOG), { recursive: true });
        fs.appendFileSync(TRIAGE_LOG, JSON.stringify(event) + '\n');
        console.log(JSON.stringify({ type: 'upload', saved, bytes: size }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saved }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/disposition') {
    if (!authed(req)) return deny(res);
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"bad json"}');
        return;
      }
      // Accepts one disposition or a batch. A bulk apply is a single request and
      // a single append, so it cannot half-succeed and leave the UI showing rows
      // as handled that were never recorded.
      const items = Array.isArray(payload.items) ? payload.items : [payload];
      const at = new Date().toISOString();
      const events = [];
      for (const it of items) {
        if (!it || !it.url || !it.kind || !it.disposition) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"each item needs url, kind and disposition"}');
          return;
        }
        events.push({
          t: 'disposition',
          url: it.url,
          kind: it.kind,
          disposition: it.disposition,
          note: it.note || null,
          at,
          via: 'triage-ui',
        });
      }
      try {
        fs.mkdirSync(path.dirname(TRIAGE_LOG), { recursive: true });
        fs.appendFileSync(TRIAGE_LOG, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      } catch (e) {
        // Report the failure rather than 200-ing a write that did not happen —
        // the client reverts the rows on a non-2xx.
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
        return;
      }
      console.log(JSON.stringify({ type: 'disposition', count: events.length }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: events.length }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
}

// ========== WebSocket clients ==========

const clients = new Set();

function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  // The handshake is an ordinary HTTP request, so the session cookie rides along
  // on a same-origin ws:// connection and is checked exactly like every other
  // route. Without this the live-reload socket is an unauthenticated way into
  // the session even while the HTTP routes are gated.
  if (!authed(req)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' +
      computeAcceptKey(key) +
      '\r\n\r\n'
  );

  let buffer = Buffer.alloc(0);
  clients.add(socket);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      let result;
      try {
        result = decodeFrame(buffer);
      } catch (e) {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        clients.delete(socket);
        return;
      }
      if (!result) break;
      buffer = buffer.slice(result.bytesConsumed);
      if (result.opcode === OPCODES.CLOSE) {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        clients.delete(socket);
        return;
      }
      if (result.opcode === OPCODES.PING) socket.write(encodeFrame(OPCODES.PONG, result.payload));
    }
  });

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

function broadcast(msg) {
  const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(msg)));
  for (const socket of clients) {
    try {
      socket.write(frame);
    } catch (e) {
      clients.delete(socket);
    }
  }
}

// ========== Lifecycle ==========

const IDLE_TIMEOUT_MS = Number(process.env.WM_TRIAGE_IDLE_MS) || 30 * 60 * 1000;
// The idle check cannot be slower than the timeout it enforces, or a short
// timeout would never be observed before the next poll.
const LIFECYCLE_MS = Math.min(60 * 1000, Math.max(250, Math.floor(IDLE_TIMEOUT_MS / 4)));
let lastActivity = Date.now();
function touchActivity() {
  lastActivity = Date.now();
}

function startServer() {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);

  const timers = new Map();
  const watcher = fs.watch(CONTENT_DIR, (_evt, filename) => {
    if (!filename || !filename.endsWith('.html')) return;
    if (timers.has(filename)) clearTimeout(timers.get(filename));
    timers.set(
      filename,
      setTimeout(() => {
        timers.delete(filename);
        if (!fs.existsSync(path.join(CONTENT_DIR, filename))) return;
        touchActivity();
        broadcast({ type: 'reload' });
      }, 100)
    );
  });
  watcher.on('error', (err) => console.error('fs.watch error:', err.message));

  function shutdown(reason) {
    console.log(JSON.stringify({ type: 'server-stopped', reason }));
    const info = path.join(STATE_DIR, 'server-info');
    if (fs.existsSync(info)) fs.unlinkSync(info);
    fs.writeFileSync(
      path.join(STATE_DIR, 'server-stopped'),
      JSON.stringify({ reason, timestamp: Date.now() }) + '\n'
    );
    watcher.close();
    clearInterval(lifecycle);

    // Close the live-reload sockets before closing the server. server.close()
    // waits for open connections to end, and a WebSocket never ends on its own —
    // so with a browser tab still open the callback never fired, the process
    // lingered holding the port, and it went on refusing every new connection
    // while the page still showed itself connected. That is the likeliest state
    // for a remote tab, which has no HTTP traffic to keep the server alive.
    for (const socket of clients) {
      try {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        socket.destroy();
      } catch (e) {
        // Already gone.
      }
    }
    clients.clear();

    server.close(() => process.exit(0));
    // Never outlive the decision to stop, whatever else is holding a socket.
    setTimeout(() => process.exit(0), 2000).unref();
  }

  function ownerAlive() {
    if (!ownerPid) return true;
    try {
      process.kill(ownerPid, 0);
      return true;
    } catch (e) {
      return e.code === 'EPERM';
    }
  }

  const lifecycle = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, LIFECYCLE_MS);
  lifecycle.unref();

  if (ownerPid) {
    try {
      process.kill(ownerPid, 0);
    } catch (e) {
      if (e.code !== 'EPERM') ownerPid = null;
    }
  }

  // A remembered port can be taken by anything — another vault's server, or an
  // unrelated process that grabbed it while we were down. Moving is always
  // better than dying: the link is reprintable, the port is not load-bearing.
  let port = rememberedPort();
  let moves = 0;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && moves < 10) {
      moves++;
      port = randomPort();
      server.listen(port, HOST);
      return;
    }
    console.error(JSON.stringify({ type: 'listen-failed', error: err.message }));
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    rememberPort(port);
    const url = 'http://' + URL_HOST + ':' + port;
    const info = JSON.stringify({
      type: 'server-started',
      port,
      host: HOST,
      remote: REMOTE,
      // `url` stays clean so liveness checks and logs carry no credential;
      // `link` is the one-click entry point Claude hands to the user.
      url,
      link: url + '/?t=' + TOKEN,
      screen_dir: CONTENT_DIR,
      state_dir: STATE_DIR,
      vault: VAULT_PATH,
    });
    console.log(info);
    fs.writeFileSync(path.join(STATE_DIR, 'server-info'), info + '\n');
  });
}

if (require.main === module) startServer();

module.exports = { computeAcceptKey, encodeFrame, decodeFrame, OPCODES };
