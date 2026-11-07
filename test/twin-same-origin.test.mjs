import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/clip.mjs';
import { findTwin } from '../scripts/lib/twin.mjs';
import * as plainText from '../scripts/lib/plain-text.mjs';

const { fetchPlainText } = plainText;
// Called through the namespace so that a missing export fails one test, not the whole file.
const fetchTwinText = (...a) => plainText.fetchTwinText(...a);

// A plain-text twin is guessed from the page's address, or named by a link on the page, and either can point away from the
// page's site. Whatever it answers is stored under the page's provenance, so a probe must not reach another origin at all: not
// by a link, and not by a redirect (a redirect is fetched before it is judged). The tests use two real servers; the second one
// records every request it gets, and the claim is that it gets none.

const SERVER = `
import { createServer } from 'node:http';
const MD = '# Twin\\n\\n' + 'This twin explains the setup steps in plain words for the reader. '.repeat(20);
const hits = [];
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const other = createServer((req, res) => {
  const path = new URL(req.url, 'http://other').pathname;
  if (path === '/__hits') { res.end(JSON.stringify(hits)); return; }
  hits.push(path);
  res.writeHead(200, { 'content-type': 'text/markdown' });
  res.end(MD);
});
const otherPort = await listen(other);
const site = createServer((req, res) => {
  const path = new URL(req.url, 'http://site').pathname;
  if (path === '/guide/away.md.txt') { res.writeHead(302, { location: 'http://127.0.0.1:' + otherPort + '/stolen.md' }); res.end(); }
  else if (path === '/guide/near.md.txt' && !req.url.includes('?')) { res.writeHead(302, { location: '/guide/near.md.txt?served=1' }); res.end(); }
  else if (path === '/guide/near.md.txt') { res.writeHead(200, { 'content-type': 'text/markdown' }); res.end(MD); }
  else if (path === '/guide/slow.md.txt') { /* never answers */ }
  else { res.writeHead(404); res.end('missing'); }
});
const sitePort = await listen(site);
console.log(JSON.stringify({ sitePort, otherPort }));
`;

async function servers(t) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  const { sitePort, otherPort } = await new Promise((resolve, reject) => {
    child.stdout.once('data', (d) => resolve(JSON.parse(String(d))));
    child.once('error', reject);
  });
  return {
    site: `http://127.0.0.1:${sitePort}`,
    other: `http://127.0.0.1:${otherPort}`,
    otherHits: async () => (await fetch(`http://127.0.0.1:${otherPort}/__hits`)).json(),
  };
}

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-twin-origin-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const clippings = join(root, 'raw', 'clippings');
  return { names: () => readdirSync(clippings), clipping: (n) => readFileSync(join(clippings, n), 'utf8') };
}

const thin = (markdownLinks = []) => () => ({ title: 'Guide', contentMarkdown: 'Back to top', pageSignals: { tabControls: 0, pdfLinks: [], markdownLinks } });
const NO_BROWSER = () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'No browser' });

// The real extraction is replaced, but the twin probes are the real ones, through the real fetch child. main is synchronous and
// waits on that child, which is why the servers are a process of their own.
function clip(url, markdownLinks) {
  const log = console.log, err = console.error, code = process.exitCode;
  console.log = () => {}; console.error = () => {};
  try { return main([url], { extract: thin(markdownLinks), fetchText: () => ({ ok: false, reason: 'not text' }), fetchTwin: (u) => fetchTwinText(u), render: NO_BROWSER }); }
  finally { console.log = log; console.error = err; process.exitCode = code; }
}

test('a "View page in Markdown" link to another origin is not probed, and the other server sees no request', async (t) => {
  const s = await servers(t);
  const v = vault(t);
  const result = clip(`${s.site}/guide/page`, [`${s.other}/stolen.md`]);
  assert.notEqual(result.status, 'clipped', "the other origin's text is not stored under this page");
  assert.deepEqual(await s.otherHits(), []);
  assert.deepEqual(v.names(), []);
});

test("findTwin skips a link on another origin and takes the next one on the page's own", () => {
  const asked = [];
  const fetchTwin = (url) => { asked.push(url); return { ok: false }; };
  findTwin({ url: 'https://docs.example.test/a/b', signals: { markdownLinks: ['https://evil.test/x.md', 'https://docs.example.test/a/b.markdown'] }, fetchTwin });
  assert.ok(!asked.some((u) => u.startsWith('https://evil.test')), asked.join('\n'));
  assert.ok(asked.includes('https://docs.example.test/a/b.markdown'));
});

test('a .md.txt that redirects to another origin is refused before any request to it', async (t) => {
  const s = await servers(t);
  const v = vault(t);
  const result = clip(`${s.site}/guide/away`, []);
  assert.notEqual(result.status, 'clipped');
  assert.deepEqual(await s.otherHits(), []);
  assert.deepEqual(v.names(), []);
});

test('a .md.txt that redirects within the origin still supplies the twin', async (t) => {
  const s = await servers(t);
  const v = vault(t);
  const result = clip(`${s.site}/guide/near`, []);
  assert.equal(result.status, 'clipped');
  assert.match(v.clipping(`${result.slug}.md`), /^twin-url: ".*\/guide\/near\.md\.txt"$/m);
  assert.deepEqual(await s.otherHits(), []);
});

test('the fetch of a URL the user typed still follows a redirect to another origin', async (t) => {
  const s = await servers(t);
  const reply = fetchPlainText(`${s.site}/guide/away.md.txt`);
  assert.equal(reply.ok, true);
  assert.equal(reply.finalUrl, `${s.other}/stolen.md`);
});
