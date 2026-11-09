import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main } from '../scripts/clip-pdf.mjs';
import * as pdfDownload from '../scripts/lib/pdf-download.mjs';
const { downloadPdf, streamPdf } = pdfDownload;
const openFile = (...a) => pdfDownload.openFile(...a);
import { CLIP_SPECS, checkClipArgs } from '../scripts/lib/clip-args.mjs';
import { recordDecline } from '../scripts/lib/decline.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

// clip-pdf.mjs <url>: the download runs in a child process with its own stall timer, against a fixture server that is a process
// of its own too (a server in this process could not answer while the synchronous main waits for the child).

const SERVER = `
import { createServer } from 'node:http';
const PDF = Buffer.from('%PDF-1.4\\n% synthetic fixture\\n%%EOF\\n');
let closedAfter = null;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  const head = () => res.writeHead(200, { 'content-type': 'application/pdf' });
  if (path === '/files/guide_v2.pdf') { head(); res.end(PDF); }
  else if (path === '/go') { res.writeHead(302, { location: '/files/guide_v2.pdf?download=1' }); res.end(); }
  else if (path === '/trickle.pdf') {
    head(); res.write('%PDF-1.4\\n');
    let n = 0;
    const timer = setInterval(() => { if (++n >= 12) { clearInterval(timer); res.end('%%EOF\\n'); } else res.write('% filler\\n'); }, 80);
    res.on('close', () => clearInterval(timer));
  } else if (path === '/not-pdf') {
    head(); res.write('<html>');
    let n = 0;
    const timer = setInterval(() => { n++; res.write('x'.repeat(100)); }, 20);
    res.on('close', () => { clearInterval(timer); closedAfter = n; });
  } else if (path === '/stall.pdf') { head(); res.write('%PDF-1.4\\n'); }
  else if (path === '/stats') res.end(JSON.stringify({ closedAfter }));
  else { res.writeHead(404); res.end('missing'); }
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;

async function fixtureServer(t) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', (d) => resolve(Number(String(d).trim())));
    child.once('error', reject);
  });
  return `http://127.0.0.1:${port}`;
}

const BODY = Array.from({ length: 160 }, (_, i) => `word${i % 40}`).join(' ');
const READY = () => ({ ok: true, fatal: false, lines: [] });
const noTitle = () => null;

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-pdf-url-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const read = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  return {
    root,
    names: () => readdirSync(join(root, 'raw', 'clippings')),
    clipping: (name) => readFileSync(join(root, 'raw', 'clippings', name), 'utf8'),
    declines: () => JSON.parse(read('declined.json') ?? '[]'),
    rows: () => (read('triage.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t === 'issue'),
  };
}

// main with console captured. `scratch` is every folder the download was given: none may survive the run.
function clip(argv, { stallMs = 60000, ...deps } = {}) {
  const scratch = [];
  const download = deps.download ?? ((url, dest) => { scratch.push(dirname(dest)); return downloadPdf(url, dest, { stallMs }); });
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const result = main(argv, { toolchain: READY, extractText: () => BODY, pdfTitle: noTitle, ...deps, download });
    return { result, lines, scratch };
  } finally { console.log = log; console.error = err; }
}
const gone = (scratch) => scratch.every((dir) => !existsSync(dir));

test('a PDF address is downloaded, clipped with the address as its source, and no temp file is left', async (t) => {
  const base = await fixtureServer(t);
  const v = vault(t);
  const url = `${base}/files/guide_v2.pdf`;
  const { result, lines, scratch } = clip([url, '--topic=Docs'], { pdfTitle: () => 'Guide to the Setup' });
  assert.equal(result.status, 'clipped', lines.join('\n'));
  const text = v.clipping(`${result.slug}.md`);
  assert.match(text, new RegExp(`^source: "${url}"$`, 'm'));
  assert.match(text, /^title: "Guide to the Setup"$/m);
  assert.equal(result.titleSource, 'pdfinfo');
  assert.equal(scratch.length, 1);
  assert.ok(gone(scratch), 'the temp folder is removed');
  const shown = lines.join('\n');
  assert.ok(shown.includes('clipped: raw/clippings/'));
  assert.ok(!shown.includes(scratch[0]), 'the output names the address, not the deleted temp path');
});

test('a redirect is followed, and the source stays the address that was asked for', async (t) => {
  const base = await fixtureServer(t);
  const v = vault(t);
  const { result } = clip([`${base}/go`]);
  assert.equal(result.status, 'clipped');
  assert.match(v.clipping(`${result.slug}.md`), new RegExp(`^source: "${base}/go"$`, 'm'));
});

test('a response that trickles more often than the stall limit completes however long it takes', async (t) => {
  const base = await fixtureServer(t);
  vault(t);
  const started = Date.now();
  const { result, scratch } = clip([`${base}/trickle.pdf`], { stallMs: 400 });
  assert.equal(result.status, 'clipped');
  assert.ok(Date.now() - started > 700, 'the download took longer than the stall limit');
  assert.ok(gone(scratch));
});

test('a response that does not start with %PDF- is stopped without reading the rest, queued as failed, and not declined', async (t) => {
  const base = await fixtureServer(t);
  const v = vault(t);
  const url = `${base}/not-pdf`;
  const { result, scratch } = clip([url]);
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /%PDF-/);
  assert.deepEqual(v.names(), []);
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows().map((r) => [r.url, r.kind]), [[url, 'failed']]);
  assert.ok(gone(scratch));
  let closedAfter = null;
  for (let i = 0; i < 40 && closedAfter === null; i++) {
    closedAfter = (await (await fetch(`${base}/stats`)).json()).closedAfter;
    if (closedAfter === null) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(closedAfter !== null && closedAfter < 50, `the server saw the connection close after ${closedAfter} chunks`);
});

test('a response that stalls is stopped at the limit, queued as failed, and leaves nothing behind', async (t) => {
  const base = await fixtureServer(t);
  const v = vault(t);
  const { result, scratch } = clip([`${base}/stall.pdf`], { stallMs: 300 });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /no data/);
  assert.deepEqual(v.names(), []);
  assert.deepEqual(v.declines(), []);
  assert.equal(v.rows()[0].kind, 'failed');
  assert.ok(gone(scratch));
});

test('a full disk gets its own error that names it, and the row says so', async (t) => {
  const base = await fixtureServer(t);
  const v = vault(t);
  const dest = join(mkdtempSync(join(tmpdir(), 'wm-pdf-writer-')), 'download.pdf');
  t.after(() => rmSync(dirname(dest), { recursive: true, force: true }));
  const openWriter = async () => ({ write: async () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }); }, close: async () => {} });
  const full = await streamPdf(`${base}/files/guide_v2.pdf`, dest, { openWriter });
  assert.equal(full.ok, false);
  assert.equal(full.code, 'ENOSPC');
  assert.match(full.reason, /disk is full/i);
  assert.equal(existsSync(dest), false, 'a partial file is removed');

  const { result, scratch } = clip([`${base}/files/guide_v2.pdf`], { download: () => full });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /disk is full/i);
  assert.match(v.rows()[0].reason, /disk is full/i);
  assert.deepEqual(scratch, []);
});

test('an address already clipped is a duplicate and a declined one is declined, both before any download', (t) => {
  const v = vault(t);
  const url = 'https://docs.example.test/files/held.pdf';
  const never = () => assert.fail('nothing is downloaded');
  writeFileSync(join(v.root, 'raw', 'clippings', 'Held.md'), `---\ntitle: "Held"\nsource: "${url}"\ncreated: 2026-10-01\ntags: [clippings]\nquality: medium\nsource-hash: abc\n---\n\n${BODY}\n`);
  assert.equal(clip([url], { download: never }).result.status, 'duplicate');
  recordDecline(v.root, 'https://docs.example.test/files/off-topic.pdf', 'off topic');
  assert.equal(clip(['https://docs.example.test/files/off-topic.pdf'], { download: never }).result.status, 'declined');
});

test('--figures-only with an address exits 2 and says to download the file first', (t) => {
  const v = vault(t);
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'clip-pdf.mjs'), 'https://docs.example.test/a.pdf', '--figures-only', '--clipping', 'raw/clippings/x.md'], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /download the file first/);
});

test('a process.exit after the download still leaves no temp file', async (t) => {
  const base = await fixtureServer(t);
  // The run's temp directory holds its vault (the vault guard allows nothing else), so the folder is checked for anything else.
  const tmp = mkdtempSync(join(tmpdir(), 'wm-pdf-tmp-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  mkdirSync(join(tmp, 'vault', 'raw', 'clippings'), { recursive: true });
  const harness = `
    import { main } from ${JSON.stringify(pathToFileURL(join(SCRIPTS, 'clip-pdf.mjs')).href)};
    main([${JSON.stringify(`${base}/files/guide_v2.pdf`)}], { toolchain: () => ({ ok: true, fatal: false, lines: [] }), pdfTitle: () => null, extractText: () => process.exit(3) });
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', harness], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: join(tmp, 'vault'), TMPDIR: tmp, TEMP: tmp, TMP: tmp } });
  assert.equal(r.status, 3, r.stderr);
  assert.deepEqual(readdirSync(tmp), ['vault']);
});

test('clip-pdf accepts an address as its target and says so in its usage', () => {
  assert.deepEqual(checkClipArgs(['https://docs.example.test/a.pdf', '--topic=T', '--title=T'], CLIP_SPECS['clip-pdf']), { ok: true });
  assert.match(CLIP_SPECS['clip-pdf'].usage.join(' '), /usage: clip-pdf\.mjs <file\.pdf \| https-url>/);
});

// ---------------------------------------------------------------- review findings
const runCli = (v, args) => spawnSync(process.execPath, [join(SCRIPTS, 'clip-pdf.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
const wmFiles = (v) => (existsSync(join(v.root, '.wiki-master')) ? readdirSync(join(v.root, '.wiki-master')) : []);

test('an address that carries a username or password is refused with exit 2, and nothing is written, queued or echoed', (t) => {
  const v = vault(t);
  for (const url of ['http://u:p4ss@127.0.0.1:1/doc.pdf', 'https://token@127.0.0.1:1/doc.pdf']) {
    const r = runCli(v, [url, '--topic=T']);
    assert.equal(r.status, 2, `${url}: ${r.stderr}`);
    assert.match(r.stderr, /username or password/);
    assert.ok(!/p4ss|token@|u:p/.test(r.stdout + r.stderr), 'the credentials are not repeated in a message');
  }
  assert.deepEqual(wmFiles(v), [], 'no triage row, decline or log was written');
  assert.deepEqual(v.names(), []);
});

test('the credential refusal comes before the decline gate and the duplicate check', (t) => {
  const v = vault(t);
  const url = 'http://u:p4ss@127.0.0.1:1/doc.pdf';
  recordDecline(v.root, url, 'off topic');
  const before = wmFiles(v).map((n) => [n, readFileSync(join(v.root, '.wiki-master', n), 'utf8')]);
  const r = runCli(v, [url]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.deepEqual(wmFiles(v).map((n) => [n, readFileSync(join(v.root, '.wiki-master', n), 'utf8')]), before);
});

test('a failed download names the failure once: one "download failed" prefix, not two', async (t) => {
  const v = vault(t);
  // A port nothing listens on: a refused connection is a fetch failure, the case that read "download failed: the download failed: ...".
  const { createServer } = await import('node:net');
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  const url = `http://127.0.0.1:${port}/gone.pdf`;
  const { result, lines } = clip([url]);
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /^download failed: \S/);
  assert.equal((result.reason.match(/download failed/gi) ?? []).length, 1, result.reason);
  assert.equal((lines.join('\n').match(/download failed/gi) ?? []).length, 1, lines.join('\n'));
  assert.equal(v.rows()[0].reason, result.reason);
});

test('an address that is not http or https says so and exits 2, instead of "file not found"', (t) => {
  const v = vault(t);
  for (const target of ['ftp://files.example.test/doc.pdf', 'file:///tmp/doc.pdf', 'sftp://files.example.test/doc.pdf']) {
    const r = runCli(v, [target]);
    assert.equal(r.status, 2, `${target}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /only http and https addresses are fetched/, target);
    assert.doesNotMatch(r.stderr, /file not found/);
  }
  assert.deepEqual(wmFiles(v), []);
});

test('a Windows drive path or a relative path is still a file, not an address', (t) => {
  const v = vault(t);
  for (const target of ['C:\no\such\doc.pdf', 'relative/no-such-doc.pdf']) {
    const r = runCli(v, [target]);
    assert.doesNotMatch(r.stderr, /only http and https/, target);
  }
});

test('the file writer keeps writing until a chunk is whole when the disk takes it in pieces', async () => {
  const written = [];
  let closed = false;
  const piecewise = async (_path, _flags) => ({
    write: async (buffer, offset = 0, length = buffer.length - offset) => {
      const n = Math.min(3, length);
      written.push(Buffer.from(buffer.subarray(offset, offset + n)));
      return { bytesWritten: n, buffer };
    },
    close: async () => { closed = true; },
  });
  const writer = await openFile('unused.pdf', piecewise);
  await writer.write(Buffer.from('%PDF-1.4 a chunk longer than three bytes'));
  await writer.write(Buffer.from('and a second one'));
  await writer.close();
  assert.equal(Buffer.concat(written).toString(), '%PDF-1.4 a chunk longer than three bytesand a second one');
  assert.ok(closed);
});

test('a write that accepts nothing is an error, not an endless loop', async () => {
  const stuck = async () => ({ write: async () => ({ bytesWritten: 0 }), close: async () => {} });
  const writer = await openFile('unused.pdf', stuck);
  await assert.rejects(() => writer.write(Buffer.from('abc')), /0 bytes/);
});
