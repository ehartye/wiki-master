import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderScreen } from '../scripts/triage.mjs';

const empty = {
  clipFailures: [],
  attention: [],
  fidelity: [],
  expiring: [],
  backlog: [],
  backlogTotal: 0,
};

test('an empty queue renders the all-clear, not an empty list', () => {
  const html = renderScreen(empty);
  assert.match(html, /Nothing needs you/);
  assert.doesNotMatch(html, /class="issue"/);
});

test('groups with no rows are omitted entirely', () => {
  const html = renderScreen({
    ...empty,
    clipFailures: [{ url: 'https://a.test/1', kind: 'failed', reason: '403', occurrences: 1 }],
  });
  assert.match(html, /Clip failures/);
  assert.doesNotMatch(html, /Fidelity flags/);
  assert.doesNotMatch(html, /nearing expiry/);
});

test('a hostile URL cannot break out of the markup', () => {
  const hostile = 'https://evil.test/"><script>alert(1)</script><a href="';
  const html = renderScreen({
    ...empty,
    clipFailures: [{ url: hostile, kind: 'failed', reason: 'x', occurrences: 1 }],
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'no unescaped script tag');
  assert.match(html, /&lt;script&gt;/, 'the payload appears escaped instead');
});

test('a hostile reason and title are escaped too', () => {
  const html = renderScreen({
    ...empty,
    fidelity: [
      {
        url: 'https://a.test/1',
        kind: 'fidelity',
        reason: '<img src=x onerror=alert(1)>',
        title: '</div><script>bad()</script>',
        occurrences: 1,
      },
    ],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
});

test('disposition buttons carry data attributes, never inline handlers', () => {
  const html = renderScreen({
    ...empty,
    clipFailures: [{ url: 'https://a.test/1', kind: 'failed', reason: '403', occurrences: 1 }],
  });
  assert.match(html, /data-url="https:\/\/a\.test\/1"/);
  assert.match(html, /data-act="retry"/);
  assert.doesNotMatch(html, /onclick=/, 'no inline onclick on issue actions');
});

test('a truncated backlog says so rather than silently capping', () => {
  const html = renderScreen({
    ...empty,
    backlog: ['raw/clippings/a.md', 'raw/clippings/b.md'],
    backlogTotal: 119,
  });
  assert.match(html, /showing 2 of 119/);
});

test('repeat occurrences are surfaced', () => {
  const html = renderScreen({
    ...empty,
    clipFailures: [
      {
        url: 'https://a.test/1',
        kind: 'failed',
        reason: '403',
        occurrences: 4,
        firstSeen: '2026-07-01T00:00:00.000Z',
      },
    ],
  });
  assert.match(html, /seen 4×/);
  assert.match(html, /2026-07-01/);
});

test('non-http sources are not rendered as clickable links', () => {
  const html = renderScreen({
    ...empty,
    fidelity: [{ url: 'file://local.md', kind: 'fidelity', reason: 'ocr damage', occurrences: 1 }],
  });
  assert.doesNotMatch(html, /<a class="url" href="file:/);
});

test('the server does not cache the theme or client JS at startup', () => {
  // Regression: a long-lived server that read these once served the code it
  // booted with, so edits to helper.js appeared to do nothing and the click
  // handler silently never bound. Caught only by inspecting the served DOM.
  const src = readFileSync(new URL('../scripts/triage-ui/server.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(
    src,
    /^const\s+(frameTemplate|helperScript|helperInjection)\s*=\s*fs\.readFileSync/m,
    'frame-template.html and helper.js must be read per request, not hoisted into a const'
  );
  assert.match(src, /function frameTemplate\(\)/, 'frameTemplate is a per-call read');
  assert.match(src, /function helperInjection\(\)/, 'helperInjection is a per-call read');
});
