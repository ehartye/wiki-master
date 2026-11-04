import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { main } from '../scripts/clip-pdf.mjs';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const png = () => {
  const b = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(b);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(10, 16); b.writeUInt32BE(12, 20); b[24] = 8; b[25] = 2;
  let crc = 0xffffffff;
  for (const byte of b.subarray(12, 29)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29); return b;
};

test('synthetic PDF stream length and cross-reference offsets match its exact bytes', async () => {
  const { syntheticPdf } = await import('../scripts/lib/pdf-doctor.mjs');
  const pdf = syntheticPdf(); const text = pdf.toString('ascii');
  const stream = text.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)endstream/);
  assert.ok(stream);
  assert.equal(Number(stream[1]), Buffer.byteLength(stream[2]), 'declared stream length must include exactly its stream bytes');
  const xrefOffset = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.subarray(xrefOffset, xrefOffset + 4).toString(), 'xref');
  const rows = text.slice(xrefOffset).match(/\n(\d{10}) 00000 n /g);
  assert.equal(rows.length, 4);
  rows.forEach((row, i) => {
    const offset = Number(row.match(/\d{10}/)[0]);
    assert.ok(pdf.subarray(offset).toString().startsWith(`${i + 1} 0 obj\n`));
  });
});
async function fixture(t, mode = 'valid', extra = {}) {
  const { diagnosePdf } = await import('../scripts/lib/pdf-doctor.mjs');
  const root = mkdtempSync(join(tmpdir(), 'doctor-test-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const run = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (extra.respond) { const r = extra.respond(cmd, args, options); if (r) return r; }
    if (!args.includes('-png')) return { status: 0, stdout: '', stderr: 'pdftotext Glyph & Cog\n -table\n' };
    if (mode === 'fail') return { status: 99, stderr: 'unsupported png' };
    if (mode === 'timeout') return { status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT' } };
    if (mode !== 'missing-output') {
      const b = mode === 'malformed' ? Buffer.from('bad png') : mode === 'empty' ? Buffer.alloc(0) : png();
      if (mode === 'zero-dimension') b.writeUInt32BE(0, 16);
      if (mode === 'bad-crc') b[32] ^= 1;
      if (mode === 'oversized-dimension') b.writeUInt32BE(0xffffffff, 16);
      writeFileSync(`${args.at(-1)}${args.includes('-singlefile') ? '' : '-1'}.png`, b);
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = await diagnosePdf({ run, tempRoot: root, ...extra.options });
  assert.deepEqual(readdirSync(root), [], 'owned temporary files cleaned');
  return { result, calls };
}

test('doctor does not equate successful versions with usable PNG rendering', async () => {
  const originalExec = childProcess.execFileSync, originalSpawn = childProcess.spawnSync;
  const originalAsyncSpawn = childProcess.spawn;
  const originalLog = console.log;
  try {
    childProcess.execFileSync = (_cmd, args) => {
      if (args.includes('-png')) throw Object.assign(new Error('unsupported PNG'), { status: 99 });
      return 'pdftotext Xpdf Glyph & Cog\n -table\n';
    };
    childProcess.spawnSync = (_cmd, args) => ({ status: args.includes('-png') ? 99 : 0, signal: null, stdout: 'pdftotext Xpdf Glyph & Cog\n -table\n', stderr: '' });
    childProcess.spawn = (_cmd, args) => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setImmediate(() => { child.stdout.write('pdftotext Xpdf Glyph & Cog\n -table\n'); child.emit('close', args.includes('-png') ? 99 : 0, null); });
      return child;
    };
    syncBuiltinESMExports();
    console.log = () => {};
    const result = await main(['--doctor']);
    assert.equal(result.capabilities?.ocrRaster?.outcome, 'unusable');
    assert.equal(result.ok, true, 'legacy summary remains dependency-only');
  } finally {
    childProcess.execFileSync = originalExec; childProcess.spawnSync = originalSpawn;
    childProcess.spawn = originalAsyncSpawn;
    console.log = originalLog; syncBuiltinESMExports();
  }
});

test('separate raster contracts use exact runtime flags and fresh directories', async t => {
  const { result: r, calls } = await fixture(t);
  assert.equal(r.status, 'doctor'); assert.equal(r.ok, true); assert.deepEqual(r.missing, []);
  assert.equal(r.capabilities.ocrRaster.outcome, 'passed'); assert.equal(r.capabilities.figureRaster.outcome, 'passed');
  const renders = calls.filter(c => c.args.includes('-png'));
  assert.deepEqual(renders[0].args.slice(0, 3), ['-png', '-r', '300']);
  assert.deepEqual(renders[1].args.slice(0, 8), ['-r', '200', '-png', '-f', '1', '-l', '1', '-singlefile']);
  assert.notEqual(renders[0].args.at(-1), renders[1].args.at(-1));
  assert.equal(r.capabilities.ocrRuntimeGate.allowed, true);
  assert.equal(r.capabilities.ocrRecognition.outcome, 'not-exercised');
  assert.equal(r.capabilities.figureDetection.outcome, 'not-exercised');
  assert.equal(r.capabilities.text.tableRowsVerified, false);
  assert.ok(calls.every(c => c.options.timeout > 0 && c.options.timeout <= 5000 && c.options.maxBuffer <= 65536 && c.options.killSignal === 'SIGKILL'));
});

for (const mode of ['missing-output', 'empty', 'malformed', 'zero-dimension', 'bad-crc', 'oversized-dimension']) test(`rejects ${mode}`, async t => {
  const { result } = await fixture(t, mode);
  assert.equal(result.capabilities.ocrRaster.outcome, 'invalid-output');
  assert.equal(result.capabilities.figureRaster.outcome, 'invalid-output');
});
for (const [mode, expected] of [['fail', 'unusable'], ['timeout', 'timeout']]) test(`classifies ${mode} and cleans temporary files`, async t => {
  const { result } = await fixture(t, mode);
  assert.equal(result.capabilities.ocrRaster.outcome, expected);
});

test('successful raster does not override nonzero runtime version gate', async t => {
  const { result } = await fixture(t, 'valid', { respond: (cmd, args) => cmd === 'pdftoppm' && args[0] === '-v' ? { status: 99, stderr: 'version' } : null });
  assert.equal(result.capabilities.ocrRaster.outcome, 'passed');
  assert.equal(result.capabilities.ocrRuntimeGate.allowed, false);
  assert.equal(result.ok, true);
});

test('missing and unstartable executables are distinguished', async t => {
  for (const code of ['ENOENT', 'EACCES']) {
    const { result } = await fixture(t, 'valid', { respond: () => ({ status: null, error: { code } }), options: { figureOptions: { bins: [] } } });
    assert.equal(result.capabilities.ocrRaster.outcome, code === 'ENOENT' ? 'missing' : 'unusable');
    assert.equal(result.capabilities.ocrRuntimeGate.allowed, false);
  }
});

test('figure fallback selection is distinct from OCR PATH command', async t => {
  const { result, calls } = await fixture(t, 'valid', {
    respond: cmd => cmd === 'pdftoppm' ? { status: null, error: { code: 'ENOENT' } } : null,
    options: { figureOptions: { bins: ['fixture-bin'], exists: () => true } },
  });
  assert.equal(result.capabilities.ocrRaster.outcome, 'missing');
  assert.equal(result.capabilities.figureRaster.outcome, 'passed');
  assert.ok(calls.some(c => c.cmd === join('fixture-bin', 'pdftoppm.exe') && c.args.includes('-singlefile')));
});

test('combined budget includes presence/help and marks remaining probes unexercised', async t => {
  let time = 0;
  const { result, calls } = await fixture(t, 'valid', { options: { now: () => time }, respond: () => { time += 5000; return { status: null, error: { code: 'ETIMEDOUT' } }; } });
  assert.equal(calls.length, 6);
  assert.equal(result.capabilities.ocrRaster.outcome, 'not-exercised');
  assert.match(result.capabilities.ocrRaster.reason, /budget/);
});

test('real bounded runner kills a hanging owned child and caps output', async t => {
  const { createProbeRunner } = await import('../scripts/lib/pdf-doctor.mjs');
  const run = createProbeRunner({ perProcessMs: 150, totalMs: 1000 });
  const r = await run(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  assert.equal(r.outcome, 'timeout');
  assert.throws(() => process.kill(r.pid, 0), /ESRCH|EINVAL/);
  const flood = await createProbeRunner({ perProcessMs: 1000 })(process.execPath, ['-e', 'process.stdout.write("x".repeat(1000000))']);
  assert.ok(flood.stdout.length <= 65536); assert.equal(flood.outcome, 'unusable');
});

test('cleanup failure is exposed in the report', async t => {
  const { diagnosePdf } = await import('../scripts/lib/pdf-doctor.mjs');
  const root = mkdtempSync(join(tmpdir(), 'doctor-cleanup-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await diagnosePdf({ tempRoot: root, run: () => ({ status: null, error: { code: 'ENOENT' } }), figureOptions: { bins: [] }, cleanup: () => { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); } });
  assert.equal(result.cleanup.outcome, 'unusable'); assert.equal(result.cleanup.code, 'EBUSY');
  assert.equal(readdirSync(root).length, 1);
});

test('CLI completes unavailable diagnostics with exit zero and leaves vault and temp parent untouched', t => {
  const root = mkdtempSync(join(tmpdir(), 'doctor-cli-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, 'vault'), temporary = join(root, 'temporary'); mkdirSync(vault); mkdirSync(temporary);
  writeFileSync(join(vault, 'sentinel'), 'preserve');
  const result = childProcess.spawnSync(process.execPath, ['scripts/clip-pdf.mjs', '--doctor'], {
    encoding: 'utf8', timeout: 35000,
    env: { ...process.env, PATH: '', Path: '', LOCALAPPDATA: '', WIKI_MASTER_VAULT: vault, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ocrRaster: missing/);
  assert.match(result.stdout, /legacy dependency-only/);
  assert.deepEqual(readdirSync(vault), ['sentinel']); assert.deepEqual(readdirSync(temporary), []);
});

test('human report distinguishes failed versions and untested prerequisites', async t => {
  const { formatPdfDoctor } = await import('../scripts/lib/pdf-doctor.mjs');
  const { result } = await fixture(t, 'valid', { respond: (cmd, args) => (cmd === 'tesseract' || cmd === 'pdftotext') && args[0] !== '-h' ? { status: 99, stderr: 'version failed' } : null });
  const report = formatPdfDoctor(result);
  assert.match(report, /tesseract version\/presence: unusable.*exit=99/);
  assert.match(report, /pdftotext -v: unusable.*exit=99/);
});

test('figure probe cannot accept the OCR output and reports missing detection prerequisites separately', async t => {
  const { result } = await fixture(t, 'valid', { respond: (cmd, args) => {
    if (args.includes('-singlefile')) return { status: 0 };
    if (cmd === 'pdfinfo') return { status: null, error: { code: 'ENOENT' } };
  }, options: { figureOptions: { bins: [] } } });
  assert.equal(result.capabilities.ocrRaster.outcome, 'passed');
  assert.equal(result.capabilities.figureRaster.outcome, 'invalid-output');
  assert.equal(result.capabilities.figureDetection.prerequisites.pdfinfo.outcome, 'missing');
  assert.equal(result.ok, true, 'figure prerequisites do not alter the legacy summary');
});

test('remaining budget shortens the next subprocess timeout', async t => {
  const { createProbeRunner } = await import('../scripts/lib/pdf-doctor.mjs');
  let time = 0; const limits = [];
  const run = createProbeRunner({ totalMs: 7000, now: () => time, run: (_cmd, _args, options) => {
    limits.push(options.timeout); time += options.timeout; return { status: null, error: { code: 'ETIMEDOUT' } };
  } });
  await run('fixture', []); await run('fixture', []);
  assert.equal((await run('fixture', [])).outcome, 'not-exercised');
  assert.deepEqual(limits, [5000, 2000]);
});

test('timeout terminates the owned process tree before returning', { timeout: 15000 }, async t => {
  const { createProbeRunner } = await import('../scripts/lib/pdf-doctor.mjs');
  const root = mkdtempSync(join(tmpdir(), 'doctor-tree-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pidFile = join(root, 'child.pid'); let descendant;
  try {
    const script = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000);`;
    const started = performance.now();
    const result = await createProbeRunner()(process.execPath, ['-e', script, pidFile]);
    const elapsed = performance.now() - started;
    descendant = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(result.outcome, 'timeout');
    assert.equal(result.termination?.outcome, 'passed', JSON.stringify({ termination: result.termination, elapsed }));
    assert.ok(elapsed < 6000, `five-second internal deadline plus scheduler overhead: ${elapsed}ms`);
    if (process.platform === 'linux') {
      try { t.diagnostic(`descendant state before absence assertion: ${readFileSync(`/proc/${descendant}/status`, 'utf8').split('\n').filter(line => /^(Name|State|PPid):/.test(line)).join('; ')}`); }
      catch (error) { t.diagnostic(`descendant status unavailable: ${error.code}`); }
    }
    assert.throws(() => process.kill(descendant, 0), /ESRCH|EINVAL/, 'descendant must not survive');
  } finally { if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch {} } }
});

test('unconfirmed termination stops subsequent processes and retains the owned fixture', async t => {
  const { diagnosePdf } = await import('../scripts/lib/pdf-doctor.mjs');
  const root = mkdtempSync(join(tmpdir(), 'doctor-stop-failure-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const result = await diagnosePdf({ tempRoot: root, run: () => {
    calls++; return { status: null, error: { code: 'ETIMEDOUT' }, termination: { outcome: 'unusable', reason: 'injected termination failure' } };
  } });
  assert.equal(calls, 1);
  assert.equal(result.capabilities.ocrRaster.outcome, 'not-exercised');
  assert.equal(result.cleanup.outcome, 'not-exercised');
  assert.equal(readdirSync(root).length, 1);
});
