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
// Locating playwright-core
// ---------------------------------------------------------------------------
import { loadChromium, RenderUnavailable } from '../scripts/lib/render.mjs';

test('a globally installed playwright-core is found, because that is what we tell people to do', async () => {
  // The unavailable-message says `npm i -g playwright-core`. A bare
  // import('playwright-core') cannot see a global package -- verified:
  // ERR_MODULE_NOT_FOUND with the package installed and `npm root -g` pointing
  // straight at it. Without this fallback the advice we print does not work.
  const tried = [];
  const importer = async (spec) => {
    tried.push(spec);
    if (spec === 'playwright-core') { const e = new Error('not found'); e.code = 'ERR_MODULE_NOT_FOUND'; throw e; }
    return { chromium: { marker: 'global' } };
  };
  const chromium = await loadChromium({
    importer,
    globalRoot: () => '/usr/lib/node_modules',
    exists: () => true,
  });
  assert.equal(chromium.marker, 'global');
  assert.equal(tried[0], 'playwright-core', 'a local install still wins');
  assert.match(tried[1], /^file:/, 'the global path must be imported as a file url, not a bare specifier');
});

test('the package is entered through index.mjs, whose named export actually exists', async () => {
  // playwright-core ships both entries and they do NOT behave alike under
  // import(): index.mjs yields a real `chromium` named export, index.js (CJS)
  // yields only `default.chromium`. Reading `.chromium` off the CJS entry gives
  // undefined, which surfaces four layers away as "Cannot read properties of
  // undefined (reading 'launch')" — observed exactly that way.
  const tried = [];
  const importer = async (spec) => {
    tried.push(spec);
    if (spec === 'playwright-core') throw new Error('no local copy');
    if (spec.endsWith('index.mjs')) return { chromium: { marker: 'mjs' } };
    return { default: { chromium: { marker: 'cjs' } } };
  };
  const chromium = await loadChromium({ importer, globalRoot: () => '/g', exists: () => true });
  assert.equal(chromium.marker, 'mjs');
});

test('a package with only a CJS entry is still usable via its default export', async () => {
  const importer = async (spec) => {
    if (spec === 'playwright-core') throw new Error('no local copy');
    return { default: { chromium: { marker: 'cjs' } } };
  };
  const chromium = await loadChromium({
    importer,
    globalRoot: () => '/g',
    exists: (p) => p.endsWith('index.js'),
  });
  assert.equal(chromium.marker, 'cjs');
});

test('a local install is used without ever consulting the global root', async () => {
  let consulted = false;
  const chromium = await loadChromium({
    importer: async () => ({ chromium: { marker: 'local' } }),
    globalRoot: () => { consulted = true; return '/x'; },
  });
  assert.equal(chromium.marker, 'local');
  assert.equal(consulted, false);
});

test('no playwright anywhere names the package instead of failing vaguely', async () => {
  await assert.rejects(
    () => loadChromium({
      importer: async () => { throw new Error('nope'); },
      globalRoot: () => null,
    }),
    (e) => e instanceof RenderUnavailable && /playwright-core/.test(e.message)
  );
});
