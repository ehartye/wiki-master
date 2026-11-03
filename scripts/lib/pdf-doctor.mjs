// Doctor-only probes. Runtime extraction and its version gate remain unchanged.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, openSync, readSync, closeSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { pdftotextCapabilities, dependencyReport } from './pdf-extract.mjs';
import { resolveFigureTools } from './pdf-figures.mjs';

const OUTPUT_LIMIT = 64 * 1024;
// Reserve time inside each probe deadline for terminating its tree. On Windows,
// taskkill must see the live parent to find even detached descendants. POSIX
// probes own a process group; a bounded descendant snapshot also catches a
// child that has detached into another group before termination.
function runOwnedProcess(command, args, options) {
  return new Promise(resolve => {
    const started = performance.now();
    // Tree enumeration can be slower than the converter under concurrent load.
    // Keep half the same deadline for termination rather than extending it.
    const reserve = Math.max(50, Math.floor(options.timeout / 2));
    let child, timer, hardTimer, error, termination, finished = false;
    const chunks = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0 };
    const finish = (status, signal) => {
      if (finished) return; finished = true; clearTimeout(timer); clearTimeout(hardTimer);
      resolve({ status, signal, pid: child?.pid, error, termination,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'), stderr: Buffer.concat(chunks.stderr).toString('utf8') });
    };
    const stop = code => {
      if (error) return;
      error = { code };
      const remaining = Math.max(1, Math.floor(options.timeout - (performance.now() - started)));
      if (child?.pid) {
        if (process.platform === 'win32') {
          const taskkill = join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe');
          const killed = spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
            timeout: remaining, killSignal: 'SIGKILL', maxBuffer: OUTPUT_LIMIT,
            encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          });
          termination = { method: 'taskkill /T /F', outcome: killed.status === 0 ? 'passed' : 'unusable', status: killed.status, code: killed.error?.code ?? null };
        } else {
          const snapshot = spawnSync('/bin/ps', ['-eo', 'pid=,ppid='], {
            timeout: remaining, killSignal: 'SIGKILL', maxBuffer: OUTPUT_LIMIT,
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          });
          const descendants = [];
          if (snapshot.status === 0) {
            const rows = snapshot.stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
            const visit = parent => {
              for (const [pid, ppid] of rows) if (ppid === parent && pid !== parent) { visit(pid); descendants.push(pid); }
            };
            visit(child.pid);
          }
          termination = { method: 'descendant and process-group SIGKILL', outcome: snapshot.status === 0 ? 'passed' : 'unusable', code: snapshot.error?.code ?? null };
          for (const pid of descendants) {
            try { process.kill(pid, 'SIGKILL'); }
            catch (e) { if (e.code !== 'ESRCH') termination = { ...termination, outcome: 'unusable', code: e.code }; }
          }
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch (e) { if (e.code !== 'ESRCH') termination = { ...termination, outcome: 'unusable', code: e.code }; }
        }
        if (termination.outcome !== 'passed') child.kill('SIGKILL');
      }
    };
    try { child = spawn(command, args, { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { error = e; finish(null, null); return; }
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      const available = Math.max(0, OUTPUT_LIMIT - sizes[stream]);
      if (available) chunks[stream].push(chunk.subarray(0, available));
      sizes[stream] += chunk.length;
      if (sizes.stdout + sizes.stderr > OUTPUT_LIMIT) stop('ENOBUFS');
    });
    child.on('error', e => { error = e; });
    child.on('close', (status, signal) => finish(status, signal));
    timer = setTimeout(() => stop('ETIMEDOUT'), Math.max(1, options.timeout - reserve));
    hardTimer = setTimeout(() => {
      stop('ETIMEDOUT');
      // A failed tree termination is explicit, and forbids fixture deletion.
      termination = { ...(termination || {}), outcome: 'unusable', reason: 'process closure not confirmed within deadline' };
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      finish(null, null);
    }, options.timeout);
  });
}

export function createProbeRunner({ run = runOwnedProcess, now = () => performance.now(), perProcessMs = 5000, totalMs = 30000 } = {}) {
  let spent = 0;
  let terminationFailed = false;
  return async (command, args) => {
    const timeout = Math.floor(Math.min(5000, perProcessMs, Math.min(30000, totalMs) - spent));
    const base = { command, args, identity: isAbsolute(command) ? command : null,
      identityLimitation: isAbsolute(command) ? null : 'Literal runtime invocation; resolved executable identity not established.' };
    if (timeout <= 0 || terminationFailed) return { ...base, outcome: 'not-exercised', reason: terminationFailed ? 'prior process-tree termination could not be confirmed' : 'combined diagnostic subprocess budget exhausted', status: null, signal: null, stdout: '', stderr: '' };
    const started = now();
    let result;
    try {
      result = await run(command, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: OUTPUT_LIMIT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { result = { error, status: error.status, signal: error.signal, stdout: error.stdout, stderr: error.stderr }; }
    spent += Math.max(0, now() - started);
    if (result.termination?.outcome === 'unusable') terminationFailed = true;
    const code = result.error?.code;
    const outcome = code === 'ENOENT' ? 'missing' : code === 'ETIMEDOUT' ? 'timeout'
      : code || result.status !== 0 ? 'unusable' : 'passed';
    return { ...base, outcome, status: result.status ?? null, signal: result.signal ?? null,
      pid: result.pid ?? null, ...(code ? { code } : {}),
      ...(result.termination ? { termination: result.termination } : {}),
      ...(outcome !== 'passed' ? { reason: code || `process exited ${result.status ?? result.signal ?? 'without status'}` } : {}),
      stdout: String(result.stdout || '').slice(0, OUTPUT_LIMIT), stderr: String(result.stderr || '').slice(0, OUTPUT_LIMIT) };
  };
}

export function syntheticPdf() {
  const stream = '0 0 0 rg 5 5 20 20 re f\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let text = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

function pngHeader(path) {
  let fd;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    fd = openSync(path, 'r'); const b = Buffer.alloc(33);
    if (readSync(fd, b, 0, b.length, 0) !== b.length || !b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
        b.readUInt32BE(8) !== 13 || b.toString('ascii', 12, 16) !== 'IHDR' || !b.readUInt32BE(16) || !b.readUInt32BE(20)) return null;
    const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!depths[b[25]]?.includes(b[24]) || b[26] !== 0 || b[27] !== 0 || b[28] > 1) return null;
    if (b.readUInt32BE(16) > 0x7fffffff || b.readUInt32BE(20) > 0x7fffffff) return null;
    let crc = 0xffffffff;
    for (const byte of b.subarray(12, 29)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== b.readUInt32BE(29)) return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch { return null; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export async function diagnosePdf({ run, now, tempRoot = tmpdir(), cleanup = dir => rmSync(dir, { recursive: true, force: true }), figureOptions = {} } = {}) {
  const probe = createProbeRunner({ run, now });
  const versions = new Map();
  const version = async (cmd, args) => {
    const key = JSON.stringify([cmd, args]);
    if (!versions.has(key)) versions.set(key, await probe(cmd, args));
    return versions.get(key);
  };
  const textProbes = [await version('pdftotext', ['-h']), await version('pdftotext', ['-v'])];
  const text = pdftotextCapabilities({ probe: flag => textProbes[flag === '-h' ? 0 : 1] });
  const ppm = await version('pdftoppm', ['-v']);
  const tess = await version('tesseract', ['--version']);
  // Replay the existing synchronous selection policy against cached bounded
  // results. Each pass collects only its next unknown commands; no resolver
  // subprocess ever runs outside the shared async budget.
  let tools;
  while (true) {
    const pending = new Map();
    tools = resolveFigureTools({ ...figureOptions, run: (cmd, args) => {
      const key = JSON.stringify([cmd, args]); const r = versions.get(key);
      if (!r) { pending.set(key, [cmd, args]); throw Object.assign(new Error('pending probe'), { code: 'PENDING' }); }
      if (r.outcome !== 'passed') throw Object.assign(new Error(r.reason), { code: r.code || 'PROBE_FAILED' });
      return r.stdout;
    } });
    if (!pending.size) break;
    for (const [cmd, args] of pending.values()) await version(cmd, args);
  }
  // Legacy presence regards non-ENOENT failures as installed, as before. This
  // summary deliberately makes no claim about the raster contracts below.
  const deps = dependencyReport({ pdftotext: text.flavor !== 'unknown', table: text.table,
    pdftoppm: ppm.outcome !== 'missing', tesseract: tess.outcome !== 'missing' });
  const result = { status: 'doctor', ok: deps.ok, missing: deps.missing, capabilities: {
    text: { ...text, command: 'pdftotext', tableRowsVerified: false, probes: textProbes },
    ocrRuntimeGate: { allowed: ppm.outcome === 'passed' && tess.outcome === 'passed', reason: 'Unchanged runtime gate requires successful pdftoppm -v and tesseract --version.', probes: [ppm, tess] },
    ocrRecognition: { outcome: 'not-exercised', reason: 'Tesseract version is a prerequisite; recognition and accuracy are not tested.', prerequisite: tess },
    figureDetection: { outcome: 'not-exercised', reason: 'Automatic figure selection and page counting are not tested.', prerequisites: Object.fromEntries(['pdfimages', 'pdftocairo', 'pdfinfo'].map(n => [n, tools[n] ? versions.get(JSON.stringify([tools[n], ['-v']])) : { command: n, outcome: 'missing' }])) },
  } };
  const dir = mkdtempSync(join(tempRoot, 'clip-pdf-doctor-'));
  try {
    const pdf = join(dir, 'fixture.pdf'); writeFileSync(pdf, syntheticPdf());
    const raster = async (kind, command, flags, suffix) => {
      const outputDir = join(dir, kind); mkdirSync(outputDir);
      const prefix = join(outputDir, 'page'); const output = `${prefix}${suffix}.png`;
      const args = [...flags, pdf, prefix];
      const r = command ? await probe(command, args) : { command: 'pdftoppm', args, outcome: 'missing', status: null, signal: null, reason: 'runtime figure renderer not found' };
      const contract = { output, signature: 'PNG', header: 'IHDR', positiveDimensions: true };
      if (r.outcome !== 'passed') return { ...r, contract };
      const dimensions = pngHeader(output);
      return dimensions ? { ...r, contract, dimensions } : { ...r, contract, outcome: 'invalid-output', reason: 'expected new PNG with a valid header and positive dimensions was not produced' };
    };
    result.capabilities.ocrRaster = await raster('ocr', 'pdftoppm', ['-png', '-r', '300'], '-1');
    result.capabilities.figureRaster = await raster('figures', tools.pdftoppm, ['-r', '200', '-png', '-f', '1', '-l', '1', '-singlefile'], '');
  } finally {
    const failedTermination = [...versions.values(), result.capabilities.ocrRaster, result.capabilities.figureRaster].some(p => p?.termination?.outcome === 'unusable');
    try {
      if (failedTermination) result.cleanup = { outcome: 'not-exercised', directory: dir, reason: 'process-tree termination unconfirmed; fixture retained' };
      else { cleanup(dir); result.cleanup = { outcome: 'passed' }; }
    }
    catch (error) { result.cleanup = { outcome: 'unusable', code: error.code || 'IO', directory: dir, reason: 'owned diagnostic temporary directory could not be removed' }; }
  }
  return result;
}

export function formatPdfDoctor(result) {
  const c = result.capabilities;
  return [
    `clip-pdf legacy dependency-only summary: ok=${result.ok}; missing=${result.missing.join(', ') || 'none'} (not rendering readiness)`,
    `text: ${c.text.flavor}; -table advertised=${c.text.table}; table rows not verified`,
    ...c.text.probes.map(p => `  pdftotext ${p.args[0]}: ${p.outcome}; exit=${p.status}; signal=${p.signal}`),
    ...['ocrRaster', 'figureRaster'].flatMap(key => {
      const r = c[key];
      return [`${key}: ${r.outcome}${r.reason ? ` (${r.reason})` : ''}`, `  command: ${JSON.stringify(r.command)} ${r.args.map(a => JSON.stringify(a)).join(' ')}`, `  identity: ${r.identity || r.identityLimitation || 'not resolved'}`, `  exit: ${r.status}; signal: ${r.signal}; output contract: PNG IHDR with positive dimensions`, ...(r.termination ? [`  process-tree termination: ${r.termination.outcome} (${r.termination.method || r.termination.reason})`] : [])];
    }),
    `runtime OCR version gate: ${c.ocrRuntimeGate.allowed ? 'allowed' : 'refused'} (unchanged; not recognition)`,
    ...c.ocrRuntimeGate.probes.map(p => `  ${p.command} version/presence: ${p.outcome}; exit=${p.status}; signal=${p.signal}`),
    'OCR recognition: not-exercised; automatic figure detection/page counting: not-exercised',
    ...Object.entries(c.figureDetection.prerequisites).map(([name, p]) => `  ${name} version/presence: ${p.outcome}`),
    `cleanup: ${result.cleanup.outcome}${result.cleanup.reason ? ` (${result.cleanup.reason}: ${result.cleanup.directory})` : ''}`,
  ].join('\n');
}
