// How the render rung sits in the ladder, and the two smaller extraction bugs
// found alongside it. Measurements are from a 2026-09-05 sweep of 17 entries in
// the vault's failed/thin triage queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderAttempt, renderLaunchers, classifyShortExtraction } from '../scripts/clip.mjs';

const PIN = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).devDependencies['playwright-core'];
const NO_PACKAGE = JSON.stringify({ unavailable: true, missing: 'playwright-core', error: 'playwright-core is not available here.' });
const renderFailure = (status, stderr) => Object.assign(new Error('Command failed'), { status, stderr });

const okMeta = (over = {}) =>
  JSON.stringify({
    htmlFile: 'x.html',
    finalUrl: 'https://ampcode.com/',
    status: 200,
    title: 'Amp: The frontier agent and dev environment',
    words: 2105,
    ...over,
  });

// ---------------------------------------------------------------------------
// The rung itself
// ---------------------------------------------------------------------------

test('a rendered page is re-extracted by Defuddle, not scraped as innerText', () => {
  // Rendering must not fork the extraction pipeline. Defuddle owns title,
  // author, published-date and boilerplate removal for every other clip in the
  // vault; a render that returned raw innerText would give this one class of
  // clipping different metadata and no boilerplate stripping.
  const seen = [];
  let wrote;
  const run = (cmd) => {
    seen.push(cmd);
    if (cmd.includes('render-page.mjs')) {
      wrote = /render-page\.mjs" "[^"]+" "([^"]+)"/.exec(cmd)[1];
      return okMeta({ htmlFile: wrote });
    }
    return JSON.stringify({ title: 'Amp', contentMarkdown: 'word '.repeat(900) });
  };
  const out = renderAttempt('https://ampcode.com', { run });
  assert.equal(out.ok, true);
  assert.equal(out.data.title, 'Amp');
  // Defuddle must be pointed at the path the renderer was TOLD to write, not at
  // a path echoed back on the subprocess's stdout — the scratch file is ours.
  assert.ok(
    seen.some((c) => c.includes('extract-page.mjs') && JSON.parse(Buffer.from(/--payload ([A-Za-z0-9_-]+)/.exec(c)[1], 'base64url').toString()).source === wrote),
    'the rendered file must be handed back to defuddle'
  );
});

test('the redirect guard runs before extraction, so a wrong page is never parsed', () => {
  // Epic's stale doc URL renders 443 words of real prose from the docs index.
  // If extraction ran first, that text would exist and be tempting; the guard
  // has to refuse before there is anything to be tempted by.
  const seen = [];
  const run = (cmd) => {
    seen.push(cmd);
    if (cmd.includes('render-page.mjs')) {
      return okMeta({
        finalUrl: 'https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-documentation?lang=en-US',
        title: 'Unreal Engine 5.8 Documentation',
        words: 443,
      });
    }
    throw new Error('defuddle must not run on a page that failed the guard');
  };
  const out = renderAttempt(
    'https://dev.epicgames.com/documentation/en-us/unreal-engine/using-spring-arm-components',
    { run }
  );
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'failed');
  assert.ok(!seen.some((c) => c.includes('extract-page.mjs')), 'extraction must not be attempted');
});

test('a missing browser is reported as setup, never as the page failing, and npx is left alone', () => {
  // Otherwise every URL in a batch run is filed as "the site blocked us" when
  // the truth is that the rung never ran once. The user would triage 60 sources
  // by hand instead of installing one browser. npx could not help, so it must not
  // spend a download finding that out.
  const seen = [];
  const run = (cmd) => {
    seen.push(cmd);
    throw renderFailure(3, JSON.stringify({ unavailable: true, missing: 'browser', error: 'No Chromium-based browser found.' }));
  };
  const out = renderAttempt('https://ampcode.com', { run });
  assert.equal(out.ok, false);
  assert.equal(out.unavailable, true, 'the caller has to be able to stop warning per-URL');
  assert.match(out.reason, /browser/);
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].includes('npx'));
});

test('with no local playwright-core the render is retried through the pinned npx command', () => {
  const seen = [];
  const run = (cmd) => {
    seen.push(cmd);
    if (cmd.includes('extract-page.mjs')) return JSON.stringify({ title: 'Amp', contentMarkdown: 'word '.repeat(900) });
    if (cmd.startsWith('npx ')) return okMeta();
    throw renderFailure(3, NO_PACKAGE);
  };
  const out = renderAttempt('https://ampcode.com', { run });
  assert.equal(out.ok, true);
  const renders = seen.filter((c) => c.includes('render-page.mjs'));
  assert.equal(renders.length, 2);
  assert.ok(!renders[0].includes('npx'), 'the local copy is tried first');
  assert.ok(renders[1].startsWith(`npx --yes --package=playwright-core@${PIN} -- node "`), renders[1]);
  assert.equal(renders[0].split('render-page.mjs')[1], renders[1].split('render-page.mjs')[1], 'both attempts take the same page and scratch file');
});

test('the package.json pin and the launcher pin are one version, and an exact stable one', () => {
  assert.match(String(PIN), /^\d+\.\d+\.\d+$/);
  assert.ok(renderLaunchers().some((l) => l.includes(`--package=playwright-core@${PIN} `)), `no launcher pins ${PIN}: ${renderLaunchers().join(' | ')}`);
});

test('a page failure through npx is still about the page, wherever npm writes its own lines', () => {
  const stderrs = [
    `npm warn exec The following package was not found and will be installed: playwright-core\n${JSON.stringify({ unavailable: false, error: 'net::ERR_CONNECTION_RESET' })}\n`,
    `${JSON.stringify({ unavailable: false, error: 'net::ERR_CONNECTION_RESET' })}\r\nnpm notice New major version of npm available!\r\n`,
    `${JSON.stringify({ unavailable: false, error: 'net::ERR_CONNECTION_RESET' })}\n123\nnull\n["not ours"]\n`,
  ];
  for (const stderr of stderrs) {
    const run = (cmd) => { throw cmd.startsWith('npx ') ? renderFailure(1, stderr) : renderFailure(3, NO_PACKAGE); };
    const out = renderAttempt('https://ampcode.com', { run });
    assert.notEqual(out.unavailable, true, stderr);
    assert.match(out.reason, /ERR_CONNECTION_RESET/, stderr);
  }
});

test('setup failures reported through npx noise are still unavailable', () => {
  const stderr = `npm warn exec installing\n${JSON.stringify({ unavailable: true, missing: 'playwright-core', error: 'playwright-core is not available.' })}\nnpm notice done\n`;
  const out = renderAttempt('https://ampcode.com', { run: () => { throw renderFailure(3, stderr); } });
  assert.equal(out.unavailable, true);
  assert.match(out.reason, /playwright-core/);
});

test('an npx that fails without a JSON line, such as offline, reports unavailable and not the page', () => {
  const run = (cmd) => {
    throw cmd.startsWith('npx ')
      ? renderFailure(1, 'npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed\n')
      : renderFailure(3, NO_PACKAGE);
  };
  const out = renderAttempt('https://ampcode.com', { run });
  assert.equal(out.ok, false);
  assert.equal(out.unavailable, true);
  assert.match(out.reason, /did not finish through npx/);
  assert.match(out.reason, /registry\.npmjs\.org failed/, 'the reason carries what npm said');
});

test('a local render that dies without a JSON line is that attempt failing, not a setup problem', () => {
  const seen = [];
  const run = (cmd) => { seen.push(cmd); throw renderFailure(1, 'Segmentation fault\n'); };
  const out = renderAttempt('https://ampcode.com', { run });
  assert.notEqual(out.unavailable, true);
  assert.equal(seen.length, 1, 'only a named missing package earns the npx retry');
});

test('a render that crashes on one page is not a setup failure', () => {
  const run = () => { throw renderFailure(1, JSON.stringify({ unavailable: false, error: 'net::ERR_CONNECTION_RESET' })); };
  const out = renderAttempt('https://www.cool.osd.mil/army/moc/index.html?moc=15g', { run });
  assert.equal(out.ok, false);
  assert.notEqual(out.unavailable, true);
  assert.match(out.reason, /ERR_CONNECTION_RESET/);
});

test('the temp html path is unique per url so concurrent clips cannot collide', () => {
  // Two sessions clipping into one vault is normal here (see lib/triage.mjs);
  // a shared temp filename would have one render overwrite the other's page and
  // file the wrong article under the wrong url.
  const paths = [];
  const run = (cmd) => {
    const m = /render-page\.mjs" "[^"]+" "([^"]+)"/.exec(cmd);
    if (m) { paths.push(m[1]); return okMeta({ htmlFile: m[1] }); }
    return JSON.stringify({ title: 't', contentMarkdown: 'word '.repeat(900) });
  };
  renderAttempt('https://a.test/one', { run });
  renderAttempt('https://a.test/two', { run });
  assert.equal(new Set(paths).size, 2, 'each url needs its own scratch file');
});

// ---------------------------------------------------------------------------
// classifyShortExtraction: two real misfires found while sampling the queue
// ---------------------------------------------------------------------------

test('a short page with real structure is an article, not an SPA shell', () => {
  // registry.khronos.org/.../XR_EXT_hand_tracking.html is a COMPLETE man page:
  // 58 words under four headings. It was declined for 180 days and queued for a
  // human because the old test demanded that Defuddle's html literally BEGIN
  // with <article> or <main>, and this one begins with a heading. An SPA shell
  // has no headings, because it has no content.
  const v = classifyShortExtraction({
    markdown:
      '## Specification\n\nSee XR_EXT_hand_tracking in the main specification for complete information.\n\n' +
      '## Registered Extension Number\n\n52\n\n## Revision\n\n4\n\n## Extension and Version Dependencies\n\nOpenXR 1.0',
    rawHtml: '<h2>Specification</h2><p>See ...</p>',
    description: '',
  });
  assert.equal(v.kind, 'short_real_article');
});

test('a genuinely empty shell is still rejected, headings or not', () => {
  // docs.mealie.io: 299 words of static html, Defuddle extracts "Back to top".
  // The fix above must not turn every thin extraction into a keeper.
  const v = classifyShortExtraction({
    markdown: 'Back to top',
    rawHtml: '<div>Back to top</div>',
    description: '',
  });
  assert.equal(v.kind, 'empty_shell');
});

test('one heading over a stub is not enough to claim a real article', () => {
  const v = classifyShortExtraction({
    markdown: '## Sign in\n\nYou must be logged in to view this page.',
    rawHtml: '<div><h2>Sign in</h2></div>',
    description: '',
  });
  assert.notEqual(v.kind, 'short_real_article');
});

// ---------------------------------------------------------------------------
// A decline is a judgment, and a judgment needs evidence
// ---------------------------------------------------------------------------
import { shouldDeclineThin } from '../scripts/clip.mjs';

test('a thin verdict is cached as a decline when the whole ladder actually ran', () => {
  // This is the normal case and must keep working: thin-ness is deterministic
  // given the page's markup, so re-fetching cannot change the answer and the
  // next run should skip without paying for it.
  assert.equal(shouldDeclineThin({ renderRan: true }), true);
});

test('a thin verdict is NOT declined when the render rung never ran', () => {
  // The decline's whole justification is that re-fetching cannot change the
  // answer. That collapses when the browser rung was missing: with it the
  // answer would have been different -- measured, on four of this vault's own
  // thin/failed rows. Declining anyway buries a recoverable source for 180 days
  // on the strength of a package the user simply has not installed yet, and the
  // TTL means they would not find out until long after they fixed the setup.
  assert.equal(shouldDeclineThin({ renderRan: false }), false);
});
