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

const PORT = process.env.WM_TRIAGE_PORT || 49152 + Math.floor(Math.random() * 16383);
const HOST = process.env.WM_TRIAGE_HOST || '127.0.0.1';
const URL_HOST = process.env.WM_TRIAGE_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
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

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(render());
    return;
  }

  if (req.method === 'POST' && req.url === '/disposition') {
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
      if (!payload.url || !payload.kind || !payload.disposition) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"url, kind and disposition are required"}');
        return;
      }
      const event = {
        t: 'disposition',
        url: payload.url,
        kind: payload.kind,
        disposition: payload.disposition,
        note: payload.note || null,
        at: new Date().toISOString(),
        via: 'triage-ui',
      };
      try {
        fs.mkdirSync(path.dirname(TRIAGE_LOG), { recursive: true });
        fs.appendFileSync(TRIAGE_LOG, JSON.stringify(event) + '\n');
      } catch (e) {
        // Report the failure rather than 200-ing a write that did not happen —
        // the client reverts the row on a non-2xx.
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
        return;
      }
      console.log(JSON.stringify({ type: 'disposition', ...event }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
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

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
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
    server.close(() => process.exit(0));
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
  }, 60 * 1000);
  lifecycle.unref();

  if (ownerPid) {
    try {
      process.kill(ownerPid, 0);
    } catch (e) {
      if (e.code !== 'EPERM') ownerPid = null;
    }
  }

  server.listen(PORT, HOST, () => {
    const info = JSON.stringify({
      type: 'server-started',
      port: Number(PORT),
      host: HOST,
      url: 'http://' + URL_HOST + ':' + PORT,
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
