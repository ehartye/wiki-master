import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingReclips, settledKeys } from '../scripts/lib/triage.mjs';
import { swapSourceHash } from '../scripts/lib/repoint.mjs';
import { matchLocalFile } from '../scripts/lib/migrate.mjs';

// A paywalled source is fetched by hand into a downloads folder. It cannot be
// matched on the URL — a DOI like /doi/10.1145/3342765 carries no filename — so
// the match is against the CLIPPING'S TITLE. Ambiguity is never guessed.
test('matchLocalFile matches a download to a clipping title', () => {
  const files = ['unrelated.pdf', 'Terrain_amplification_with_implicit_3D_features.pdf'];
  assert.equal(
    matchLocalFile('Terrain amplification with implicit 3D features', files),
    'Terrain_amplification_with_implicit_3D_features.pdf'
  );
});

test('matchLocalFile tolerates extra decoration around the title', () => {
  assert.equal(
    matchLocalFile('Terrain amplification with implicit 3D features', ['3342765 - Terrain amplification with implicit 3D features (ACM).pdf']),
    '3342765 - Terrain amplification with implicit 3D features (ACM).pdf'
  );
});

test('matchLocalFile returns null when nothing matches', () => {
  assert.equal(matchLocalFile('Terrain amplification', ['some-other-paper.pdf']), null);
});

test('matchLocalFile refuses to guess between two candidates', () => {
  const files = ['Terrain amplification v1.pdf', 'Terrain amplification v2.pdf'];
  assert.equal(matchLocalFile('Terrain amplification', files), null, 'ambiguous must not pick one');
});

// A `reclip` disposition asked for work. Nothing ever performed it, so 30 sources
// sat dispositioned-but-unfixed and kept resurfacing. Fold the log to find what
// was asked for; whether it is still NEEDED is derived from the vault, not stored.

const d = (url, disposition, kind = 'fidelity') => ({ t: 'disposition', url, kind, disposition });

test('pendingReclips returns sources whose latest disposition asked for a re-clip', () => {
  assert.deepEqual(pendingReclips([d('https://a.test/p.pdf', 'reclip')]), ['https://a.test/p.pdf']);
});

test('pendingReclips: a later disposition supersedes an earlier one', () => {
  assert.deepEqual(pendingReclips([d('https://a.test/p.pdf', 'reclip'), d('https://a.test/p.pdf', 'acceptable')]), []);
  assert.deepEqual(
    pendingReclips([d('https://a.test/p.pdf', 'acceptable'), d('https://a.test/p.pdf', 'reclip')]),
    ['https://a.test/p.pdf'],
    'changing your mind back must re-queue the work'
  );
});

test('pendingReclips de-duplicates a source dispositioned repeatedly', () => {
  const log = [d('https://a.test/p.pdf', 'reclip'), d('https://a.test/p.pdf', 'reclip'), d('https://a.test/p.pdf', 'reclip')];
  assert.deepEqual(pendingReclips(log), ['https://a.test/p.pdf'], 'three clicks are one job');
});

test('pendingReclips ignores unrelated kinds and non-request dispositions', () => {
  const log = [d('https://a.test/x', 'reclip', 'blocked'), d('https://b.test/y', 'quarantine'), { t: 'issue', url: 'https://c.test/z', kind: 'fidelity' }];
  assert.deepEqual(pendingReclips(log), []);
});

// "downloaded" is the paywall answer: you fetched it by hand, and the disposition
// itself is the work order. It arrives on a `failed` issue, because by then the
// problem is that the source could not be fetched — not that it read poorly.
test('pendingReclips queues a "downloaded" disposition', () => {
  assert.deepEqual(pendingReclips([d('https://a.test/p.pdf', 'downloaded')]), ['https://a.test/p.pdf']);
});

test('pendingReclips queues a request recorded against a failed fetch', () => {
  assert.deepEqual(pendingReclips([d('https://dl.acm.org/doi/10.1145/3342765', 'downloaded', 'failed')]), ['https://dl.acm.org/doi/10.1145/3342765']);
});

test('pendingReclips counts one source recorded under both kinds as one job', () => {
  const log = [d('https://a.test/p.pdf', 'reclip', 'fidelity'), d('https://a.test/p.pdf', 'downloaded', 'failed')];
  assert.deepEqual(pendingReclips(log), ['https://a.test/p.pdf']);
});

// "A recurrence reopens an issue" — a disposition settles a source only until
// something new happens to it. An attempted re-clip that FAILS (a 403, or an
// extraction still degraded) leaves no artifact in the vault, so it is logged;
// suppression must then yield to it or the unfulfillable work goes invisible.
const iss = (url, kind = 'fidelity') => ({ t: 'issue', url, kind });

test('settledKeys: a disposition settles a source', () => {
  assert.equal(settledKeys([d('https://a.test/p', 'acceptable')]).size, 1);
});

test('settledKeys: an issue recorded AFTER the disposition reopens it', () => {
  const s = settledKeys([d('https://a.test/p', 'reclip'), iss('https://a.test/p')]);
  assert.equal(s.size, 0, 'a failed re-clip must resurface, not stay suppressed');
});

test('settledKeys: re-dispositioning after the reopen settles it again', () => {
  const s = settledKeys([d('https://a.test/p', 'reclip'), iss('https://a.test/p'), d('https://a.test/p', 'quarantine')]);
  assert.equal(s.size, 1, 'latest event wins');
});

test('settledKeys: an issue never dispositioned is not settled', () => {
  assert.equal(settledKeys([iss('https://a.test/p')]).size, 0);
});

// Re-clipping changes the content, so the recorded hash must follow or the
// freshly-clipped source is orphaned and reappears as ingest backlog.
test('swapSourceHash replaces one hash and leaves the others intact', () => {
  const t = '---\nsources: ["[[A]]", "[[B]]"]\nsource-hashes: ["aaa1111", "bbb2222"]\n---\nbody\n';
  const out = swapSourceHash(t, 'aaa1111', 'ccc3333');
  assert.match(out, /source-hashes: \["ccc3333", "bbb2222"\]/);
  assert.ok(out.endsWith('---\nbody\n'));
});

test('swapSourceHash is a no-op when the old hash is absent', () => {
  const t = '---\nsource-hashes: ["aaa1111"]\n---\nbody\n';
  assert.equal(swapSourceHash(t, 'zzz9999', 'ccc3333'), t);
});
