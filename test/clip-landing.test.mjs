import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/clip.mjs';
import { main as clipPdf } from '../scripts/clip-pdf.mjs';
import { recordIssue } from '../scripts/lib/triage.mjs';

// A landing page is a short page whose only substance is one link to a PDF. It is written, labeled, and the document it
// points to is queued so that clip-pdf.mjs closes the row once the document is in the vault. Nothing here uses a browser.

const PAGE = 'https://docs.example.test/resources/guide';
const PDF = 'https://docs.example.test/files/guide.pdf';
const OTHER_PDF = 'https://docs.example.test/files/appendix.pdf';
const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(' ');
const signals = (...pdfLinks) => ({ tabControls: 0, pdfLinks, markdownLinks: [] });
const page = (n, ...links) => () => ({ title: 'Guide download', contentMarkdown: words(n), pageSignals: signals(...links) });
const notCalled = (name) => () => assert.fail(`${name} must not run`);
const UNAVAILABLE = () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'No browser' });

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-landing-'));
  const clippings = join(root, 'raw', 'clippings');
  mkdirSync(clippings, { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const read = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  const events = () => (read('triage.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return {
    root,
    names: () => readdirSync(clippings),
    clipping: (name) => readFileSync(join(clippings, `${name}.md`), 'utf8'),
    declines: () => JSON.parse(read('declined.json') ?? '[]'),
    rows: () => events().filter((e) => e.t === 'issue'),
    open: () => events().reduce((open, e) => { const k = `${e.url} ${e.kind}`; if (e.t === 'issue') open.set(k, e); else open.delete(k); return open; }, new Map()).size,
  };
}

function run(fn, argv, deps) {
  const lines = [];
  const log = console.log, err = console.error, code = process.exitCode;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: fn(argv, deps), lines }; }
  finally { console.log = log; console.error = err; process.exitCode = code; }
}
// `probes` is every plain-text twin address asked for; no twin exists.
function clip(argv, extract, render = notCalled('the render')) {
  const probes = [];
  const fetchTwin = (url) => { probes.push(url); return { ok: false, reason: 'status 404' }; };
  return { ...run(main, argv, { extract, fetchText: notCalled('the text fetch'), fetchTwin, render }), probes };
}

const LANDING = [
  ['under 300 words', 150],
  ['under 100 words, which is still written and not declined', 20],
  ['299 words', 299],
];
for (const [name, count] of LANDING) {
  test(`a page of ${name} with one PDF link is a landing page`, (t) => {
    const v = vault(t);
    const { result, lines, probes } = clip([PAGE, '--topic=Docs'], page(count, PDF));
    assert.equal(result.status, 'clipped');
    assert.equal(result.landing, true);
    assert.equal(result.documentLink, PDF);
    const text = v.clipping(result.slug);
    assert.match(text, /^landing-page: true$/m);
    assert.match(text, new RegExp(`^document-link: "${PDF}"$`, 'm'));
    assert.ok(lines.includes(`landing page: the document is at ${PDF}; run clip-pdf.mjs "${PDF}"`), lines.join('\n'));
    assert.deepEqual(v.declines(), []);
    assert.deepEqual(probes, [], 'a landing page is not looked up as a twin');
    const rows = v.rows();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].url, rows[0].kind, rows[0].retryable, rows[0].topic], [PDF, 'attention', true, 'Docs']);
  });
}

const NOT_LANDING = [
  ['two PDF links', 150, [PDF, OTHER_PDF]],
  ['300 words', 300, [PDF]],
  ['no PDF link', 150, []],
];
for (const [name, count, links] of NOT_LANDING) {
  test(`a page with ${name} is an ordinary clipping`, (t) => {
    const v = vault(t);
    const { result, lines } = clip([PAGE], page(count, ...links));
    assert.equal(result.status, 'clipped');
    assert.equal(result.landing, undefined);
    assert.doesNotMatch(v.clipping(result.slug), /landing-page|document-link/);
    assert.doesNotMatch(lines.join('\n'), /landing page/);
    assert.deepEqual(v.rows(), []);
  });
}

test('a page under 100 words with two PDF links is still thin, and is rendered first', (t) => {
  const v = vault(t);
  let rendered = 0;
  const { result } = clip([PAGE], page(20, PDF, OTHER_PDF), () => { rendered++; return UNAVAILABLE(); });
  assert.equal(result.status, 'thin');
  assert.equal(rendered, 1);
  assert.deepEqual(v.names(), []);
});

test('a page read by --expand is not checked for a landing page', (t) => {
  const v = vault(t);
  const render = () => ({ ok: true, data: { title: 'Guide', contentMarkdown: words(150), pageSignals: signals(PDF) }, coverage: { tabs: 0, panels: 0, details: 0, tables: 0, code: 0, truncated: false } });
  const { result } = clip([PAGE, '--expand'], notCalled('static extraction'), render);
  assert.equal(result.status, 'clipped');
  assert.doesNotMatch(v.clipping(result.slug), /landing-page/);
  assert.deepEqual(v.rows(), []);
});

test('a page the browser reads, and finds to be a landing page, is written as one', (t) => {
  const v = vault(t);
  const render = () => ({ ok: true, data: { title: 'Guide', contentMarkdown: words(20), pageSignals: signals(PDF) } });
  const { result } = clip([PAGE], () => ({ title: 'Guide', contentMarkdown: 'Back to top' }), render);
  assert.equal(result.status, 'clipped');
  assert.match(v.clipping(result.slug), /^landing-page: true$/m);
  assert.deepEqual(v.declines(), []);
});

test('the attention row for a PDF address that fails is retryable, and says how to clip it', (t) => {
  const v = vault(t);
  const url = 'https://docs.example.test/files/paper.pdf';
  const { result } = clip([url], () => { throw new Error('not a page'); });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, new RegExp(`clip-pdf\\.mjs "${url}"`));
  assert.deepEqual(v.rows().map((r) => [r.kind, r.retryable]), [['attention', true]]);
});

// ---------------------------------------------------------------- clip-pdf closes the row
const READY = () => ({ ok: true, fatal: false, lines: [] });
const BODY = words(160);

test('clip-pdf.mjs closes the landing row when it clips the document, and when the document is already in the vault', (t) => {
  const v = vault(t);
  const file = join(v.root, 'guide.pdf');
  writeFileSync(file, '%PDF-1.4\n');
  clip([PAGE], page(150, PDF));
  assert.equal(v.open(), 1);

  const deps = { toolchain: READY, extractText: () => BODY };
  const first = run(clipPdf, [file, `--source=${PDF}`], deps);
  assert.equal(first.result.status, 'clipped', first.lines.join('\n'));
  assert.equal(v.open(), 0, 'a clipped document closes the row');

  recordIssue(v.root, { url: PDF, kind: 'attention', reason: 'landing page points here', retryable: true });
  assert.equal(v.open(), 1);
  const again = run(clipPdf, [file, `--source=${PDF}`], deps);
  assert.equal(again.result.status, 'duplicate');
  assert.equal(v.open(), 0, 'a duplicate closes it too');
});

// ---------------------------------------------------------------- a credentialed link is no landing document
const SECRET_PDF = 'https://reader:secretpw1@files.example.test/private.pdf';
const vaultText = (v) => [...v.names().map((n) => v.clipping(n.replace(/\.md$/, ''))), JSON.stringify(v.rows()), JSON.stringify(v.declines())].join('\n');

test('a page whose only PDF link carries a username or password is an ordinary clipping: no label, no row, no credential anywhere', (t) => {
  const v = vault(t);
  const { result, lines } = clip([PAGE], page(150, SECRET_PDF));
  assert.equal(result.status, 'clipped');
  assert.equal(result.landing, undefined);
  assert.doesNotMatch(v.clipping(result.slug), /landing-page|document-link/);
  assert.deepEqual(v.rows(), []);
  assert.ok(!(lines.join('\n') + vaultText(v)).includes('secretpw1'), 'the credential reached an output or the vault');
});

test('the credentialed link is dropped before the PDF links are counted, so one clean link is still the landing document', (t) => {
  const v = vault(t);
  const { result, lines } = clip([PAGE], page(150, SECRET_PDF, PDF));
  assert.equal(result.documentLink, PDF);
  assert.deepEqual(v.rows().map((r) => r.url), [PDF]);
  assert.ok(!(lines.join('\n') + vaultText(v)).includes('secretpw1'));
});

test('the same holds for a landing page the browser reads', (t) => {
  const v = vault(t);
  const render = () => ({ ok: true, data: { title: 'Guide', contentMarkdown: words(20), pageSignals: signals(SECRET_PDF) } });
  const { lines } = clip([PAGE], () => ({ title: 'Guide', contentMarkdown: 'Back to top' }), render);
  assert.deepEqual(v.rows().filter((r) => r.kind === 'attention'), []);
  assert.ok(!(lines.join('\n') + vaultText(v)).includes('secretpw1'));
});
