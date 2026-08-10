import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTopic, topicKey, UNATTRIBUTED, attributeItem, groupByTopic, buildTopicIndex,
} from '../scripts/lib/topic.mjs';

// A topic is free text the user typed at /wiki-discover. It is never parsed,
// never a taxonomy -- only normalized enough that "BPD research" and
// "  bpd   research " are one group rather than two (design spec section 5).

test('normalizeTopic trims and collapses internal whitespace, keeping the original casing', () => {
  assert.equal(normalizeTopic('  Borderline   Personality\tDisorder '), 'Borderline Personality Disorder');
});

test('normalizeTopic treats blank and non-string input as no topic at all', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(normalizeTopic(bad), null, `${JSON.stringify(bad)} is not a topic`);
  }
});

test('topicKey folds case and whitespace so one topic is one group', () => {
  assert.equal(topicKey('  BPD   Research '), topicKey('bpd research'));
});

// --- attribution ------------------------------------------------------------
// Resolution order, design spec 3.3: the item's own log event, then the
// clipping whose `source:` matches its URL, then the clipping AT its path
// (backlog rows are paths, not URLs), then unattributed.

// buildTopicIndex owns key normalization so no caller can assemble a map that
// silently misses on case. One clipping per entry, as triage.mjs's scan yields.
const INDEX = buildTopicIndex([
  { path: 'raw/clippings/One.md', url: 'https://a.test/one', topic: 'Audio DSP' },
  { path: 'raw/clippings/Some Paper.md', url: null, topic: 'Procedural Terrain' },
  { path: 'raw/clippings/NoTopic.md', url: 'https://a.test/none', topic: '  ' },
]);

test('a clipping that declares no topic contributes nothing to the index', () => {
  assert.equal(INDEX.byUrl.has('https://a.test/none'), false);
  assert.equal(INDEX.byPath.has('raw/clippings/notopic.md'), false);
});

test("an item's own recorded topic wins over anything the index says", () => {
  const t = attributeItem({ url: 'https://a.test/one', topic: 'BPD' }, INDEX);
  assert.equal(t, 'BPD');
});

test('an item with no topic of its own is attributed by matching a clipping source URL', () => {
  assert.equal(attributeItem({ url: 'https://a.test/one' }, INDEX), 'Audio DSP');
});

// The backlog group's rows ARE clipping paths (graph.mjs's unsummarizedSources
// maps to p.path), so path lookup is not a fallback nicety -- without it an
// entire group is unattributable.
test('a backlog row, which is a clipping path rather than a URL, resolves by path', () => {
  assert.equal(attributeItem({ url: 'raw/clippings/Some Paper.md' }, INDEX), 'Procedural Terrain');
});

test('an item nothing knows about is unattributed rather than guessed at', () => {
  assert.equal(attributeItem({ url: 'https://unknown.test/x' }, INDEX), null);
});

test('URL matching ignores case, as clipping frontmatter and log entries disagree on it', () => {
  assert.equal(attributeItem({ url: 'HTTPS://A.TEST/one' }, INDEX), 'Audio DSP');
});

// --- grouping ---------------------------------------------------------------

const items = (...topics) => topics.map((topic, i) => ({ url: `u${i}`, topic }));

test('groupByTopic orders by count descending, then by key ascending', () => {
  const g = groupByTopic(items('Zebra', 'Alpha', 'Alpha', 'Zebra', 'Alpha', 'Mid', 'Mid'));
  assert.deepEqual(g.map((x) => [x.topic, x.count]), [['Alpha', 3], ['Mid', 2], ['Zebra', 2]]);
});

// Determinism is not cosmetic here: this project has repeatedly shipped bugs
// where filesystem iteration order reached user-visible output, so the sort is
// total (count, then key) rather than count alone.
test('two topics with equal counts always come back in the same order', () => {
  const a = groupByTopic(items('beta', 'alpha')).map((x) => x.topic);
  const b = groupByTopic(items('alpha', 'beta')).map((x) => x.topic);
  assert.deepEqual(a, b);
});

test('unattributed items are collected under one group that always sorts last', () => {
  const g = groupByTopic([
    { url: 'a', topic: null }, { url: 'b', topic: null }, { url: 'c', topic: null },
    { url: 'd', topic: 'Rare' },
  ]);
  assert.equal(g.at(-1).topic, UNATTRIBUTED, 'even though it outnumbers the real topic');
  assert.equal(g.at(-1).count, 3);
  assert.equal(g[0].topic, 'Rare');
});

test('casing variants of one topic are one group, displayed as first seen', () => {
  const g = groupByTopic(items('BPD Research', 'bpd research', 'BPD  RESEARCH'));
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 3);
  assert.equal(g[0].topic, 'BPD Research');
});

test('an empty queue produces no groups rather than an empty unattributed one', () => {
  assert.deepEqual(groupByTopic([]), []);
});
