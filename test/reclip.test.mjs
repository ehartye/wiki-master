import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingReclips, settledKeys } from '../scripts/lib/triage.mjs';
import { swapSourceHash } from '../scripts/lib/repoint.mjs';

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

test('pendingReclips ignores other kinds and other dispositions', () => {
  const log = [d('https://a.test/x', 'reclip', 'failed'), d('https://b.test/y', 'quarantine'), { t: 'issue', url: 'https://c.test/z', kind: 'fidelity' }];
  assert.deepEqual(pendingReclips(log), []);
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
