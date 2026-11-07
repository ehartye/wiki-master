import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { main, classifyShortExtraction } from '../scripts/clip.mjs';
import { openIssues, loadIssueLog } from '../scripts/lib/triage.mjs';

// A browser that read a thin page has not learned the page is thin when the site serves the same shell for every address:
// the clipper renders one made-up address beside it and compares the two texts. Equal texts record no decline, only a labelled
// row; anything else declines as before. The render is injected and answers by address, so no browser runs.

const URL_A = 'https://docs.example.test/app/page';
const SHELL = 'Please enable JavaScript to view this page.';
const SHELL_REASON = 'thin content (SPA/paywall shell)';
const probeOf = (url, tail = '') => {
  const u = new URL(url);
  const parts = u.pathname.split('/');
  const trailing = parts.length > 2 && parts.at(-1) === '';
  if (trailing) parts.pop();
  parts[parts.length - 1] = `wiki-master-probe-${createHash('sha256').update(url).digest('hex').slice(0, 8)}`;
  if (trailing) parts.push('');
  return `${u.origin}${parts.join('/')}${tail}`;
};
const read = (markdown) => ({ ok: true, data: { title: 'App page', contentMarkdown: markdown } });
const article = () => read('The rendered article explains the page in plain words. '.repeat(30));
const thinPage = () => ({ title: 'App page', contentMarkdown: SHELL });

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-unknown-route-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const file = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  return {
    reset: () => rmSync(join(root, '.wiki-master'), { recursive: true, force: true }),
    declines: () => JSON.parse(file('declined.json') ?? '[]').map(({ url }) => url),
    rows: () => openIssues(loadIssueLog(root)).map(({ url, kind, reason }) => ({ url, kind, reason })),
  };
}

// `answers(url)` is the browser: it is asked for the page and for the made-up address, and its calls are recorded.
function clip(extract, answers, url = URL_A) {
  const calls = [];
  const render = (u) => { calls.push(u); return answers(u); };
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: main([url], { extract, render }), lines, calls }; }
  finally { console.log = log; console.error = err; }
}
const shellEverywhere = (text = SHELL) => (u) => read(u === URL_A ? text : `  ${text.toUpperCase()}\n`);

test('a thin page that reads the same as a made-up address is queued as an unverified URL, not declined, and a later clip closes the row', (t) => {
  const v = vault(t);
  const { result, lines, calls } = clip(thinPage, shellEverywhere());
  assert.equal(result.status, 'thin');
  assert.deepEqual(calls, [URL_A, probeOf(URL_A)]);
  assert.deepEqual(v.declines(), []);
  const rows = v.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'thin');
  assert.ok(rows[0].reason.startsWith('unverified URL:'), rows[0].reason);
  assert.ok(lines.some((l) => l.includes('not declined') && l.includes('unverified URL')), lines.join('\n'));

  const later = clip(thinPage, () => article());
  assert.equal(later.result.status, 'clipped');
  assert.deepEqual(v.rows(), []);
});

test('the same holds when the fetch failed and the browser read a thin page', (t) => {
  const v = vault(t);
  const { result, calls } = clip(() => { throw new Error('fetch failed'); }, shellEverywhere());
  assert.equal(result.status, 'thin');
  assert.deepEqual(calls, [URL_A, probeOf(URL_A)]);
  assert.deepEqual(v.declines(), []);
  assert.ok(v.rows()[0].reason.startsWith('unverified URL:'));
});

test('a made-up address that reads differently, is gone or fails leaves the page declined', (t) => {
  const v = vault(t);
  for (const [label, sentinel] of [
    ['different text', () => read('This address does not exist on the site.')],
    ['gone', () => ({ ok: false, kind: 'gone', reason: 'page not found (HTTP 404) — the source is dead, not blocked' })],
    ['failed', () => ({ ok: false, kind: 'failed', reason: 'timeout' })],
    ['unavailable', () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'no browser' })],
  ]) {
    v.reset();
    const { result, calls } = clip(thinPage, (u) => (u === URL_A ? read(SHELL) : sentinel()));
    assert.equal(result.status, 'thin', label);
    assert.equal(calls.length, 2, label);
    assert.deepEqual(v.declines(), [URL_A], label);
    assert.deepEqual(v.rows().map((r) => r.reason), [SHELL_REASON], label);
  }
});

test('no made-up address is rendered for a wrong-node verdict, for a browser that never read the page, or for a page that clips', (t) => {
  const description = 'Comprehensive guidance describing mandatory manufacturing inspection requirements, laboratory certification procedures, and enforcement deadlines affecting distributors nationwide.';
  const markdown = 'A short roundup of unrelated items.';
  assert.equal(classifyShortExtraction({ markdown, description }).kind, 'wrong_node');
  const v = vault(t);
  const wrong = clip(() => ({ title: 'App page', contentMarkdown: markdown, description }), () => read(markdown));
  assert.equal(wrong.calls.length, 1);
  assert.equal(wrong.result.status, 'thin');

  v.reset(); // the wrong-node page was declined
  const failedRead = clip(thinPage, () => ({ ok: false, kind: 'failed', reason: 'timeout' }));
  assert.equal(failedRead.calls.length, 1);

  const failedFetchAndRender = clip(() => { throw new Error('fetch failed'); }, () => ({ ok: false, kind: 'blocked', reason: 'access denied (HTTP 403)' }));
  assert.equal(failedFetchAndRender.calls.length, 1);

  const clips = clip(thinPage, () => article());
  assert.equal(clips.calls.length, 1);
});

test('the made-up address keeps the page\'s origin and directory, drops the query and fragment, and is named by the page address', (t) => {
  const v = vault(t);
  for (const url of ['https://docs.example.test/app/page?tab=2#top', 'https://docs.example.test/app/page/', 'https://docs.example.test/', 'https://docs.example.test:8443/a/b/c.html']) {
    v.reset();
    const { calls } = clip(thinPage, () => read(SHELL), url);
    assert.deepEqual(calls, [url, probeOf(url)], url);
  }
});
