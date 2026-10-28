import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { main } from '../scripts/clip.mjs';
import { looksLikePlainTextUrl, fetchPlainText, MAX_PLAIN_BYTES } from '../scripts/lib/plain-text.mjs';
import { openIssues, loadIssueLog } from '../scripts/lib/triage.mjs';
import { loadDeclines } from '../scripts/lib/decline.mjs';
import { fidelityFlagged } from '../scripts/triage.mjs';

// The clipper reads a page with Defuddle, which cannot read a text file: a checksum manifest, a pinned source file, a
// config. Measured on 2026-10-28 for a manifest, a dotfile and a package.json served as text/plain: the static read fails
// outright, so the URL fell to the browser rung or became a queued failure, and when it was read, a short file was judged
// thin. A URL that looks like a text file is now fetched for its bytes and kept whole, in a fence.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
const child = join(root, 'scripts', 'lib', 'fetch-text-child.mjs');

test('URLs that look like text files', () => {
  for (const u of ['https://nodejs.org/dist/v22.11.0/SHASUMS256.txt', 'https://raw.githubusercontent.com/o/r/v1/src/a.js', 'https://raw.githubusercontent.com/o/r/main/LICENSE', 'https://example.org/c/config.yaml?x=1', 'https://example.org/data.json', 'https://example.org/a/b/main.py', 'https://example.org/notes.md']) {
    assert.equal(looksLikePlainTextUrl(u), true, u);
  }
  for (const u of ['https://example.org/', 'https://example.org/article', 'https://example.org/page.html', 'https://example.org/page.php', 'https://example.org/paper.pdf', 'https://github.com/o/r/blob/main/a.js', 'not a url']) {
    assert.equal(looksLikePlainTextUrl(u), false, u);
  }
});

test('fetchPlainText parses what the child process prints, and a child that fails is not a success', () => {
  const ok = fetchPlainText('https://x.test/a.txt', { run: () => JSON.stringify({ ok: true, text: 'hello', type: 'text/plain' }) });
  assert.deepEqual([ok.ok, ok.text], [true, 'hello']);
  assert.equal(fetchPlainText('https://x.test/a.txt', { run: () => { throw new Error('timed out'); } }).ok, false);
  assert.equal(fetchPlainText('https://x.test/a.txt', { run: () => 'not json' }).ok, false);
});

// The child fetches; these run it asynchronously so the server in this process can answer it.
async function serve(routes) {
  const server = createServer((req, res) => {
    const r = routes[req.url];
    if (!r) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'text/plain; charset=utf-8' });
    res.end(r.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
const fetchVia = async (url) => JSON.parse((await execFileAsync(process.execPath, [child, url], { encoding: 'utf8', timeout: 30000 })).stdout);

test('the child returns the text of a text file, and says why it did not for anything else', async (t) => {
  const s = await serve({
    '/SHASUMS.txt': { body: 'abc123  node-v22.11.0-win-x64.zip\ndef456  node-v22.11.0-linux-x64.tar.gz\n' },
    '/data.json': { type: 'application/json', body: '{"a":1}' },
    '/page.html': { type: 'text/html', body: '<html><body>hi</body></html>' },
    '/model.txt': { body: Buffer.from([0x67, 0x6c, 0x54, 0x46, 0, 0, 0, 2, 0, 0]) },
    '/big.txt': { body: 'x'.repeat(MAX_PLAIN_BYTES + 10) },
    '/gone.txt': { status: 404, body: 'gone' },
  });
  t.after(() => s.close());
  const ok = await fetchVia(`${s.base}/SHASUMS.txt`);
  assert.equal(ok.ok, true);
  assert.match(ok.text, /^abc123 {2}node-v22\.11\.0-win-x64\.zip\n/);
  assert.equal((await fetchVia(`${s.base}/data.json`)).ok, true);
  const html = await fetchVia(`${s.base}/page.html`);
  assert.deepEqual([html.ok, html.refused ?? false], [false, false], 'a web page is left to the ladder');
  const binary = await fetchVia(`${s.base}/model.txt`);
  assert.deepEqual([binary.ok, binary.refused], [false, true]);
  assert.match(binary.reason, /binary/);
  const big = await fetchVia(`${s.base}/big.txt`);
  assert.deepEqual([big.ok, big.refused], [false, true]);
  assert.match(big.reason, /larger/);
  const gone = await fetchVia(`${s.base}/gone.txt`);
  assert.deepEqual([gone.ok, gone.refused ?? false], [false, false]);
});

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-plain-'));
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = dir;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(dir, { recursive: true, force: true }); });
  return { dir, files: () => readdirSync(join(dir, 'raw', 'clippings')), read: (f) => readFileSync(join(dir, 'raw', 'clippings', f), 'utf8'), rows: () => openIssues(loadIssueLog(dir)) };
}
const quiet = (fn) => { const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = log; console.error = err; } };
const MANIFEST = 'aaa111  node-v22.11.0-win-x64.zip\nbbb222  node-v22.11.0-linux-x64.tar.gz\nccc333  node-v22.11.0-darwin-arm64.tar.gz\n';
const MANIFEST_URL = 'https://nodejs.org/dist/v22.11.0/SHASUMS256.txt';
const never = () => { throw new Error('the ladder must not run'); };

test('a short checksum manifest is kept whole, in a fence, and is not thin', (t) => {
  const v = vault(t);
  const r = quiet(() => main([MANIFEST_URL], { fetchText: () => ({ ok: true, text: MANIFEST, type: 'text/plain' }), extract: never }));
  assert.equal(r.status, 'clipped');
  assert.equal(v.files().length, 1);
  const text = v.read(v.files()[0]);
  assert.match(text, /^title: "SHASUMS256\.txt"$/m);
  assert.match(text, new RegExp(`^source: "${MANIFEST_URL.replaceAll('.', '\\.')}"$`, 'm'));
  assert.match(text, /^extraction: plaintext$/m);
  assert.doesNotMatch(text, /^fidelity:/m);
  const body = text.split(/^---\n[\s\S]*?\n---\n/m)[1].trim();
  assert.equal(body, '```\n' + MANIFEST.trimEnd() + '\n```');
  assert.match(text, new RegExp(`^source-hash: ${createHash('sha256').update(body).digest('hex')}$`, 'm'));
  assert.deepEqual(v.rows(), []);
  assert.deepEqual(loadDeclines(v.dir), []);
});

test('text that contains a fence is wrapped in a longer one', (t) => {
  const v = vault(t);
  const md = '# Notes\n\n```js\nconst a = 1;\n```\n';
  quiet(() => main(['https://raw.githubusercontent.com/o/r/v1/NOTES.md'], { fetchText: () => ({ ok: true, text: md, type: 'text/plain' }), extract: never }));
  const text = v.read(v.files()[0]);
  assert.ok(text.includes('````\n# Notes\n\n```js\nconst a = 1;\n```\n````'), text);
});

test('the same file again is a duplicate', (t) => {
  vault(t);
  const deps = { fetchText: () => ({ ok: true, text: MANIFEST, type: 'text/plain' }), extract: never };
  assert.equal(quiet(() => main([MANIFEST_URL], deps)).status, 'clipped');
  assert.equal(quiet(() => main([MANIFEST_URL], deps)).status, 'duplicate');
});

test('a text URL that cannot be fetched as text falls back to the ladder', (t) => {
  const v = vault(t);
  const article = 'A substantive paragraph of document text that is long enough to count as content. '.repeat(30);
  const r = quiet(() => main(['https://example.org/readme.txt'], { fetchText: () => ({ ok: false, reason: 'content type text/html' }), extract: () => ({ title: 'Readme', contentMarkdown: article }) }));
  assert.equal(r.status, 'clipped');
  assert.doesNotMatch(v.read(v.files()[0]), /extraction: plaintext/);
});

test('a binary or oversized file served as text is refused and queued, not clipped', (t) => {
  const v = vault(t);
  const r = quiet(() => main(['https://example.org/model.txt'], { fetchText: () => ({ ok: false, refused: true, reason: 'binary content' }), extract: never }));
  assert.equal(r.status, 'thin');
  assert.deepEqual(v.files(), []);
  assert.equal(v.rows().length, 1);
  assert.equal(v.rows()[0].kind, 'attention');
  assert.match(v.rows()[0].reason, /binary content/);
});

test('a web page is never fetched as text', (t) => {
  vault(t);
  const article = 'A substantive paragraph of document text that is long enough to count as content. '.repeat(30);
  const r = quiet(() => main(['https://example.org/article'], { fetchText: () => { throw new Error('must not fetch'); }, extract: () => ({ title: 'Article', contentMarkdown: article }) }));
  assert.equal(r.status, 'clipped');
});

test('triage does not flag extraction: plaintext, which is a method and not a defect', (t) => {
  const v = vault(t);
  quiet(() => main([MANIFEST_URL], { fetchText: () => ({ ok: true, text: MANIFEST, type: 'text/plain' }), extract: never }));
  assert.deepEqual(fidelityFlagged(v.dir), []);
});
