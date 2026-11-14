import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { streamPdf } from '../scripts/lib/pdf-download.mjs';
import { isIncompleteChain, systemDownloader, systemDownloadArgs, incompleteChainReason } from '../scripts/lib/tls-chain.mjs';
import { main } from '../scripts/clip-pdf.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

// A server that does not send its intermediate certificate fails in Node with UNABLE_TO_VERIFY_LEAF_SIGNATURE, while a browser and a
// downloader built on the operating system's TLS complete the chain and verify it. The download helper retries that one error once
// through the system downloader, and verification is never turned off.

const NODE_HINT = 'unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca';
const tlsError = (code, message) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) });
const incomplete = async () => { throw tlsError('UNABLE_TO_VERIFY_LEAF_SIGNATURE', NODE_HINT); };
const ROUTE = /download the file in a browser, then clip the saved file with --source=<address>/;

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-pdf-chain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A stand-in for the system downloader: a Node process that behaves as the script says. `calls` records how it was started.
function tool(script) {
  const calls = [];
  return {
    calls,
    systemTool: { name: 'curl', command: '/system/curl' },
    spawnImpl: (command, args, options) => { calls.push({ command, args }); return spawn(process.execPath, ['-e', script], options); },
  };
}

test('isIncompleteChain: only the missing-intermediate error, on the error or on its cause', () => {
  assert.equal(isIncompleteChain(tlsError('UNABLE_TO_VERIFY_LEAF_SIGNATURE', NODE_HINT)), true);
  assert.equal(isIncompleteChain({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), true);
  for (const code of ['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ECONNRESET', 'ENOTFOUND']) {
    assert.equal(isIncompleteChain(tlsError(code, code)), false, code);
  }
  assert.equal(isIncompleteChain(new Error('fetch failed')), false);
  assert.equal(isIncompleteChain(null), false);
});

test('systemDownloader: the operating system own curl by its system path on Windows and macOS, and none elsewhere', () => {
  const yes = () => true;
  const windows = systemDownloader({ platform: 'win32', env: { SystemRoot: 'D:\\Win' }, exists: yes });
  assert.equal(windows.name, 'curl');
  assert.deepEqual(windows.command.split(/[\\/]/), ['D:', 'Win', 'System32', 'curl.exe']);
  assert.deepEqual(systemDownloader({ platform: 'darwin', env: {}, exists: yes }), { name: 'curl', command: '/usr/bin/curl' });
  assert.equal(systemDownloader({ platform: 'linux', env: {}, exists: yes }), null);
  assert.equal(systemDownloader({ platform: 'win32', env: {}, exists: () => false }), null);
});

test('the system downloader is never asked to skip a check, and the user configuration is not read', () => {
  const args = systemDownloadArgs('https://docs.example.test/a.pdf');
  assert.equal(args[0], '-q', 'the configuration file is ignored, which only the first argument can ask for');
  assert.deepEqual(args.slice(-2), ['--url', 'https://docs.example.test/a.pdf']);
  for (const want of ['--fail', '--location', '--globoff']) assert.ok(args.includes(want), want);
  assert.equal(args[args.indexOf('--proto') + 1], '=http,https');
  assert.equal(args[args.indexOf('--proto-redir') + 1], '=http,https');
  const relaxing = /^(-k|--insecure|--ssl-no-revoke|--ssl-revoke-best-effort|--ssl-allow-beast|--cacert|--capath|--ca-native|--proxy-insecure|--cert-status|--config|-K)$/;
  assert.deepEqual(args.filter((a) => relaxing.test(a)), []);
});

test('no script turns certificate verification off', () => {
  const off = /rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|--insecure|ssl-no-revoke|checkServerIdentity/;
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const hits = walk(SCRIPTS).filter((f) => /\.(mjs|js|py|html)$/.test(f) && off.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});

test('an incomplete chain is retried once through the system downloader, and the file is the one it fetched', async (t) => {
  const dest = join(scratch(t), 'download.pdf');
  const fake = tool("process.stdout.write('%PDF-1.4\\n% through the system downloader\\n%%EOF\\n')");
  const url = 'https://docs.example.test/files/a.pdf';
  const got = await streamPdf(url, dest, { fetchImpl: incomplete, ...fake });
  assert.deepEqual(got, { ok: true, bytes: 47, via: 'system-downloader' });
  assert.match(readFileSync(dest, 'utf8'), /^%PDF-1\.4\n% through the system downloader/);
  assert.equal(fake.calls.length, 1, 'one retry');
  assert.equal(fake.calls[0].command, '/system/curl');
  assert.deepEqual(fake.calls[0].args, systemDownloadArgs(url));
});

test('a system downloader that also rejects the certificate fails with the incomplete-chain message and its own words', async (t) => {
  const dest = join(scratch(t), 'download.pdf');
  const fake = tool("process.stderr.write('curl: (60) SSL certificate problem: unable to get local issuer certificate\\n'); process.exit(60)");
  const got = await streamPdf('https://docs.example.test/a.pdf', dest, { fetchImpl: incomplete, ...fake });
  assert.equal(got.ok, false);
  assert.equal(got.code, 'CHAIN');
  assert.match(got.reason, /^the server's certificate chain is incomplete \(it does not send its intermediate certificate\), and the retry through the system downloader failed \(curl exit 60: curl: \(60\) SSL certificate problem/);
  assert.match(got.reason, ROUTE);
  assert.ok(!got.reason.includes('use-system-ca'), 'the hint that does not help is gone');
  assert.equal(existsSync(dest), false);
});

test('with no system downloader the message says so and names the route that works', async (t) => {
  const dest = join(scratch(t), 'download.pdf');
  const got = await streamPdf('https://docs.example.test/a.pdf', dest, { fetchImpl: incomplete, systemTool: null, spawnImpl: () => assert.fail('nothing is started') });
  assert.deepEqual(got, { ok: false, code: 'CHAIN', reason: incompleteChainReason() });
  assert.match(got.reason, /this system has no downloader that completes a chain while verifying it/);
  assert.match(got.reason, ROUTE);
  assert.ok(!got.reason.includes('use-system-ca'));
});

test('a system downloader that cannot be started is the same failure, not a crash', async (t) => {
  const dest = join(scratch(t), 'download.pdf');
  const got = await streamPdf('https://docs.example.test/a.pdf', dest, { fetchImpl: incomplete, systemTool: { name: 'curl', command: join(scratch(t), 'no-such-program') } });
  assert.equal(got.code, 'CHAIN');
  assert.match(got.reason, /curl could not be started: ENOENT/);
  assert.match(got.reason, ROUTE);
});

test('the retry keeps the helper safeguards: an error status, a body that is not a PDF, and a stall', async (t) => {
  const dir = scratch(t);
  const dest = join(dir, 'download.pdf');
  const missing = tool("process.stderr.write('curl: (22) The requested URL returned error: 404\\n'); process.exit(22)");
  assert.deepEqual(await streamPdf('https://docs.example.test/a.pdf', dest, { fetchImpl: incomplete, ...missing }), { ok: false, code: 'HTTP', reason: 'the server answered 404' });

  const html = tool("process.stdout.write('<html>'); setInterval(() => process.stdout.write('x'.repeat(100)), 20)");
  const notPdf = await streamPdf('https://docs.example.test/a.pdf', dest, { fetchImpl: incomplete, ...html });
  assert.equal(notPdf.code, 'NOT_PDF');
  assert.equal(existsSync(dest), false);

  const silent = tool("process.stdout.write('%PDF-1.4\\n'); setInterval(() => {}, 1000)");
  const started = Date.now();
  const stalled = await streamPdf('https://docs.example.test/a.pdf', dest, { fetchImpl: incomplete, stallMs: 300, ...silent });
  assert.equal(stalled.code, 'STALL');
  assert.match(stalled.reason, /no data for 0\.3 seconds/);
  assert.ok(Date.now() - started < 10000);
  assert.equal(existsSync(dest), false, 'a partial file is removed');
});

test('an untrusted root, an expired certificate and a wrong host name are never retried', async (t) => {
  const dest = join(scratch(t), 'download.pdf');
  const never = { systemTool: { name: 'curl', command: '/system/curl' }, spawnImpl: () => assert.fail('no retry for this error') };
  for (const [code, message] of [
    ['SELF_SIGNED_CERT_IN_CHAIN', 'self-signed certificate in certificate chain'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'],
    ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'unable to get local issuer certificate'],
    ['CERT_HAS_EXPIRED', 'certificate has expired'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', "Hostname/IP does not match certificate's altnames"],
  ]) {
    const got = await streamPdf('https://docs.example.test/a.pdf', dest, { fetchImpl: async () => { throw tlsError(code, message); }, ...never });
    assert.deepEqual(got, { ok: false, code: 'FETCH', reason: message }, code);
    assert.equal(existsSync(dest), false);
  }
});

// ---------------------------------------------------------------- clip-pdf.mjs
const READY = () => ({ ok: true, fatal: false, lines: [] });
const BODY = Array.from({ length: 160 }, (_, i) => `word${i % 40}`).join(' ');

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-pdf-chain-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const read = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  return {
    names: () => readdirSync(join(root, 'raw', 'clippings')),
    declines: () => JSON.parse(read('declined.json') ?? '[]'),
    rows: () => (read('triage.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t === 'issue'),
  };
}

function clip(argv, download) {
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: main(argv, { toolchain: READY, extractText: () => BODY, pdfTitle: () => null, download }), shown: lines.join('\n') }; }
  finally { console.log = log; console.error = err; }
}

test('clip-pdf: a chain that could not be completed is a failed row with the new message, and no decline', (t) => {
  const v = vault(t);
  const url = 'https://docs.example.test/files/a.pdf';
  const { result, shown } = clip([url, '--topic=Docs'], () => ({ ok: false, code: 'CHAIN', reason: incompleteChainReason() }));
  assert.equal(result.status, 'failed');
  assert.match(shown, /^clip failed — download failed: the server's certificate chain is incomplete .* \(queued for triage\): https:\/\/docs\.example\.test\/files\/a\.pdf$/m);
  assert.match(shown, ROUTE);
  assert.ok(!shown.includes('use-system-ca'));
  assert.deepEqual(v.names(), []);
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows().map((r) => [r.url, r.kind, r.topic]), [[url, 'failed', 'Docs']]);
});

test('clip-pdf: a download completed by the system downloader is clipped, and the run says which route it took', (t) => {
  const v = vault(t);
  const { result, shown } = clip(['https://docs.example.test/files/b.pdf'], () => ({ ok: true, bytes: 48, via: 'system-downloader' }));
  assert.equal(result.status, 'clipped', shown);
  assert.match(shown, /^note: the server's certificate chain is incomplete; the system downloader completed and verified it$/m);
  assert.equal(v.names().length, 1);
});

// ---------------------------------------------------------------- real TLS
// A three-level chain made with the openssl command, when there is one: a root, an intermediate it signed, and a server certificate
// the intermediate signed. Node has no API that issues a certificate and the repository depends on no library that does, so without
// the command these cases are skipped and the cases above, which supply the error, stand alone.
function haveOpenssl() {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const OPENSSL = haveOpenssl();

function makeChain(dir) {
  const ssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
  const subject = (cn) => `[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ca\n[dn]\nCN=${cn}\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n`;
  writeFileSync(join(dir, 'root.cnf'), subject('Fixture Root'));
  writeFileSync(join(dir, 'inter.cnf'), subject('Fixture Intermediate'));
  writeFileSync(join(dir, 'leaf.cnf'), subject('127.0.0.1'));
  writeFileSync(join(dir, 'inter.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  writeFileSync(join(dir, 'leaf.ext'), 'basicConstraints=CA:FALSE\nsubjectAltName=IP:127.0.0.1,DNS:localhost\n');
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2', '-keyout', 'root.key', '-out', 'root.pem', '-config', 'root.cnf');
  ssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', 'inter.key', '-out', 'inter.csr', '-config', 'inter.cnf');
  ssl('x509', '-req', '-sha256', '-days', '2', '-in', 'inter.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '2', '-out', 'inter.pem', '-extfile', 'inter.ext');
  ssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-config', 'leaf.cnf');
  ssl('x509', '-req', '-sha256', '-days', '2', '-in', 'leaf.csr', '-CA', 'inter.pem', '-CAkey', 'inter.key', '-set_serial', '3', '-out', 'leaf.pem', '-extfile', 'leaf.ext');
  const read = (name) => readFileSync(join(dir, name), 'utf8');
  return { root: join(dir, 'root.pem'), key: read('leaf.key'), leaf: read('leaf.pem'), inter: read('inter.pem'), rootPem: read('root.pem') };
}

async function httpsServer(t, key, cert) {
  const PDF = Buffer.from('%PDF-1.4\n% synthetic fixture\n%%EOF\n');
  const server = createServer({ key, cert }, (req, res) => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(PDF); });
  server.on('tlsClientError', () => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));
  return `https://127.0.0.1:${server.address().port}/files/a.pdf`;
}

// streamPdf in a process of its own, because the roots a process trusts are read when it starts. `mode` chooses the system
// downloader: 'none', 'real' (whatever this system has) or 'fake' (a stand-in that would succeed, to show whether it was started).
const DRIVER = `
import { spawn } from 'node:child_process';
import { streamPdf } from ${JSON.stringify(pathToFileURL(join(SCRIPTS, 'lib', 'pdf-download.mjs')).href)};
const [url, dest, mode] = process.argv.slice(1);
let started = 0;
const fake = { systemTool: { name: 'curl', command: 'stand-in' }, spawnImpl: (c, a, o) => { started++; return spawn(process.execPath, ['-e', "process.stdout.write('%PDF-1.4 stand-in')"], o); } };
const options = mode === 'none' ? { systemTool: null } : mode === 'fake' ? fake : {};
const outcome = await streamPdf(url, dest, options);
process.stdout.write(JSON.stringify({ outcome, started }) + '\\n', () => process.exit(0));
`;
function drive(url, dest, mode, { trust } = {}) {
  const env = { ...process.env };
  delete env.NODE_EXTRA_CA_CERTS;
  delete env.NODE_OPTIONS;
  if (trust) env.NODE_EXTRA_CA_CERTS = trust;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', DRIVER, url, dest, mode], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.once('error', reject);
    child.once('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { reject(new Error(`no answer from the driver: ${err || out}`)); } });
  });
}

test('a real server that omits its intermediate: Node cannot verify it, the retry is made, and without one the new message is given', { skip: !OPENSSL && 'needs the openssl command' }, async (t) => {
  const dir = scratch(t);
  const chain = makeChain(dir);
  const dest = join(dir, 'download.pdf');

  // The fixture is sound: with the intermediate sent and the root trusted, the plain download works.
  const whole = await httpsServer(t, chain.key, chain.leaf + chain.inter);
  const plain = await drive(whole, dest, 'fake', { trust: chain.root });
  assert.deepEqual(plain, { outcome: { ok: true, bytes: 35 }, started: 0 });

  // The same certificates with the intermediate left out, and the root still trusted.
  const short = await httpsServer(t, chain.key, chain.leaf);
  const retried = await drive(short, dest, 'fake', { trust: chain.root });
  assert.equal(retried.started, 1, 'the incomplete chain is what starts the retry');
  assert.equal(retried.outcome.via, 'system-downloader');

  const none = await drive(short, dest, 'none', { trust: chain.root });
  assert.deepEqual(none.outcome, { ok: false, code: 'CHAIN', reason: incompleteChainReason() });

  // Whatever downloader this system has does not know the fixture's root, so its retry must fail: it verifies too.
  const real = await drive(short, dest, 'real', { trust: chain.root });
  assert.equal(real.outcome.ok, false, JSON.stringify(real.outcome));
  assert.equal(real.outcome.code, 'CHAIN');
  assert.match(real.outcome.reason, ROUTE);
  assert.equal(existsSync(dest), false);
});

test('a real server whose root is not trusted still fails, with the chain whole or not, and is never fetched', { skip: !OPENSSL && 'needs the openssl command' }, async (t) => {
  const dir = scratch(t);
  const chain = makeChain(dir);
  const dest = join(dir, 'download.pdf');

  // The whole chain, root included, and nothing trusts the root: not the incomplete-chain error, so no retry at all.
  const whole = await httpsServer(t, chain.key, chain.leaf + chain.inter + chain.rootPem);
  const untrusted = await drive(whole, dest, 'fake');
  assert.equal(untrusted.started, 0, 'an untrusted root is not retried');
  assert.equal(untrusted.outcome.ok, false);
  assert.equal(untrusted.outcome.code, 'FETCH');
  assert.match(untrusted.outcome.reason, /self-signed certificate in certificate chain/);

  // The intermediate left out as well. Node cannot tell this from a trusted server's missing intermediate, so the retry runs, and the
  // system downloader, which verifies against the operating system's roots, refuses it.
  const short = await httpsServer(t, chain.key, chain.leaf);
  const real = await drive(short, dest, 'real');
  assert.equal(real.outcome.ok, false, JSON.stringify(real.outcome));
  assert.equal(real.outcome.code, 'CHAIN');
  assert.equal(existsSync(dest), false, 'nothing is downloaded from a server that cannot be verified');
});
