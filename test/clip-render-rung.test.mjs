// How the render rung sits in the ladder, and the two smaller extraction bugs
// found alongside it. Measurements are from a 2026-09-05 sweep of 17 entries in
// the vault's failed/thin triage queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAttempt, classifyShortExtraction } from '../scripts/clip.mjs';

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
    seen.some((c) => c.includes('defuddle parse') && c.includes(wrote)),
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
  assert.ok(!seen.some((c) => c.includes('defuddle')), 'extraction must not be attempted');
});

test('a missing browser is reported as setup, never as the page failing', () => {
  // Otherwise every URL in a batch run is filed as "the site blocked us" when
  // the truth is that the rung never ran once. The user would triage 60 sources
  // by hand instead of installing one package.
  const run = () => {
    const e = new Error('Command failed');
    e.status = 3;
    e.stderr = JSON.stringify({ unavailable: true, error: 'playwright-core is not installed.' });
    throw e;
  };
  const out = renderAttempt('https://ampcode.com', { run });
  assert.equal(out.ok, false);
  assert.equal(out.unavailable, true, 'the caller has to be able to stop warning per-URL');
  assert.match(out.reason, /playwright-core/);
});

test('a render that crashes on one page is not a setup failure', () => {
  const run = () => {
    const e = new Error('Command failed');
    e.status = 1;
    e.stderr = JSON.stringify({ unavailable: false, error: 'net::ERR_CONNECTION_RESET' });
    throw e;
  };
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
