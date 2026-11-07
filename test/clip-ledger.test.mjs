import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/clip.mjs';
import { extractHtml } from '../scripts/lib/html-extract.mjs';

// `--ledger <file>` appends one JSON line per address, with the same sixteen fields for every outcome `clip.mjs` can end in.
// Fetching, extraction and the browser are injected.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const FIELDS = ['url', 'status', 'path', 'sourceHash', 'quality', 'topic', 'extraction', 'fidelity', 'reason', 'twinUrl', 'documentLink', 'expandCoverage', 'unexpandedTabs', 'extractionRetry', 'visibleWords', 'extractedWords'];
const PAGE = 'https://docs.example.test/guide/setup';
const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(' ');
const article = (extra = {}) => ({ title: 'Setup guide', contentMarkdown: `# Setup guide\n\n${words(150)}`, ...extra });
const NO_BROWSER = () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'No browser' });
const NO_TWIN = () => ({ ok: false, reason: 'status 404' });
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-ledger-'));
  const clippings = join(root, 'raw', 'clippings');
  mkdirSync(clippings, { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const ledger = join(root, 'ledger.jsonl');
  return {
    root, ledger, clippings,
    rows: () => (existsSync(ledger) ? readFileSync(ledger, 'utf8') : '').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    state: (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : ''; },
    names: () => readdirSync(clippings),
  };
}

function clip(argv, deps = {}) {
  const lines = [];
  const log = console.log, err = console.error, code = process.exitCode;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  process.exitCode = undefined;
  try {
    const result = main(argv, { extract: () => article(), fetchTwin: NO_TWIN, render: NO_BROWSER, today: () => '2026-11-06', runtimeAvailable: () => true, sleep: () => {}, ...deps });
    return { result, lines, exitCode: process.exitCode ?? 0 };
  } finally { console.log = log; console.error = err; process.exitCode = code; }
}

// A single run with a ledger appends exactly one row, with every field present.
function row(v, url, extra, deps) {
  const run = clip([url, '--ledger', v.ledger, ...extra], deps);
  const rows = v.rows();
  assert.equal(rows.length, 1, run.lines.join('\n'));
  assert.deepEqual(Object.keys(rows[0]), FIELDS);
  assert.equal(rows[0].url, url);
  return { ...run, row: rows[0] };
}
// What is not named in `want` does not apply to that outcome.
const NONE = Object.fromEntries(FIELDS.map((f) => [f, null]));
const expectRow = (actual, want) => assert.deepEqual(actual, { ...NONE, ...want });

const seed = (v, name, source, extra = '') => writeFileSync(join(v.clippings, `${name}.md`), `---\ntitle: "${name}"\nsource: "${source}"\ncreated: 2026-01-01\ntags: [clippings]\nquality: medium\n${extra}source-hash: ${sha256(name)}\n---\n\n${words(150)}\n`);

// ---------------------------------------------------------------- one row for each outcome

test('clipped: the written file, its hash, quality, topic and extraction', (t) => {
  const v = setup(t);
  const { row: r, result } = row(v, PAGE, ['--topic=Docs', '--quality=high']);
  assert.equal(result.status, 'clipped');
  const text = readFileSync(join(v.clippings, `${result.slug}.md`), 'utf8');
  const hash = text.match(/^source-hash: (\w+)$/m)[1];
  expectRow(r, { url: PAGE, status: 'clipped', path: `raw/clippings/${result.slug}.md`, sourceHash: hash, quality: 'high', topic: 'Docs', extraction: 'text', fidelity: 'high' });
});

test('clipped: a retried extraction, its word counts and a partial fidelity warning', (t) => {
  const v = setup(t);
  const { row: r } = row(v, PAGE, [], { extract: () => article({ extractionRetry: 'unwrap-inline', visibleWords: 900, fidelityWarnings: [{ kind: 'heading', label: 'Install' }] }) });
  assert.equal(r.status, 'clipped');
  assert.equal(r.extractionRetry, 'unwrap-inline');
  assert.equal(r.visibleWords, 900);
  assert.equal(r.extractedWords, 153);
  assert.equal(r.fidelity, 'partial');
});

test('clipped by --expand: rendered, with its coverage line', (t) => {
  const v = setup(t);
  const coverage = { tabs: 2, panels: 2, details: 0, tables: 0, code: 0, truncated: false };
  const { row: r } = row(v, PAGE, ['--expand'], { render: () => ({ ok: true, data: article(), coverage }) });
  assert.equal(r.status, 'clipped');
  assert.equal(r.extraction, 'rendered');
  assert.equal(r.expandCoverage, 'tabs=2 panels=2 details=0 tables=0 code=0 truncated=false');
});

test('clipped as the plain-text twin of a thin page', (t) => {
  const v = setup(t);
  const twin = `${PAGE}.md.txt`;
  const text = `# Setup guide\n\n${words(150)}\n`;
  const { row: r } = row(v, PAGE, [], { extract: () => ({ title: 'Setup', contentMarkdown: 'Back to top' }), fetchTwin: (url) => (url === twin ? { ok: true, type: 'text/markdown', text, finalUrl: url } : NO_TWIN()) });
  assert.equal(r.status, 'clipped');
  assert.equal(r.extraction, 'plaintext-twin');
  assert.equal(r.twinUrl, twin);
});

test('clipped as a landing page: the document it points to', (t) => {
  const v = setup(t);
  const pdf = 'https://docs.example.test/files/guide.pdf';
  const { row: r } = row(v, PAGE, [], { extract: () => ({ title: 'Guide download', contentMarkdown: words(40), pageSignals: { tabControls: 0, pdfLinks: [pdf], markdownLinks: [] } }) });
  assert.equal(r.status, 'clipped');
  assert.equal(r.documentLink, pdf);
});

test('clipped with tabs the page showed no panel for: unexpandedTabs above 0, from the real extractor', async (t) => {
  const v = setup(t);
  const tabs = ['Alpha', 'Beta', 'Gamma'].map((label, i) => `<button role="tab" aria-controls="p${i}">${label}</button>`).join('');
  const panels = [0, 1, 2].map((i) => `<div role="tabpanel" id="p${i}" hidden> </div>`).join('');
  const prose = `<p>${'The guide explains how the service behaves in plain words so that the extractor has an article to keep. '.repeat(8)}</p>`;
  const data = await extractHtml(`<!doctype html><html><head><title>Guide</title></head><body><main><h1>Guide</h1>${prose}<div role="tablist">${tabs}</div>${panels}</main></body></html>`, PAGE);
  const { row: r } = row(v, PAGE, [], { extract: () => data });
  assert.equal(r.status, 'clipped');
  assert.equal(r.unexpandedTabs, 3);
});

test('unchanged: --recapture of identical text names the capture it matched', (t) => {
  const v = setup(t);
  const first = clip([PAGE]).result;
  const { row: r } = row(v, PAGE, ['--recapture']);
  assert.equal(r.status, 'unchanged');
  assert.equal(r.path, `raw/clippings/${first.slug}.md`);
  assert.equal(r.sourceHash, readFileSync(join(v.clippings, `${first.slug}.md`), 'utf8').match(/^source-hash: (\w+)$/m)[1]);
  assert.equal(r.extraction, 'text');
});

test('clash: a --slug already taken', (t) => {
  const v = setup(t);
  seed(v, 'chosen', 'https://docs.example.test/other');
  const { row: r } = row(v, PAGE, ['--slug', 'chosen']);
  expectRow(r, { url: PAGE, status: 'clash', path: 'raw/clippings/chosen.md', reason: r.reason });
  assert.match(r.reason, /already exists/);
});

test('duplicate: the address is already clipped', (t) => {
  const v = setup(t);
  seed(v, 'Held', PAGE);
  expectRow(row(v, PAGE, []).row, { url: PAGE, status: 'duplicate' });
});

test('blocked: an unreliable domain', (t) => {
  const v = setup(t);
  const url = 'https://answers.com/question/1';
  expectRow(row(v, url, []).row, { url, status: 'blocked' });
});

test('declined: --decline records the decision, and a later clip meets it', (t) => {
  const v = setup(t);
  expectRow(row(v, PAGE, ['--decline=not relevant']).row, { url: PAGE, status: 'declined', reason: 'not relevant' });
  const second = clip([PAGE, '--ledger', v.ledger]);
  assert.equal(second.result.status, 'declined');
  const last = v.rows().at(-1);
  assert.equal(last.status, 'declined');
  assert.match(last.reason, /declined previously.*not relevant/);
});

test('thin: a stub the browser could not improve', (t) => {
  const v = setup(t);
  const { row: r } = row(v, PAGE, ['--topic=Docs'], { extract: () => ({ title: 'Stub', contentMarkdown: 'Too short to keep.' }) });
  expectRow(r, { url: PAGE, status: 'thin', topic: 'Docs', reason: 'thin content (SPA/paywall shell)' });
});

test('failed: the browser could not read the page either', (t) => {
  const v = setup(t);
  const { row: r } = row(v, PAGE, [], { extract: () => { throw new Error('no page'); }, render: () => ({ ok: false, kind: 'failed', reason: 'navigation timed out' }) });
  expectRow(r, { url: PAGE, status: 'failed', reason: 'navigation timed out' });
});

test('failed: a page that is gone', (t) => {
  const v = setup(t);
  const { row: r } = row(v, PAGE, [], { extract: () => ({ title: 'Stub', contentMarkdown: 'Too short to keep.' }), render: () => ({ ok: false, kind: 'gone', reason: 'HTTP 404' }) });
  expectRow(r, { url: PAGE, status: 'failed', reason: 'HTTP 404' });
});

test('error: a refused combination, with the exit code it leaves', (t) => {
  const v = setup(t);
  const url = 'https://docs.example.test/files/guide.pdf';
  const { row: r, exitCode } = row(v, url, ['--expand']);
  assert.equal(exitCode, 2);
  assert.equal(r.status, 'error');
  assert.match(r.reason, /--expand opens a page in a browser/);
});

test('--find-twin: skipped, no twin and twin', (t) => {
  const v = setup(t);
  assert.equal(clip([PAGE]).result.status, 'clipped');
  expectRow(row(v, PAGE, ['--find-twin']).row, { url: PAGE, status: 'skipped', reason: 'no clipping of it carries a partial fidelity warning' });
  rmSync(v.ledger);
  const partial = 'https://docs.example.test/guide/partial';
  clip([partial], { extract: () => article({ fidelityWarnings: [{ kind: 'heading', label: 'Install' }] }) });
  expectRow(row(v, partial, ['--find-twin']).row, { url: partial, status: 'no-twin' });
  rmSync(v.ledger);
  const twin = `${partial}.md.txt`;
  const { row: r } = row(v, partial, ['--find-twin'], { fetchTwin: (url) => (url === twin ? { ok: true, type: 'text/markdown', text: `# T\n\n${words(150)}`, finalUrl: url } : NO_TWIN()) });
  expectRow(r, { url: partial, status: 'twin', twinUrl: twin });
});

// ---------------------------------------------------------------- the list, the path and the credential

test('--list appends one row per address in order, a bad line with its address redacted', (t) => {
  const v = setup(t);
  const list = join(v.root, 'urls.txt');
  writeFileSync(list, ['https://one.example.test/a', 'https://reader:s3cretpw@docs.example.test/page?x=1', 'not a url', 'https://two.example.test/b'].join('\n'));
  const { exitCode } = clip(['--list', list, '--ledger', v.ledger]);
  assert.equal(exitCode, 0);
  const rows = v.rows();
  assert.deepEqual(rows.map((r) => [r.status, r.url]), [
    ['clipped', 'https://one.example.test/a'],
    ['error', 'https://docs.example.test/page?x=1'],
    ['error', null],
    ['clipped', 'https://two.example.test/b'],
  ]);
  for (const r of rows) assert.deepEqual(Object.keys(r), FIELDS);
  assert.ok(!readFileSync(v.ledger, 'utf8').includes('s3cretpw'));
});

for (const inside of ['raw', 'wiki']) {
  test(`a ledger inside ${inside}/ of the vault exits 2 before any clipping, alone or with --list`, (t) => {
    const v = setup(t);
    mkdirSync(join(v.root, inside, 'sub'), { recursive: true });
    const file = join(v.root, inside, 'sub', 'ledger.jsonl');
    const list = join(v.root, 'urls.txt');
    writeFileSync(list, 'https://one.example.test/a\n');
    for (const argv of [[PAGE, '--ledger', file], ['--list', list, '--ledger', file]]) {
      const r = clip(argv, { extract: () => assert.fail('nothing may be read') });
      assert.equal(r.exitCode, 2, argv.join(' '));
      assert.equal(r.result.status, 'error');
      assert.ok(!existsSync(file));
    }
    assert.deepEqual(v.names(), []);
  });
}

test('a credentialed address with a ledger: exit 2, a redacted row, and the credential nowhere', (t) => {
  const v = setup(t);
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'clip.mjs'), 'https://reader:s3cretpw@docs.example.test/page', '--ledger', v.ledger, '--topic=Docs'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
  assert.equal(r.status, 2, r.stderr);
  expectRow(v.rows()[0], { url: 'https://docs.example.test/page', status: 'error', topic: 'Docs', reason: v.rows()[0].reason });
  assert.match(v.rows()[0].reason, /carries a username or password/);
  const everything = [r.stdout, r.stderr, readFileSync(v.ledger, 'utf8'), v.state('triage.jsonl'), v.state('declined.json')].join('\n');
  assert.ok(!everything.includes('s3cretpw') && !everything.includes('reader:'));
});
