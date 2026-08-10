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

test('each group header carries bulk buttons matching its row actions', () => {
  const html = renderScreen({
    ...empty,
    clipFailures: [
      { url: 'https://a.test/1', kind: 'failed', reason: '403', occurrences: 1 },
      { url: 'https://a.test/2', kind: 'thin', reason: 'spa', occurrences: 1 },
    ],
  });
  assert.match(html, /data-bulk-act="retry"/);
  assert.match(html, /data-bulk-act="declined"/);
  assert.match(html, /data-bulk-group="/, 'bulk buttons are scoped to a group id');
});

test('bulk buttons state the count they actually affect', () => {
  const html = renderScreen({
    ...empty,
    clipFailures: [
      { url: 'https://a.test/1', kind: 'failed', reason: '403', occurrences: 1 },
      { url: 'https://a.test/2', kind: 'failed', reason: '403', occurrences: 1 },
    ],
  });
  assert.match(html, /data-bulk-count="2"/);
});

test('a truncated group scopes bulk to the rendered rows, not the total', () => {
  const html = renderScreen({
    ...empty,
    backlog: ['raw/a.md', 'raw/b.md'],
    backlogTotal: 85,
  });
  // 2 rows are in the DOM; bulk must not claim to act on 85.
  assert.match(html, /data-bulk-count="2"/);
  assert.doesNotMatch(html, /data-bulk-count="85"/);
  assert.match(html, /showing 2 of 85/, 'and the truncation stays visible');
});

test('an empty group contributes no bulk buttons', () => {
  const html = renderScreen(empty);
  assert.doesNotMatch(html, /data-bulk-act=/);
});

// Hub-stubs moved here from the health score: "5+ pages link to this empty page"
// is a real signal but a bad grade, because its cheapest fix (delete inbound links
// or pad with unsourced prose) makes the wiki worse. As a worklist it is right.
test('hub-stubs render as their own group with a sources-not-padding framing', () => {
  const html = renderScreen({
    ...empty,
    hubStubs: ['wiki/entities/Blender.md', 'wiki/entities/Tron Legacy.md'],
    hubStubTotal: 2,
  });
  assert.match(html, /Hub-stubs/);
  assert.match(html, /needs sources, not padding/);
  assert.match(html, /wiki\/entities\/Blender\.md/);
  assert.match(html, /2 hub-stubs/, 'counted in the subtitle');
});

test('hub-stubs alone are enough to keep the queue from reading all-clear', () => {
  const html = renderScreen({ ...empty, hubStubs: ['wiki/entities/Blender.md'], hubStubTotal: 1 });
  assert.doesNotMatch(html, /Nothing needs you/);
  assert.match(html, /1 hub-stub\b/, 'singular, not "1 hub-stubs"');
});

test('a truncated hub-stub list never lets bulk actions overclaim', () => {
  const html = renderScreen({ ...empty, hubStubs: ['wiki/entities/A.md'], hubStubTotal: 40 });
  assert.match(html, /showing 1 of 40/);
  assert.doesNotMatch(html, /data-bulk-count="40"/);
});

test('a vault with no hub-stubs still renders the all-clear', () => {
  assert.match(renderScreen({ ...empty, hubStubs: [], hubStubTotal: 0 }), /Nothing needs you/);
});

// --- research-topic grouping (2026-08-10 design spec) ------------------------
// Topic is a FILTER ACROSS the kind groups, not a replacement for them: kind
// decides which actions a row offers, so that structure stays. These tests pin
// the markup the client filter depends on.

const withTopics = {
  ...empty,
  clipFailures: [
    { url: 'https://a.test/1', kind: 'failed', reason: '403', occurrences: 1, topic: 'BPD Research' },
    { url: 'https://a.test/2', kind: 'failed', reason: '403', occurrences: 1, topic: 'BPD Research' },
    { url: 'https://a.test/3', kind: 'failed', reason: '403', occurrences: 1, topic: 'Audio DSP' },
    { url: 'https://a.test/4', kind: 'failed', reason: '403', occurrences: 1, topic: null },
  ],
  topics: [
    { topic: 'BPD Research', key: 'bpd research', count: 2 },
    { topic: 'Audio DSP', key: 'audio dsp', count: 1 },
    { topic: 'Unattributed', key: '', count: 1 },
  ],
};

test('a topic bar renders one chip per topic, each naming its count', () => {
  const html = renderScreen(withTopics);
  assert.match(html, /data-topic-filter="bpd research"/);
  assert.match(html, /data-topic-filter="audio dsp"/);
  assert.match(html, /BPD Research/);
  assert.match(html, /data-topic-filter="\*"/, 'an All chip that clears the filter');
});

test('every issue row carries its topic key so the client can filter without re-deriving it', () => {
  const html = renderScreen(withTopics);
  assert.match(html, /data-topic-key="bpd research"/);
  assert.match(html, /data-topic-key="audio dsp"/);
  assert.match(html, /data-topic-key=""/, 'an unattributed row still carries the attribute');
});

test('a row with a topic shows it, and an unattributed row shows no chip rather than a blank one', () => {
  const html = renderScreen({
    ...empty,
    clipFailures: [{ url: 'https://a.test/1', kind: 'failed', reason: '403', occurrences: 1, topic: null }],
    topics: [{ topic: 'Unattributed', key: '', count: 1 }],
  });
  assert.doesNotMatch(html, /class="topic"/, 'no empty chip on an unattributed row');
});

// A bar offering only "All" and "Unattributed" is two controls that do the same
// thing. Every vault predating this feature is in exactly that state, so it is
// the common case, not an edge one.
test('a queue with no attributed items at all renders no topic bar', () => {
  const html = renderScreen({
    ...empty,
    clipFailures: [{ url: 'https://a.test/1', kind: 'failed', reason: '403', occurrences: 1, topic: null }],
    topics: [{ topic: 'Unattributed', key: '', count: 1 }],
  });
  assert.doesNotMatch(html, /data-topic-filter=/);
});

test('a hostile topic cannot break out of the chip or the row attribute', () => {
  const hostile = '"><script>alert(1)</script>';
  const html = renderScreen({
    ...empty,
    clipFailures: [{ url: 'https://a.test/1', kind: 'failed', reason: 'x', occurrences: 1, topic: hostile }],
    topics: [
      { topic: hostile, key: hostile.toLowerCase(), count: 1 },
      { topic: 'Real Topic', key: 'real topic', count: 1 },
    ],
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

// The invariant the filter must not break: group() already refuses to let
// "apply to all N" mean more than the rows rendered. Filtering is a second way
// to show fewer rows than exist, so the client recomputes these — which it can
// only do if the markup says what the unfiltered count was.
test('bulk buttons carry the data the client needs to recount under a filter', () => {
  const html = renderScreen(withTopics);
  assert.match(html, /data-bulk-count="4"/, 'unfiltered count is 4 rows');
  assert.match(html, /data-bulk-label="/, 'and the label is recomputable, not baked into the text alone');
});
