import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  recordIssue,
  disposeIssue,
  loadIssueLog,
  openIssues,
  declinesNearingExpiry,
  ISSUE_KINDS,
} from '../scripts/lib/triage.mjs';

function vault() {
  const d = mkdtempSync(join(tmpdir(), 'wm-triage-'));
  mkdirSync(join(d, '.wiki-master'), { recursive: true });
  return d;
}

test('recordIssue appends to an append-only log (no read-modify-write)', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403' });
  recordIssue(v, { url: 'https://b.test/2', kind: 'thin', reason: 'SPA shell' });

  const raw = readFileSync(join(v, '.wiki-master', 'triage.jsonl'), 'utf8');
  const lines = raw.trim().split('\n');
  assert.equal(lines.length, 2, 'one line per event');
  assert.equal(JSON.parse(lines[0]).url, 'https://a.test/1');
  assert.equal(JSON.parse(lines[1]).kind, 'thin');
});

test('openIssues folds the log — same url+kind twice yields one open issue', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403' });
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403 again' });

  const open = openIssues(loadIssueLog(v));
  assert.equal(open.length, 1);
  assert.equal(open[0].reason, '403 again', 'latest occurrence wins');
  assert.equal(open[0].occurrences, 2, 'repeat count is preserved');
});

test('the same url under different kinds stays distinct', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403' });
  recordIssue(v, { url: 'https://a.test/1', kind: 'fidelity', reason: 'gibberish' });
  assert.equal(openIssues(loadIssueLog(v)).length, 2);
});

test('disposeIssue resolves an issue without rewriting history', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403' });
  disposeIssue(v, { url: 'https://a.test/1', kind: 'failed', disposition: 'declined' });

  assert.equal(openIssues(loadIssueLog(v)).length, 0);
  const lines = readFileSync(join(v, '.wiki-master', 'triage.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2, 'disposition is appended, the original event is retained');
});

test('a recurrence after disposition reopens the issue', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403' });
  disposeIssue(v, { url: 'https://a.test/1', kind: 'failed', disposition: 'retry' });
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403 again' });

  const open = openIssues(loadIssueLog(v));
  assert.equal(open.length, 1, 'a failure after a retry is news, not history');
});

test('missing log is empty, not an error', () => {
  assert.deepEqual(loadIssueLog(vault()), []);
});

test('a corrupt line is skipped rather than poisoning the whole log', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403' });
  appendFileSync(join(v, '.wiki-master', 'triage.jsonl'), '{not json\n');
  recordIssue(v, { url: 'https://b.test/2', kind: 'failed', reason: '500' });

  assert.equal(loadIssueLog(v).length, 2);
  assert.equal(openIssues(loadIssueLog(v)).length, 2);
});

test('every recorded kind is a known kind', () => {
  const v = vault();
  for (const k of ISSUE_KINDS) recordIssue(v, { url: `https://x.test/${k}`, kind: k, reason: 'x' });
  assert.equal(openIssues(loadIssueLog(v)).length, ISSUE_KINDS.length);
});

test('declinesNearingExpiry surfaces only declines inside the warning window', () => {
  const v = vault();
  const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  writeFileSync(
    join(v, '.wiki-master', 'declined.json'),
    JSON.stringify([
      { url: 'https://fresh.test', reason: 'off-topic', date: daysAgo(5) },
      { url: 'https://soon.test', reason: 'thin content', date: daysAgo(170) },
      { url: 'https://expired.test', reason: 'old', date: daysAgo(200) },
    ])
  );

  const near = declinesNearingExpiry(v, { withinDays: 30 });
  assert.equal(near.length, 1);
  assert.equal(near[0].url, 'https://soon.test');
  assert.ok(near[0].daysRemaining > 0 && near[0].daysRemaining <= 30);
});

test('declinesNearingExpiry tolerates a missing or unreadable store', () => {
  assert.deepEqual(declinesNearingExpiry(vault()), []);
});

// --- research-topic attribution ---------------------------------------------
// The triage log is the carrier for issues that never became a file: a clip
// that 403s has no frontmatter to speak for it. See lib/topic.mjs and the
// 2026-08-10 design spec.

test('an issue records the research topic it came from', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403', topic: 'BPD Research' });
  const [open] = openIssues(loadIssueLog(v));
  assert.equal(open.topic, 'BPD Research');
});

test('an issue recorded outside a research run has no topic rather than an empty one', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403' });
  recordIssue(v, { url: 'https://a.test/2', kind: 'failed', reason: '403', topic: '   ' });
  const open = openIssues(loadIssueLog(v));
  assert.equal(open.length, 2);
  for (const o of open) assert.equal(o.topic, null);
});

// A recurrence reopens an issue (see the header), but a recurrence observed
// outside a research run carries no topic. Letting that null win would move the
// row into Unattributed precisely BECAUSE it recurred -- losing the attribution
// at the moment the item became more important, not less.
test('a topicless recurrence does not erase the topic the first sighting recorded', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403', topic: 'Audio DSP' });
  recordIssue(v, { url: 'https://a.test/1', kind: 'failed', reason: '403 again' });
  const [open] = openIssues(loadIssueLog(v));
  assert.equal(open.occurrences, 2);
  assert.equal(open.topic, 'Audio DSP');
});
