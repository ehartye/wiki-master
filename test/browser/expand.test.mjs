import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, loadChromium, renderPage } from '../../scripts/lib/render.mjs';
import { laneSkip, startFixtureServer } from './helpers.mjs';

const CLIP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'clip.mjs');

// The real clipper in the real browser, against a local fixture. Asynchronous, so the server in this process can answer.
async function clip(t, url) {
  const vault = mkdtempSync(join(tmpdir(), 'wm-expand-lane-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  const clippings = join(vault, 'raw', 'clippings');
  mkdirSync(clippings, { recursive: true });
  const child = spawn(process.execPath, [CLIP, url, '--expand'], { env: { ...process.env, WIKI_MASTER_VAULT: vault }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, output);
  const [name] = readdirSync(clippings);
  assert.ok(name, `a clipping was written:\n${output}`);
  return { text: readFileSync(join(clippings, name), 'utf8'), output };
}
const coverage = (text) => /^expand-coverage: "(.*)"$/m.exec(text)?.[1];
const once = (text, needle) => assert.equal(text.split(needle).length - 1, 1, `${needle} appears once:\n${text}`);

async function serve(t) {
  const server = await startFixtureServer();
  t.after(() => server.close());
  return server;
}

test('tiers whose panels are absent until clicked are all stored, under their labels', { skip: laneSkip }, async (t) => {
  const server = await serve(t);
  const { text } = await clip(t, server.url('/expand-pricing.html'));
  for (const [tier, rate] of [['Batch', 'batch-rate'], ['Flex', 'flex-rate'], ['Priority', 'priority-rate'], ['Contributor', 'contributor-rate']]) {
    once(text, rate);
    assert.match(text, new RegExp(`^#{2,6} ${tier}$`, 'm'));
    assert.ok(text.search(new RegExp(`^#{2,6} ${tier}$`, 'm')) < text.indexOf(rate), text);
  }
  assert.equal(coverage(text), 'tabs=4 panels=4 details=0 tables=4 code=0 truncated=false');
  assert.match(text, /^extraction: rendered$/m);
  assert.doesNotMatch(text, /^fidelity: /m);
});

test('collapsed panels and details are stored, including one an accordion closed or unmounted', { skip: laneSkip }, async (t) => {
  const server = await serve(t);
  const { text } = await clip(t, server.url('/expand-collapsed.html'));
  for (const sample of ['collapsed_sample_one()', 'collapsed_sample_two()', 'collapsed_sample_three()', 'details_sample()']) once(text, sample);
  assert.equal(coverage(text), 'tabs=0 panels=0 details=1 tables=0 code=4 truncated=false');
  assert.doesNotMatch(text, /^fidelity: /m);
});

test('a language tab group is stored per language, identical panels once, and a tab that answers only to mouse down opens', { skip: laneSkip }, async (t) => {
  const server = await serve(t);
  const { text, output } = await clip(t, server.url('/expand-languages.html'));
  for (const sample of ['python_sample()', 'node_sample()', 'go_sample()', 'mousedown_a()', 'mousedown_b()']) once(text, sample);
  assert.doesNotMatch(text, /Ruby/, 'a duplicate panel takes its label with it');
  assert.equal(coverage(text), 'tabs=6 panels=5 details=0 tables=0 code=5 truncated=false');
  assert.doesNotMatch(output, /^note:/m, 'an expanded clip has opened its tabs');
});

test('tables inside tab wrappers are stored once each', { skip: laneSkip }, async (t) => {
  const server = await serve(t);
  const { text } = await clip(t, server.url('/expand-tabs-wrapper.html'));
  once(text, 'starter-plan-row');
  once(text, 'team-plan-row');
  assert.equal(coverage(text), 'tabs=2 panels=2 details=0 tables=2 code=0 truncated=false');
});

test('the safety fixture really does post, leave and open windows when its controls are used without interception', { skip: laneSkip }, async (t) => {
  const server = await serve(t);
  const browser = await (await loadChromium()).launch({ executablePath: findBrowser(), headless: false, args: ['--window-position=-32000,-32000'] });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.url('/expand-safety.html'));
  // Each wait starts before its click: on a fast machine the local response can land before a wait that starts after.
  const requested = (suffix) => context.waitForEvent('request', (request) => new URL(request.url()).pathname === suffix);
  const click = (selector) => page.evaluate((s) => document.querySelector(s).click(), selector);
  await Promise.all([page.waitForResponse((response) => response.url().endsWith('/track')), click('#poster')]);
  for (const [selector, suffix] of [
    ['button[form="order"][formtarget]', '/submit-order'],
    ['button[form="lookup"]', '/lookup-target.html'],
    ['#opener', '/popup-target.html'],
    ['#submitter', '/lookup-target.html'],
    ['#blank-link', '/blank-target.html'],
    ['a[href="/elsewhere.html"]', '/elsewhere.html'],
  ]) {
    const [popup] = await Promise.all([page.waitForEvent('popup'), requested(suffix), click(selector)]);
    await popup.close();
  }
  const deadline = Date.now() + 10_000;
  for (const [method, path] of [['POST', '/track'], ['POST', '/submit-order'], ['GET', '/lookup-target.html'], ['GET', '/popup-target.html'], ['GET', '/blank-target.html'], ['GET', '/elsewhere.html']]) {
    while (!server.requests.some((request) => request.method === method && request.path === path)) {
      assert.ok(Date.now() < deadline, `the fixture never sent a ${method} to ${path}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
});

test('expansion sends no non-GET request and never leaves the page, in a window of its own or not', { skip: laneSkip }, async (t) => {
  const server = await serve(t);
  const { text } = await clip(t, server.url('/expand-safety.html'));
  assert.deepEqual(server.requests.filter((request) => request.method !== 'GET'), []);
  assert.deepEqual(server.requests.filter((request) => !['/expand-safety.html', '/favicon.ico'].includes(request.path)), [], 'the page was the only request the server saw');
  assert.match(text, /real-panel-text/);
  assert.doesNotMatch(text, /elsewhere-page-text/);
  assert.doesNotMatch(text, /Place order|Order by tab/, 'nothing in the form was opened');
});

test('past the click limit a clip is partial and truncated, and holds what it reached', { skip: laneSkip }, async (t) => {
  const server = await serve(t);
  const { text, output } = await clip(t, server.url('/expand-limit.html'));
  assert.match(coverage(text), /^tabs=200 panels=200 .*truncated=true$/);
  assert.match(text, /^fidelity: partial$/m);
  assert.match(output, /fidelity warning/);
  assert.match(text, /content of item number 199\b/);
  assert.doesNotMatch(text, /content of item number 200\b/);
});

test('the time limit ends expansion, reported the same way', { skip: laneSkip }, async (t) => {
  const server = await serve(t);
  const started = Date.now();
  const { expansion } = await renderPage(server.url('/expand-limit.html'), { expand: true, expandLimits: { maxMs: 500 } });
  assert.equal(expansion.truncated, true);
  assert.ok(expansion.tabs > 0 && expansion.tabs < 200, JSON.stringify(expansion));
  assert.ok(Date.now() - started < 30000);
});
