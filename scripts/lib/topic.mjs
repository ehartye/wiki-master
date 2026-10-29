// Research-topic attribution for triage items.
//
// Triage groups by KIND, because kind decides which actions a row offers. But
// kind is the wrong axis for DECIDING: nobody sits down to disposition "all
// fidelity flags", they sit down to deal with the research run that produced
// them. Twelve failed clips from one sweep and three from another are two
// unrelated decisions wearing one label. Topic is the axis that separates them.
//
// A topic is free text the user already typed at /wiki-discover. It is never
// parsed and never becomes a taxonomy -- normalization exists only so that
// "BPD Research" and "  bpd   research " are one group instead of two.
//
// Pure and I/O-free: the index is built by the caller (scripts/triage.mjs owns
// the one filesystem pass over raw/clippings/), so every attribution and
// ordering rule here is testable without a vault.

export const UNATTRIBUTED = 'Unattributed';

export function normalizeTopic(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  return t || null;
}

export function topicKey(value) {
  const t = normalizeTopic(value);
  return t ? t.toLowerCase() : null;
}

// Every clipper parses `--topic=` through here, so a topic can never be read one
// way on the HTML path and another way on the PDF path -- which would split one
// research run across two triage groups for no reason a user could see.
//
// The rejoin is load-bearing: `split('=')[1]` truncates a topic containing an
// equals sign ("cost=benefit framing") into "cost", and the loss is silent.
// Returns null for absent, empty and whitespace-only alike, matching
// buildFrontmatter's rule that an absent topic and an empty one are one state.
export function parseTopicArg(argv = []) {
  const PREFIX = '--topic=';
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(PREFIX));
  return arg ? normalizeTopic(arg.slice(PREFIX.length)) : null;
}

const lookupKey = (u) => String(u ?? '').trim().toLowerCase();

// A URL can be held by more than one clipping: a recapture is a second, dated
// clipping of a page, written beside the first and naming it in `recapture-of`.
// A capture that another clipping of the same URL names there is OLDER; the
// newest capture is the one nothing supersedes. Returns the set of `path`
// values (as given) that are older. A `recapture-of` that names a clipping of a
// different URL, or of nothing, supersedes nothing: the link is only believed
// when it is consistent.
//
// `entries` is [{ path, url, recaptureOf }]; `urlKey` folds a URL for comparison
// (callers that compare by the clipper's normalization pass their own).
export function olderCaptures(entries = [], urlKey = lookupKey) {
  const byPath = new Map();
  for (const e of entries) if (e?.path) byPath.set(lookupKey(e.path), e);
  const older = new Set();
  for (const e of entries) {
    if (!e?.recaptureOf) continue;
    const target = byPath.get(lookupKey(e.recaptureOf));
    if (target && target !== e && urlKey(target.url) === urlKey(e.url)) older.add(target.path);
  }
  return older;
}

// The index is built here rather than assembled by callers so that key
// normalization has exactly one owner. Both sides of every lookup are folded
// to lower case: a clipping's `source:` and the URL on a triage event are
// written by different code paths and routinely disagree on case, and vault
// paths are case-insensitive on the platform this runs on most.
//
// `entries` is [{ path, url, topic, created?, recaptureOf? }] -- one per
// clipping that declares a topic. Entries with no topic are skipped rather than
// stored as null, so a lookup miss and a topicless clipping are the same answer.
//
// When several clippings hold one URL, the URL answers with the topic of the
// newest capture: one that no other clipping names in `recapture-of`, then the
// latest `created`, then the later file name. That is a total order, so the
// answer never depends on the order the directory was read in. Every capture
// still answers for its own path.
export function buildTopicIndex(entries = []) {
  const byUrl = new Map();
  const byPath = new Map();
  const withTopic = entries
    .map((e) => ({ e, topic: normalizeTopic(e?.topic) }))
    .filter((x) => x.topic);
  const older = olderCaptures(withTopic.map((x) => x.e));
  // Code-point comparison, not localeCompare: the order must not vary with the machine's locale.
  const text = (v) => String(v ?? '');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const ascending = [...withTopic].sort(
    (a, b) => cmp(text(a.e.created), text(b.e.created)) || cmp(text(a.e.path), text(b.e.path))
  );
  for (const { e, topic } of ascending) {
    if (e.url && !older.has(e.path)) byUrl.set(lookupKey(e.url), topic);
    if (e.path) byPath.set(lookupKey(e.path), topic);
  }
  return { byUrl, byPath };
}

// Resolution order (design spec 3.3), first match wins:
//   1. the topic recorded on the item's own triage-log event
//   2. the clipping whose `source:` matches the item's URL
//   3. the clipping AT the item's path -- backlog rows are clipping paths, not
//      URLs (graph.mjs's unsummarizedSources maps to p.path), so without this
//      an entire group is unattributable
//   4. null -- unattributed, never guessed
//
// A wrong topic is worse than none: it files an item under a heading the user
// has already worked through, which is how something silently never gets done.
export function attributeItem(item, index = {}) {
  const own = normalizeTopic(item?.topic);
  if (own) return own;
  const key = lookupKey(item?.url);
  if (!key) return null;
  return index.byUrl?.get(key) ?? index.byPath?.get(key) ?? null;
}

// Resolves every item's topic once, up front. Returns new objects rather than
// mutating: collectTriage's groups share item references (an issue can appear
// in more than one list), and a stamped-in-place topic would be attributed
// twice with no guarantee the second pass saw the same index.
export function attributeItems(items = [], index = {}) {
  return items.map((item) => ({ ...item, topic: attributeItem(item, index) }));
}

// Groups sorted by count descending, then key ascending. The tiebreak is not
// cosmetic: this project has shipped bugs where filesystem iteration order
// reached user-visible output, so the ordering is total rather than incidental.
// Unattributed always sorts last however large it is -- it is a residue, not a
// topic, and letting it head the list would bury the real ones on any vault
// whose clippings predate topic recording.
// Takes items whose `topic` is already resolved -- run attributeItems first.
// Grouping does not re-resolve, so the topic shown in a chip and the topic a
// row filters by can never come from two different code paths.
export function groupByTopic(items = []) {
  const groups = new Map();
  let unattributed = 0;
  for (const item of items) {
    const topic = normalizeTopic(item?.topic);
    if (!topic) { unattributed++; continue; }
    const k = topicKey(topic);
    const g = groups.get(k);
    if (g) g.count++;
    // First spelling seen wins the display label; the key already folds case.
    else groups.set(k, { topic, key: k, count: 1 });
  }
  const out = [...groups.values()].sort(
    (a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
  if (unattributed) out.push({ topic: UNATTRIBUTED, key: '', count: unattributed });
  return out;
}
