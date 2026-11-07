import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/clip.mjs';
import { CLIP_SPECS, checkClipArgs } from '../scripts/lib/clip-args.mjs';
import { runReclips } from '../scripts/lib/reclip.mjs';
import { checkUrl, listKnownUrls, summarizeTopic } from '../scripts/known-urls.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

// Plain-text twins: a page that extracts thin is looked up as Markdown before the browser is tried. The probe is the injected
// fetchTwin, so nothing here reaches a network.

const URL_A = 'https://docs.example.test/guide/setup';
const BASE = 'https://docs.example.test/guide/setup';
const TWIN = `${BASE}.md.txt`;
const LLMS = 'https://docs.example.test/llms.txt';
const body = (heading) => `${heading ? `# ${heading}\n\n` : ''}${'This twin explains the setup steps in plain words for the reader. '.repeat(20)}\n\n\`\`\`js\nsetup();\n\`\`\`\n`;
const MD = body('Setup guide');
const ARTICLE = 'The rendered article explains the page in plain words. '.repeat(30);
const thin = (extra = {}) => () => ({ title: 'Setup', contentMarkdown: 'Back to top', ...extra });
const notCalled = (name) => () => assert.fail(`${name} must not run`);
const missing = { ok: false, reason: 'status 404' };
const served = (text, extra = {}) => (url) => ({ ok: true, type: 'text/markdown; charset=utf-8', text, finalUrl: url, ...extra });
const NO_BROWSER = () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'No browser' });

// fetchTwin over a map of URL -> reply (an object, or a function of the URL); every other URL is a 404. `.calls` is what was asked.
function twins(map) {
  const calls = [];
  const fn = (url) => { calls.push(url); const hit = map[url]; return hit === undefined ? missing : typeof hit === 'function' ? hit(url) : hit; };
  fn.calls = calls;
  return fn;
}

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-twin-'));
  const clippings = join(root, 'raw', 'clippings');
  mkdirSync(clippings, { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const read = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  const walk = (dir, out) => { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) walk(full, out); else out.set(full.slice(root.length).split(sep).join('/'), readFileSync(full, 'base64')); } return out; };
  return {
    root,
    names: () => readdirSync(clippings).sort(),
    clipping: (name) => readFileSync(join(clippings, `${name}.md`), 'utf8'),
    declines: () => JSON.parse(read('declined.json') ?? '[]'),
    rows: () => (read('triage.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t === 'issue'),
    snapshot: () => walk(root, new Map()),
  };
}

function clip(argv, deps) {
  const lines = [];
  const log = console.log, err = console.error, code = process.exitCode;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const result = main(argv, { extract: thin(), fetchText: notCalled('the text fetch'), render: NO_BROWSER, ...deps });
    return { result, lines, exitCode: process.exitCode };
  } finally { console.log = log; console.error = err; process.exitCode = code; }
}

test('a thin page whose .md.txt serves Markdown is stored unfenced, as the page, with the twin recorded', (t) => {
  const v = vault(t);
  const fetchTwin = twins({ [TWIN]: served(MD) });
  const { result } = clip([URL_A], { fetchTwin, render: notCalled('the render') });
  assert.equal(result.status, 'clipped');
  assert.deepEqual(fetchTwin.calls, [TWIN]);
  const text = v.clipping(result.slug);
  assert.match(text, /^title: "Setup guide"$/m);
  assert.match(text, new RegExp(`^source: "${URL_A}"$`, 'm'));
  assert.match(text, new RegExp(`^twin-url: "${TWIN}"$`, 'm'));
  assert.match(text, /^extraction: plaintext-twin$/m);
  assert.ok(text.includes(`---\n\n${MD.trimEnd()}\n`), 'the Markdown is stored as it is, with no fence around it');
  assert.deepEqual(v.rows(), []);
  assert.deepEqual(v.declines(), []);

  const again = clip([URL_A], { fetchTwin: notCalled('a probe') });
  assert.equal(again.result.status, 'duplicate');
  const direct = clip([TWIN], { extract: notCalled('extraction'), fetchText: notCalled('the text fetch') });
  assert.equal(direct.result.status, 'duplicate', 'a later direct clip of the twin is a duplicate too');
});

const TITLES = [
  ['its first # heading', body('Heading title'), { title: 'Page title' }, 'Heading title'],
  ['the page title when it has no heading', body(''), { title: 'Page title' }, 'Page title'],
  ['a name from the page URL when there is neither', body(''), { title: '' }, 'setup'],
];
for (const [name, text, page, expected] of TITLES) {
  test(`the twin's title is ${name}`, (t) => {
    const v = vault(t);
    const { result } = clip([URL_A], { extract: () => ({ ...page, contentMarkdown: 'Back to top' }), fetchTwin: twins({ [TWIN]: served(text) }) });
    assert.equal(result.status, 'clipped');
    assert.match(v.clipping(result.slug), new RegExp(`^title: "${expected}"$`, 'm'));
  });
}

const PROBES = [
  ['a query, a fragment and a trailing slash are left off the base', 'https://docs.example.test/guide/setup/?tab=1#top', {}, [TWIN, `${BASE}.md`, LLMS]],
  ['an empty path skips the two suffix probes', 'https://docs.example.test/?x=1', {}, [LLMS]],
];
for (const [name, url, signals, expected] of PROBES) {
  test(`probes: ${name}`, (t) => {
    vault(t);
    const fetchTwin = twins({});
    clip([url], { extract: thin(signals), fetchTwin });
    assert.deepEqual(fetchTwin.calls, expected);
  });
}

test('probes go in order: the suffixes, a Markdown link of the page, then the matching entry of /llms.txt', (t) => {
  const v = vault(t);
  const link = 'https://docs.example.test/export/setup-source';
  const entry = 'https://docs.example.test/guide/setup/index.html.md';
  const llms = `# Docs\n\n- [Setup](${entry}): how to set up\n- [Other](/guide/other.md): not this page\n- [Index](/llms.txt)\n`;
  const fetchTwin = twins({ [LLMS]: served(llms, { type: 'text/plain' }), [entry]: served(MD) });
  const { result } = clip([URL_A], { extract: thin({ pageSignals: { tabControls: 0, pdfLinks: [], markdownLinks: [link] } }), fetchTwin });
  assert.deepEqual(fetchTwin.calls, [TWIN, `${BASE}.md`, link, LLMS, entry], 'five extra requests at most');
  assert.equal(result.status, 'clipped');
  assert.match(v.clipping(result.slug), new RegExp(`^twin-url: "${entry}"$`, 'm'));
});

test('an /llms.txt with no entry for the page is not a twin, however long it is', (t) => {
  const v = vault(t);
  const index = `# Docs\n\n${'- [Other page](/guide/other.md): another page of the documentation\n'.repeat(40)}`;
  const { result } = clip([URL_A], { fetchTwin: twins({ [LLMS]: served(index, { type: 'text/plain' }) }) });
  assert.equal(result.status, 'thin');
  assert.deepEqual(v.names(), []);
});

const REJECTED = [
  ['HTML', { type: 'text/html' }],
  ['JSON', { type: 'application/json', text: JSON.stringify({ words: MD }) }],
  ['an HTML document served as text/plain', { type: 'text/plain', text: `<!DOCTYPE html>\n<html><body>${MD}</body></html>` }],
  ['fewer than 100 words', { text: '# Setup\n\nOnly a few words here.' }],
  ['a redirect to another origin', { finalUrl: 'https://elsewhere.example.test/guide/setup.md.txt' }],
  ['a redirect to another path', { finalUrl: 'https://docs.example.test/login' }],
];
for (const [name, reply] of REJECTED) {
  test(`a twin that is ${name} is rejected, and the page goes on to the browser`, (t) => {
    const v = vault(t);
    const fetchTwin = twins({ [TWIN]: served(MD, reply), [`${BASE}.md`]: served(MD, reply) });
    const { result } = clip([URL_A], { fetchTwin, render: () => ({ ok: true, data: { title: 'Setup', contentMarkdown: ARTICLE } }) });
    assert.equal(result.status, 'clipped');
    const text = v.clipping(result.slug);
    assert.match(text, /^extraction: rendered$/m);
    assert.doesNotMatch(text, /twin-url/);
  });
}

test('a page whose static read fails is probed too, and a twin clips it', (t) => {
  const v = vault(t);
  const { result } = clip([URL_A], { extract: () => { throw new Error('fetch failed'); }, fetchTwin: twins({ [TWIN]: served(MD) }), render: notCalled('the render') });
  assert.equal(result.status, 'clipped');
  assert.match(v.clipping(result.slug), /^extraction: plaintext-twin$/m);
});

test('a twin already held as another clipping source is a duplicate and writes nothing', (t) => {
  const v = vault(t);
  writeFileSync(join(v.root, 'raw', 'clippings', 'Held.md'), `---\ntitle: "Held"\nsource: "${TWIN}"\ncreated: 2026-10-01\ntags: [clippings]\nquality: medium\nsource-hash: abc\n---\n\n${MD}`);
  const before = v.snapshot();
  const { result } = clip([URL_A], { fetchTwin: twins({ [TWIN]: served(MD) }), render: notCalled('the render') });
  assert.equal(result.status, 'duplicate');
  assert.deepEqual([...v.snapshot()], [...before]);
});

test('--recapture skips the twin dedup: changed twin text is a dated recapture, identical text is unchanged', (t) => {
  const v = vault(t);
  const first = clip([URL_A], { fetchTwin: twins({ [TWIN]: served(MD) }), today: () => '2026-11-01' });
  assert.equal(first.result.status, 'clipped');
  const same = clip([URL_A, '--recapture'], { fetchTwin: twins({ [TWIN]: served(MD) }), today: () => '2026-11-02' });
  assert.equal(same.result.status, 'unchanged');
  const changed = clip([URL_A, '--recapture'], { fetchTwin: twins({ [TWIN]: served(`${MD}\nOne more line, added later.\n`) }), today: () => '2026-11-03' });
  assert.equal(changed.result.status, 'clipped');
  assert.deepEqual(v.names(), ['Setup guide (recaptured 2026-11-03).md', 'Setup guide.md']);
  assert.match(v.clipping('Setup guide (recaptured 2026-11-03)'), /^twin-url: /m);
});

test('the known-URL readers know the twin, and the clipping still counts once', (t) => {
  const v = vault(t);
  clip([URL_A, '--topic=Docs'], { fetchTwin: twins({ [TWIN]: served(MD) }) });
  assert.equal(checkUrl(v.root, TWIN), 'clipped raw/clippings/Setup guide.md');
  assert.equal(checkUrl(v.root, URL_A), 'clipped raw/clippings/Setup guide.md');
  assert.deepEqual(listKnownUrls(v.root), [TWIN, URL_A].sort());
  assert.equal(summarizeTopic(v.root, 'Docs').clipped, 1);
  const cli = spawnSync(process.execPath, [join(SCRIPTS, 'known-urls.mjs'), '--check', TWIN], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
  assert.equal(cli.stdout.trim(), 'clipped raw/clippings/Setup guide.md');
});

test('no probe for a healthy page, a supplied file, --expand, a plain-text URL or a PDF URL', (t) => {
  const v = vault(t);
  const fetchTwin = twins({ [TWIN]: served(MD), 'https://docs.example.test/guide/notes.md.txt': served(MD) });
  const saved = join(v.root, 'saved.md');
  writeFileSync(saved, ARTICLE);
  const healthy = clip(['https://docs.example.test/guide/healthy'], { extract: () => ({ title: 'Healthy', contentMarkdown: ARTICLE }), fetchTwin });
  assert.equal(healthy.result.status, 'clipped');
  clip(['https://docs.example.test/guide/supplied', '--from-file', saved], { fetchTwin, render: notCalled('the render') });
  const expanded = clip(['https://docs.example.test/guide/expanded', '--expand'], { fetchTwin, render: () => ({ ok: true, data: { title: 'Setup', contentMarkdown: ARTICLE }, coverage: { tabs: 0, panels: 0, details: 0, tables: 0, code: 0, truncated: false } }) });
  assert.equal(expanded.result.status, 'clipped');
  clip(['https://docs.example.test/guide/notes.txt'], { fetchText: () => ({ ok: true, type: 'text/plain', text: 'plain '.repeat(150) }), fetchTwin });
  clip(['https://docs.example.test/guide/paper.pdf'], { extract: () => { throw new Error('not a page'); }, fetchTwin });
  assert.deepEqual(fetchTwin.calls, []);
});

// ---------------------------------------------------------------- --find-twin
const PARTIAL = { title: 'Setup guide', contentMarkdown: ARTICLE, fidelityWarnings: [{ kind: 'heading', label: 'Install' }] };

test('--find-twin prints a twin for a page that clipped with a partial warning, and writes nothing', (t) => {
  const v = vault(t);
  assert.equal(clip([URL_A], { extract: () => PARTIAL }).result.status, 'clipped');
  const before = v.snapshot();
  const fetchTwin = twins({ [TWIN]: served(MD) });
  const { result, lines } = clip([URL_A, '--find-twin'], { extract: () => PARTIAL, fetchTwin });
  assert.ok(lines.some((line) => line.includes(TWIN)), lines.join('\n'));
  assert.equal(result.twinUrl, TWIN);
  assert.deepEqual([...v.snapshot()], [...before]);
});

test('--find-twin probes nothing for a healthy page or a page not clipped', (t) => {
  const v = vault(t);
  assert.equal(clip([URL_A], { extract: () => ({ title: 'Setup guide', contentMarkdown: ARTICLE }) }).result.status, 'clipped');
  const fetchTwin = twins({ [TWIN]: served(MD) });
  const healthy = clip([URL_A, '--find-twin'], { fetchTwin });
  const unknown = clip(['https://docs.example.test/guide/unknown', '--find-twin'], { fetchTwin });
  assert.deepEqual(fetchTwin.calls, []);
  assert.equal(healthy.exitCode, undefined);
  assert.equal(unknown.exitCode, undefined);
  assert.deepEqual(v.rows(), []);
});

test('--find-twin is declared with its usage, and refuses --from-file and --expand', () => {
  assert.deepEqual(checkClipArgs([URL_A, '--find-twin'], CLIP_SPECS.clip), { ok: true });
  assert.match(CLIP_SPECS.clip.usage.join('\n'), /--find-twin/);
  for (const extra of [['--from-file', 'x.md'], ['--expand']]) {
    const { exitCode, result } = clip([URL_A, '--find-twin', ...extra], {});
    assert.equal(exitCode, 2);
    assert.equal(result.status, 'error');
  }
});

// ---------------------------------------------------------------- the repair tool
test('apply-reclips refuses a twin clipping, as it refuses a supplied one', async (t) => {
  const v = vault(t);
  const file = join(v.root, 'raw', 'clippings', 'Twin.md');
  writeFileSync(file, `---\ntitle: "Twin"\nsource: "${URL_A}"\ncreated: 2026-10-01\ntags: [clippings]\nquality: medium\nextraction: plaintext-twin\ntwin-url: "${TWIN}"\nsource-hash: ${'a'.repeat(64)}\n---\n\n${MD}`);
  const readPage = () => assert.fail('nothing is read for a twin clipping');
  const report = await runReclips({ vaultPath: v.root, targets: ['raw/clippings/Twin.md'], apply: true, readPage });
  assert.equal(report.selected, 0);
  assert.equal(report.refused.length, 1);
  assert.match(report.refused[0].reason, /plaintext-twin/);
  assert.match(report.refused[0].reason, /--recapture/);
  assert.equal(readFileSync(file, 'utf8').includes(MD), true);
});

// ---------------------------------------------------------------- the fetch child
test('the fetch child reports where the redirects ended', async (t) => {
  const server = createServer((req, res) => {
    if (req.url === '/old') { res.writeHead(302, { location: '/new.md' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/markdown' });
    res.end('# Moved');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  // An asynchronous spawn: a server in this process would never answer a synchronous one.
  const { stdout } = await promisify(execFile)(process.execPath, [join(SCRIPTS, 'lib', 'fetch-text-child.mjs'), `${base}/old`]);
  const reply = JSON.parse(stdout.trim());
  assert.equal(reply.ok, true);
  assert.equal(reply.finalUrl, `${base}/new.md`);
});
