// The browser-render rung, and the guard that keeps it honest.
//
// Every case below is a URL measured against the live web on 2026-09-05 while
// triaging 17 entries out of the vault's `failed`/`thin` queue. The numbers in
// the comments are what was actually observed, not illustrations — see
// scripts/lib/render.mjs for why the rung exists at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathSlug, classifyRenderOutcome } from '../scripts/lib/render.mjs';

// ---------------------------------------------------------------------------
// pathSlug: the identity a redirect must preserve
// ---------------------------------------------------------------------------

test('pathSlug is the last meaningful path segment, normalized', () => {
  assert.equal(
    pathSlug('https://dev.epicgames.com/documentation/en-us/unreal-engine/using-spring-arm-components'),
    'usingspringarmcomponents'
  );
  // Extension and case must not make two spellings of one page look different.
  assert.equal(pathSlug('https://alttester.com/docs/latest/AI-Extension.html'), 'aiextension');
});

test('a bare origin has no slug, so it can never fail the redirect guard', () => {
  // ampcode.com redirects to ampcode.com/ — a trailing slash, not a move.
  assert.equal(pathSlug('https://ampcode.com'), null);
  assert.equal(pathSlug('https://www.gamedriver.io/'), null);
});

// ---------------------------------------------------------------------------
// classifyRenderOutcome: rendering makes pages SUCCEED, which is the hazard
// ---------------------------------------------------------------------------

test('a rendered article with a matching slug is clippable', () => {
  // Measured: 2,744 words of the real article after a headful render; the
  // static ladder got nothing at all.
  const v = classifyRenderOutcome({
    requestedUrl: 'https://securitylabs.datadoghq.com/articles/malicious-skills-supply-chain-risks-in-coding-agents-with-dynamic-context/',
    finalUrl: 'https://securitylabs.datadoghq.com/articles/malicious-skills-supply-chain-risks-in-coding-agents-with-dynamic-context/',
    status: 200,
    title: 'Malicious Coding Agent Skills and the Risk of Dynamic Context',
    words: 2744,
  });
  assert.equal(v.ok, true);
});

test('a cosmetic redirect that keeps the slug is still the requested page', () => {
  // counterpointresearch.com/insight/<slug> -> /en/insights/<slug>: a locale
  // prefix and a pluralized collection. Rejecting this would throw away good
  // pages on nothing but a URL-shape change.
  const v = classifyRenderOutcome({
    requestedUrl: 'https://www.counterpointresearch.com/insight/global-xr-ar-vr-headset-shipments',
    finalUrl: 'https://counterpointresearch.com/en/insights/global-xr-ar-vr-headset-shipments',
    status: 200,
    title: 'Global XR (AR/VR) Headset Shipments',
    words: 900,
  });
  assert.equal(v.ok, true, 'same slug across a locale/collection rename is not a move');
});

test('a redirect to a different page is refused, however real the text looks', () => {
  // THE reason this guard exists. Epic's stale doc URL lands on the UE 5.8
  // documentation index and renders 443 words of fluent prose. Clipping it
  // would file the index under the article's URL — a wrong-page clipping
  // wearing correct-looking frontmatter, which is worse than a failed fetch.
  const v = classifyRenderOutcome({
    requestedUrl: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/using-spring-arm-components',
    finalUrl: 'https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-documentation?lang=en-US',
    status: 200,
    title: 'Unreal Engine 5.8 Documentation',
    words: 443,
  });
  assert.equal(v.ok, false);
  assert.equal(v.kind, 'failed');
  assert.match(v.reason, /redirect/i);
  assert.match(v.reason, /unreal-engine-5-8-documentation/, 'triage needs the destination to judge');
});

test('a soft 403 served as HTTP 200 is reported as blocked, not as content', () => {
  // dev.epicgames.com/.../unreal-mcp-in-unreal-engine -> /documentation/403,
  // status 200. Only the final path says what happened.
  const v = classifyRenderOutcome({
    requestedUrl: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-mcp-in-unreal-engine',
    finalUrl: 'https://dev.epicgames.com/documentation/403',
    status: 200,
    title: 'Error: 403',
    words: 18,
  });
  assert.equal(v.ok, false);
  assert.equal(v.kind, 'blocked');
});

test('a real 404 is reported as gone rather than as a maybe-transient failure', () => {
  // mewo2.com and alttester.com both 404. Filing them as "likely
  // 403/paywall/transient" tells a human to retry a page that will never exist.
  const v = classifyRenderOutcome({
    requestedUrl: 'https://mewo2.com/notes/naming-language/',
    finalUrl: 'https://mewo2.com/notes/naming-language/',
    status: 404,
    title: '404 Not Found',
    words: 2,
  });
  assert.equal(v.ok, false);
  assert.equal(v.kind, 'gone');
  assert.match(v.reason, /404/);
});

test('an unsolved bot challenge is never mistaken for a thin page', () => {
  // Headless Chrome sits on Cloudflare's interstitial at 37 words. Recording
  // that as `thin` would decline the URL for 180 days over a gate a headful
  // render walks straight through.
  const v = classifyRenderOutcome({
    requestedUrl: 'https://www.tripo3d.ai/blog/why-ai-3d-models-have-bad-topology',
    finalUrl: 'https://www.tripo3d.ai/blog/why-ai-3d-models-have-bad-topology',
    status: 403,
    title: 'Just a moment...',
    words: 37,
  });
  assert.equal(v.ok, false);
  assert.equal(v.kind, 'blocked');
  assert.match(v.reason, /challenge/i);
});

test('a challenge title outranks a 200, because the gate answers with 200 too', () => {
  const v = classifyRenderOutcome({
    requestedUrl: 'https://www.gamedriver.io/',
    finalUrl: 'https://www.gamedriver.io/',
    status: 200,
    title: 'Just a moment...',
    words: 37,
  });
  assert.equal(v.ok, false);
  assert.equal(v.kind, 'blocked');
});

test('an error-page path only condemns a page that actually moved there', () => {
  // A legitimate article may live at /blog/404-errors-explained. The error-path
  // words are evidence only when the destination is not the page asked for.
  const v = classifyRenderOutcome({
    requestedUrl: 'https://example.test/blog/404-errors-explained',
    finalUrl: 'https://example.test/blog/404-errors-explained',
    status: 200,
    title: '404 Errors Explained',
    words: 1200,
  });
  assert.equal(v.ok, true, 'the slug matches, so the page is the one requested');
});

// ---------------------------------------------------------------------------
// Locating playwright-core, and looking for a browser before it
// ---------------------------------------------------------------------------
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadChromium, renderPage, RenderUnavailable } from '../scripts/lib/render.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const noLocalCopy = (real) => async (spec) => {
  if (spec === 'playwright-core') throw new Error('no local copy');
  return real(spec);
};

// What npx leaves behind: the package under node_modules, and a .bin folder on PATH beside it. The CommonJS entry
// assigns through a variable, as the real one does, so under import() only the default export has `chromium`.
function npxShapedInstall(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-render-bin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = join(root, 'node_modules', 'playwright-core');
  mkdirSync(pkg, { recursive: true });
  mkdirSync(join(root, 'node_modules', '.bin'));
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'playwright-core', version: '0.0.0', exports: { '.': { import: './index.mjs', require: './index.js' } } }));
  writeFileSync(join(pkg, 'index.js'), "const api = { chromium: { marker: 'through-bin' } };\nmodule.exports = api;\n");
  return { modules: join(root, 'node_modules'), bin: join(root, 'node_modules', '.bin') };
}

test('a local install is used without looking anywhere else', async () => {
  const tried = [];
  const chromium = await loadChromium({
    importer: async (spec) => { tried.push(spec); return { chromium: { marker: 'local' } }; },
    path: '/would/not/be/read/.bin',
  });
  assert.equal(chromium.marker, 'local');
  assert.deepEqual(tried, ['playwright-core']);
});

test('the copy npx puts on PATH is found through its .bin folder and read from its default export', async (t) => {
  const { bin } = npxShapedInstall(t);
  const chromium = await loadChromium({ importer: noLocalCopy((s) => import(s)), path: ['/elsewhere', bin].join(delimiter) });
  assert.equal(chromium.marker, 'through-bin');
});

test('a folder on PATH that is not a .bin folder is not searched', async (t) => {
  const { modules } = npxShapedInstall(t);
  await assert.rejects(
    () => loadChromium({ importer: noLocalCopy((s) => import(s)), path: modules }),
    (e) => e instanceof RenderUnavailable && e.missing === 'playwright-core'
  );
});

test('no copy anywhere names the package, says what is missing and gives no global install advice', async () => {
  await assert.rejects(
    () => loadChromium({ importer: async () => { throw new Error('nope'); }, path: '' }),
    (e) => e instanceof RenderUnavailable && e.missing === 'playwright-core' && /playwright-core/.test(e.message) && !/npm i -g/.test(e.message)
  );
});

test('with no browser the package is never looked for, so nothing can be downloaded for a render that cannot run', async (t) => {
  const prior = process.env.WIKI_MASTER_BROWSER;
  process.env.WIKI_MASTER_BROWSER = '/no/such/browser';
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_BROWSER; else process.env.WIKI_MASTER_BROWSER = prior; });
  let looked = false;
  await assert.rejects(
    () => renderPage('https://example.test/', { load: async () => { looked = true; throw new Error('looked'); } }),
    (e) => e instanceof RenderUnavailable && e.missing === 'browser'
  );
  assert.equal(looked, false);
});

test('render-page exits 3 and names a missing browser', () => {
  const out = mkdtempSync(join(tmpdir(), 'wm-render-exit-'));
  try {
    const r = spawnSync(process.execPath, [join(SCRIPTS, 'render-page.mjs'), 'https://example.test/', join(out, 'x.html')], {
      encoding: 'utf8', env: { ...process.env, WIKI_MASTER_BROWSER: '/no/such/browser' },
    });
    assert.equal(r.status, 3, r.stderr);
    const payload = JSON.parse(r.stderr);
    assert.equal(payload.unavailable, true);
    assert.equal(payload.missing, 'browser');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('render-page exits 3 and names a missing package, from a copy outside any node_modules', () => {
  // process.execPath only has to exist here: the package is looked for before anything is launched.
  // realpath: macOS's temp folder sits behind a symlink, and the script's main guard wouldn't fire through one.
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-render-copy-'));
  try {
    cpSync(SCRIPTS, join(root, 'scripts'), { recursive: true });
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'render-page.mjs'), 'https://example.test/', join(root, 'x.html')], {
      encoding: 'utf8', env: { ...process.env, PATH: '', Path: '', WIKI_MASTER_BROWSER: process.execPath },
    });
    assert.equal(r.status, 3, r.stderr);
    const payload = JSON.parse(r.stderr);
    assert.equal(payload.unavailable, true);
    assert.equal(payload.missing, 'playwright-core');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
