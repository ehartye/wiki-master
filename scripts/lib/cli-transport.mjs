import { createServer } from 'node:net';
import { userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const MAX_CLI_REQUEST_BYTES = 2048;
const failure = (message, code) => Object.assign(new Error(message), { code });
const bound = (value, name) => {
  if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) throw failure(`${name} must be a positive finite integer in milliseconds`, 'CLI_OPTIONS');
};

// Conservative envelope estimate, not an assertion about Obsidian's wire limit.
export function validateCliRequest(args, { cwd = process.cwd() } = {}) {
  if (!Array.isArray(args) || !args.length || args.some(a => typeof a !== 'string') || typeof cwd !== 'string') throw failure('Invalid CLI arguments; request not sent', 'CLI_REQUEST');
  const command = args.find(a => !a.startsWith('vault='));
  const label = /^[a-z][a-z0-9:-]*$/i.test(command ?? '') ? command : 'request';
  if ([cwd, ...args].some(a => /[\r\n\0]/.test(a))) throw failure(`CLI ${label} contains a physical newline or NUL; request not sent. Use exact-path filesystem edits for Markdown.`, 'CLI_REQUEST');
  const bytes = Buffer.byteLength(JSON.stringify({ argv: args, tty: false, cwd }) + '\n', 'utf8');
  if (bytes > MAX_CLI_REQUEST_BYTES) throw failure(`CLI ${label} is ${bytes} bytes, exceeding the ${MAX_CLI_REQUEST_BYTES}-byte policy; request not sent. Use exact-path filesystem edits for Markdown or narrow the query.`, 'CLI_REQUEST');
  return bytes;
}

// Stable across HOME overrides, vaults, worktrees and installed plugin versions.
export function lockAddress(identity, platform = process.platform) {
  const user = userInfo();
  const key = identity ?? (platform === 'win32' ? `${user.username}\0${user.homedir.toLowerCase()}` : String(user.uid));
  const hash = createHash('sha256').update(key).digest('hex');
  if (platform === 'win32') return { path: `\\\\.\\pipe\\wiki-master-obsidian-cli-${hash.slice(0, 20)}` };
  if (platform === 'linux') return { path: `\0wiki-master-obsidian-cli-${hash.slice(0, 20)}` };
  // No persistent Unix socket files to reclaim after crashes on other platforms.
  return { host: '127.0.0.1', port: 49152 + parseInt(hash.slice(0, 4), 16) % 16384, exclusive: true };
}

export async function acquireGate(endpoint = lockAddress(), waitTimeout = 10000) {
  bound(waitTimeout, 'Lock wait timeout');
  const deadline = performance.now() + waitTimeout;
  while (true) {
    const server = createServer(socket => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { server.removeListener('listening', ready); reject(error); };
        const ready = () => { server.removeListener('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', ready); server.listen(endpoint);
      });
      return () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw failure(`CLI lock unavailable (${error.code ?? 'error'}); request not sent`, 'CLI_LOCK');
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw failure(`CLI busy after waiting ${waitTimeout}ms; request not sent. Do not bypass the guard.`, 'CLI_BUSY');
      await delay(Math.min(25, remaining));
    }
  }
}

export async function runCli(args, { command = 'obsidian', cwd = process.cwd(), timeout = 10000, waitTimeout = 10000,
  maxBuffer = 32 * 1024 * 1024, endpoint = lockAddress(), execFileImpl = execFile } = {}) {
  validateCliRequest(args, { cwd }); bound(timeout, 'CLI timeout'); bound(waitTimeout, 'Lock wait timeout');
  const release = await acquireGate(endpoint, waitTimeout);
  try {
    return await new Promise((resolve, reject) => execFileImpl(command, args, {
      cwd, encoding: 'utf8', timeout, maxBuffer, windowsHide: true, killSignal: 'SIGKILL',
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const timedOut = error.code === 'ETIMEDOUT' || (error.killed && !error.code);
      const e = failure(timedOut ? `CLI timed out after ${timeout}ms; command outcome may be unknown`
        : `CLI command failed (${error.code ?? error.signal ?? 'error'})`, timedOut ? 'ETIMEDOUT' : error.code ?? 'CLI_FAILED');
      // Do not use execFile's message: it embeds the entire command and note text.
      e.stderr = stderr ?? ''; reject(e);
    }));
  } finally { await release(); }
}

export function guardedExecFile(command, args, options, callback) {
  runCli(args, { ...options, command }).then(stdout => callback(null, stdout, ''), error => callback(error, '', error.stderr ?? ''));
}

export function serializedExecFileSync(command, args, options = {}) {
  const { timeout = 10000, waitTimeout = 10000, maxBuffer = 32 * 1024 * 1024 } = options;
  validateCliRequest(args, options); bound(timeout, 'CLI timeout'); bound(waitTimeout, 'Lock wait timeout');
  let raw;
  try {
    raw = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      input: JSON.stringify({ command, args, options }), encoding: 'utf8', windowsHide: true,
      timeout: Math.min(2_147_483_647, timeout + waitTimeout + 5000), maxBuffer: maxBuffer * 6 + 8192,
    });
  } catch (error) {
    throw failure(`CLI guard worker failed (${error.code ?? error.signal ?? 'error'}); command outcome may be unknown`, error.code ?? 'CLI_WORKER');
  }
  const result = JSON.parse(raw);
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result.stdout;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const { command, args, options } = JSON.parse(input);
    const stdout = await runCli(args, { ...options, command });
    process.stdout.write(JSON.stringify({ ok: true, stdout }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: error.message, code: error.code, stderr: error.stderr } }));
  }
}
