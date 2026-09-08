import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCliRequest, lockAddress, runCli, acquireGate, serializedExecFileSync } from '../scripts/lib/cli-transport.mjs';

const transport = fileURLToPath(new URL('../scripts/lib/cli-transport.mjs', import.meta.url));
const address = () => lockAddress(`test-${randomUUID()}`);
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-cli-guard-'));
  const program = join(root, 'fake-cli.mjs');
  writeFileSync(program, `import {appendFileSync} from 'node:fs';
const [log,id,delay,code]=process.argv.slice(2);
appendFileSync(log,JSON.stringify({id,event:'start'})+'\\n');
setTimeout(()=>{appendFileSync(log,JSON.stringify({id,event:'end'})+'\\n');console.log(id);process.exit(Number(code)||0)},Number(delay));`);
  return { root, program, log: join(root, 'events.jsonl'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
};
function worker(args, options) {
  const child = spawn(process.execPath, [transport, '--worker'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  child.stdin.end(JSON.stringify({ command: process.execPath, args, options }));
  const result = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', code => code ? reject(new Error(stderr)) : resolve(JSON.parse(stdout)));
  });
  return { child, result };
}

test('preflight counts UTF-8 JSON bytes and rejects multiline/NUL without echoing content', () => {
  assert.ok(validateCliRequest(['vault=My Wiki', 'read', 'path=wiki/a b.md']) < 2048);
  for (const value of ['private'.repeat(400), '界'.repeat(700), '"'.repeat(1050), 'one\ntwo', 'one\rtwo', 'one\0two']) {
    assert.throws(() => validateCliRequest(['create', `content=${value}`]), error => {
      assert.match(error.message, /not sent/i); assert.ok(!error.message.includes(value)); return true;
    });
  }
  assert.throws(() => validateCliRequest(['read'], { cwd: 'x'.repeat(2048) }), /not sent/i);
});

test('request size boundary includes escaped content and the current directory', () => {
  const options = { cwd: '/fixture' };
  const overhead = validateCliRequest(['search', 'query='], options);
  const query = 'x'.repeat(2048 - overhead);
  assert.equal(validateCliRequest(['search', `query=${query}`], options), 2048);
  assert.throws(() => validateCliRequest(['search', `query=${query}x`], options), /2049 bytes/);
});

test('preflight rejects unsafe requests before acquiring the gate or invoking an executor', async () => {
  await assert.rejects(runCli(['create', 'content=' + 'x'.repeat(3000)], { endpoint: { port: -1 }, execFileImpl() { assert.fail('must not spawn'); } }), /not sent/i);
});

test('agent proxy rejects oversized payloads and missing commands without touching Obsidian', () => {
  const proxy = fileURLToPath(new URL('../scripts/obsidian.mjs', import.meta.url));
  for (const args of [[], ['create', 'content=' + 'private'.repeat(500)]]) {
    const r = spawnSync(process.execPath, [proxy, ...args], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    assert.equal(r.status, 1); assert.match(r.stderr, /not sent/i); assert.ok(!r.stderr.includes('private')); assert.equal(r.stdout, '');
  }
});

test('separate worker processes serialize fake CLI calls across vault arguments', async () => {
  const f = fixture(), endpoint = address();
  try {
    const results = await Promise.all(['one', 'two', 'three'].map((id, i) => worker([f.program, f.log, id, '80', '0', `vault=${i}`], { endpoint, timeout: 2000, waitTimeout: 3000 }).result));
    assert.ok(results.every(r => r.ok));
    const events = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
    let active = null;
    for (const e of events) { if (e.event === 'start') { assert.equal(active, null); active = e.id; } else { assert.equal(active, e.id); active = null; } }
    assert.equal(active, null); assert.equal(events.length, 6);
  } finally { f.cleanup(); }
});

test('a held gate times out without executing and can be reacquired after release', async () => {
  const endpoint = address(), release = await acquireGate(endpoint, 1000);
  try {
    await assert.rejects(runCli(['read'], { endpoint, waitTimeout: 60, execFileImpl() { assert.fail('must not run'); } }), e => e.code === 'CLI_BUSY' && /not sent/i.test(e.message));
  } finally { await release(); }
  const releaseAgain = await acquireGate(endpoint, 1000); await releaseAgain();
});

test('CLI failure and timeout release the gate without retrying or leaking note text', async () => {
  const f = fixture(), endpoint = address();
  try {
    await assert.rejects(runCli([f.program, f.log, 'fail', '0', '7'], { command: process.execPath, endpoint }), /failed/);
    let attempts = 0;
    await assert.rejects(runCli([f.program, f.log, 'timeout', '5000'], { command: process.execPath, endpoint, timeout: 100,
      execFileImpl(...args) { attempts++; return execFile(...args); },
    }), e => e.code === 'ETIMEDOUT' && /unknown/.test(e.message));
    assert.equal(attempts, 1);
    assert.equal((await runCli([f.program, f.log, 'next', '0'], { command: process.execPath, endpoint })).trim(), 'next');
    const events = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(events.filter(e => e.id === 'timeout' && e.event === 'start').length <= 1); // Startup itself may exceed the bound.
  } finally { f.cleanup(); }
});

test('sync adapter honors the same gate held by an asynchronous caller', async () => {
  const endpoint = address(), release = await acquireGate(endpoint, 1000);
  try {
    assert.throws(() => serializedExecFileSync('obsidian', ['read'], { endpoint, waitTimeout: 50, timeout: 100 }), e => e.code === 'CLI_BUSY');
  } finally { await release(); }
});

test('sync adapter preserves successful output and does not leak native failure arguments', () => {
  const f = fixture(), endpoint = address();
  try {
    assert.equal(serializedExecFileSync(process.execPath, [f.program, f.log, 'a b', '0'], { endpoint }).trim(), 'a b');
    assert.throws(() => serializedExecFileSync(process.execPath, [f.program, f.log, 'secret-note-body', '0', '9'], { endpoint }), error => {
      assert.match(error.message, /failed/); assert.ok(!error.message.includes('secret-note-body')); return true;
    });
  } finally { f.cleanup(); }
});

test('OS releases the gate when an owner with no CLI child terminates', async () => {
  const endpoint = address();
  const source = `import {acquireGate} from ${JSON.stringify(new URL('../scripts/lib/cli-transport.mjs', import.meta.url).href)};await acquireGate(JSON.parse(process.argv[1]),1000);console.log('held');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, JSON.stringify(endpoint)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => reject(new Error(`owner exited ${code}`))); });
    child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
    const release = await acquireGate(endpoint, 1000); await release();
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
