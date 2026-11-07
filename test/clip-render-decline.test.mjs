import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, classifyShortExtraction } from '../scripts/clip.mjs';

// What a thin page's browser render may and may not justify. A decline says re-fetching cannot change the answer, and
// only a browser that read the page has learned that. The render is injected, so no browser runs; each test reads the
// decline and triage files the temp vault was left with.

const URL_A = 'https://docs.example.test/app/page';
const THIN = 'Please enable JavaScript to view this page.';
const SHELL_REASON = 'thin content (SPA/paywall shell)';
const ROUTE = 'save the page from a signed-in browser and record it with clip.mjs <url> --from-file <path>';
const NOT_READ = 'triage recorded; not declined — browser render did not read the page';
const thinPage = () => ({ title: 'App page', contentMarkdown: THIN });
const article = () => ({ title: 'App page', contentMarkdown: 'The rendered article explains the page in plain words. '.repeat(30) });

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-render-decline-'));
  const clippings = join(root, 'raw', 'clippings');
  mkdirSync(clippings, { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const read = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  return {
    clippings: () => readdirSync(clippings),
    clipping: (name) => readFileSync(join(clippings, name), 'utf8'),
    declines: () => JSON.parse(read('declined.json') ?? '[]').map(({ url, reason }) => ({ url, reason })),
    rows: () => (read('triage.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t === 'issue').map(({ url, kind, reason }) => ({ url, kind, reason })),
  };
}

// The browser answers by address. A thin page is judged against a made-up address on the same site, rendered beside it: a site that
// serves one shell for every address says nothing about this URL. That address gets a different page here, as a real site's own
// not-found page would; the matching case is in clip-unknown-route.test.mjs.
const isProbe = (url) => /\/wiki-master-probe-[0-9a-f]{8}$/.test(url);
const NOT_FOUND_PAGE = () => ({ ok: true, data: { title: 'Not found', contentMarkdown: 'This address does not exist on the site.' } });

// Runs main with console output captured; returns the result and the printed lines.
function clip(extract, pageRender) {
  const render = (url, options) => (isProbe(url) ? NOT_FOUND_PAGE() : pageRender(url, options));
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: main([URL_A], { extract, render }), lines }; }
  finally { console.log = log; console.error = err; }
}

// ---------------------------------------------------------------- one test per outcome of the thin-path render
test('a render that reads at least 100 words is clipped as rendered, with no decline and no row', (t) => {
  const v = vault(t);
  const { result, lines } = clip(thinPage, () => ({ ok: true, data: article() }));
  assert.equal(result.status, 'clipped');
  assert.deepEqual(lines, [`clipped: raw/clippings/${result.slug}.md (quality=medium)`]);
  assert.match(v.clipping(`${result.slug}.md`), /^extraction: rendered$/m);
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows(), []);
});

test('a render that read the page and found it still thin is declined and queued', (t) => {
  const v = vault(t);
  const { result, lines } = clip(thinPage, () => ({ ok: true, data: { title: 'App page', contentMarkdown: 'Back to top' } }));
  assert.equal(result.status, 'thin');
  assert.deepEqual(lines, [`thin content (${ROUTE}; decline + triage recorded): ${URL_A}`]);
  assert.deepEqual(v.declines(), [{ url: URL_A, reason: SHELL_REASON }]);
  assert.deepEqual(v.rows(), [{ url: URL_A, kind: 'thin', reason: SHELL_REASON }]);
  assert.deepEqual(v.clippings(), []);
});

test('an unavailable render is queued and not declined, with the setup line', (t) => {
  const v = vault(t);
  const { result, lines } = clip(thinPage, () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'playwright-core is not installed.' }));
  assert.equal(result.status, 'thin');
  assert.deepEqual(lines, [`thin content (${ROUTE}; triage recorded; not declined — browser render unavailable): ${URL_A}`]);
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows(), [{ url: URL_A, kind: 'thin', reason: SHELL_REASON }]);
});

test('a blocked render is queued under the thin verdict with its reason, and not declined', (t) => {
  const v = vault(t);
  const { result, lines } = clip(thinPage, () => ({ ok: false, kind: 'blocked', reason: 'access denied (HTTP 403)' }));
  assert.deepEqual(v.declines(), []);
  assert.equal(result.status, 'thin');
  assert.deepEqual(lines, [`thin content (${ROUTE}): ${URL_A}; ${NOT_READ} (access denied (HTTP 403))`]);
  assert.deepEqual(v.rows(), [{ url: URL_A, kind: 'thin', reason: `${SHELL_REASON}; browser render did not read the page (access denied (HTTP 403))` }]);
});

test('a render that timed out is queued under the thin verdict with its reason, and not declined', (t) => {
  const v = vault(t);
  const { result, lines } = clip(thinPage, () => ({ ok: false, kind: 'failed', reason: 'timeout' }));
  assert.deepEqual(v.declines(), []);
  assert.equal(result.status, 'thin');
  assert.deepEqual(lines, [`thin content (${ROUTE}): ${URL_A}; ${NOT_READ} (timeout)`]);
  assert.deepEqual(v.rows(), [{ url: URL_A, kind: 'thin', reason: `${SHELL_REASON}; browser render did not read the page (timeout)` }]);
});

test('a render that found the page gone is queued as gone, and not declined', (t) => {
  const v = vault(t);
  const reason = 'page not found (HTTP 404) — the source is dead, not blocked';
  const { result, lines } = clip(thinPage, () => ({ ok: false, kind: 'gone', reason }));
  assert.deepEqual(v.declines(), []);
  assert.equal(result.status, 'failed');
  assert.deepEqual(lines, [`page gone: ${URL_A}; ${NOT_READ} (${reason})`]);
  assert.deepEqual(v.rows(), [{ url: URL_A, kind: 'gone', reason }]);
});

// ---------------------------------------------------------------- the verdict a failed render leaves standing
test('a failed render over a wrong-node extraction is queued as wrong-node, and not declined', (t) => {
  const v = vault(t);
  const description = 'Comprehensive guidance describing mandatory manufacturing inspection requirements, laboratory certification procedures, and enforcement deadlines affecting distributors nationwide.';
  const markdown = 'A short roundup of unrelated items.';
  const verdict = classifyShortExtraction({ markdown, description });
  assert.equal(verdict.kind, 'wrong_node');
  const { lines } = clip(() => ({ title: 'App page', contentMarkdown: markdown, description }), () => ({ ok: false, kind: 'failed', reason: 'timeout' }));
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(lines, [`possible extraction mismatch (${ROUTE}): ${URL_A}; ${NOT_READ} (timeout)`]);
  assert.deepEqual(v.rows(), [{ url: URL_A, kind: 'wrong-node', reason: `${verdict.reason}; browser render did not read the page (timeout)` }]);
});

test('a failed render does not stop a short real article from clipping', (t) => {
  const v = vault(t);
  const markdown = '## Specification\n\nSee the main specification for complete information about this extension.\n\n## Number\n\n52\n\n## Revision\n\n4\n\n## Dependencies\n\nVersion 1.0 of the core';
  const { result } = clip(() => ({ title: 'Reference page', contentMarkdown: markdown }), () => ({ ok: false, kind: 'failed', reason: 'timeout' }));
  assert.equal(result.status, 'clipped');
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows(), []);
});

test('a page whose render timed out can still be clipped by a later retry', (t) => {
  const v = vault(t);
  clip(thinPage, () => ({ ok: false, kind: 'failed', reason: 'timeout' }));
  const retry = clip(thinPage, () => ({ ok: true, data: article() }));
  assert.equal(retry.result.status, 'clipped');
  assert.deepEqual(v.declines(), []);
});

// ---------------------------------------------------------------- the render after a failed fetch uses the same seam
test('a failed fetch whose render read a thin page is declined, because that browser read it', (t) => {
  const v = vault(t);
  const { result } = clip(() => { throw new Error('fetch failed'); }, () => ({ ok: true, data: { title: 'App page', contentMarkdown: 'Back to top' } }));
  assert.equal(result.status, 'thin');
  assert.deepEqual(v.declines(), [{ url: URL_A, reason: SHELL_REASON }]);
});

test('a failed fetch whose render also failed is queued under the render\'s kind and reason, and not declined', (t) => {
  const v = vault(t);
  const { result, lines } = clip(() => { throw new Error('fetch failed'); }, () => ({ ok: false, kind: 'blocked', reason: 'access denied (HTTP 403)' }));
  assert.equal(result.status, 'failed');
  assert.deepEqual(lines, [`clip failed — access denied (HTTP 403) (queued for triage): ${URL_A}`]);
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows(), [{ url: URL_A, kind: 'blocked', reason: 'access denied (HTTP 403)' }]);
});
