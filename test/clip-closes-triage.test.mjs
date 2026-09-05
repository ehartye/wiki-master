// A successful clip has to close the triage rows it just answered.
//
// Found by replaying this vault's 54 open `failed` rows through the new clip
// ladder on 2026-09-05: 20 clipped and 9 turned out to be already in the vault,
// yet `failed` stayed at 54 and total open issues went 65 -> 74. clip.mjs
// records an issue on every failure and nothing at all on success, so a source
// that finally arrives leaves its old row standing forever, and the new,
// specific diagnosis is ADDED beside the stale blanket one rather than
// replacing it. The queue gets louder every time you work it — the exact
// opposite of what a queue is for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordIssue, openIssues, loadIssueLog, closeIssuesResolvedByClip, CLIP_RESOLVES_KINDS,
} from '../scripts/lib/triage.mjs';

function vault() {
  const v = mkdtempSync(join(tmpdir(), 'wm-triage-'));
  mkdirSync(join(v, 'raw', 'clippings'), { recursive: true });
  return v;
}

test('clipping a url closes the fetch-failure row it just disproved', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/x', kind: 'failed', reason: 'fetch failed' });
  assert.equal(openIssues(loadIssueLog(v)).length, 1);

  closeIssuesResolvedByClip(v, 'https://a.test/x', 'clipped');
  assert.equal(openIssues(loadIssueLog(v)).length, 0);
});

test('every kind that means "we could not get this content" is closed', () => {
  const v = vault();
  for (const kind of CLIP_RESOLVES_KINDS) {
    recordIssue(v, { url: `https://a.test/${kind}`, kind, reason: 'x' });
  }
  for (const kind of CLIP_RESOLVES_KINDS) {
    closeIssuesResolvedByClip(v, `https://a.test/${kind}`, 'clipped');
  }
  assert.deepEqual(openIssues(loadIssueLog(v)), []);
});

test('a human decision request is NEVER auto-closed by a clip', () => {
  // `attention` means "the agent wants a human to decide". Arriving at the
  // content does not make that decision, and silently closing it would delete
  // somebody's todo. Same for `fidelity`, which is a claim about how far an
  // ALREADY-CLIPPED extraction can be trusted -- a fresh clip of the same url
  // does not settle it either.
  const v = vault();
  recordIssue(v, { url: 'https://a.test/x', kind: 'attention', reason: 'is this in scope?' });
  recordIssue(v, { url: 'https://a.test/x', kind: 'fidelity', reason: 'fidelity: low' });
  recordIssue(v, { url: 'https://a.test/x', kind: 'failed', reason: 'fetch failed' });

  closeIssuesResolvedByClip(v, 'https://a.test/x', 'clipped');

  const still = openIssues(loadIssueLog(v)).map((i) => i.kind).sort();
  assert.deepEqual(still, ['attention', 'fidelity'], 'only the fetch failure is answered by a clip');
});

test('closing is scoped to the url clipped, never a whole domain', () => {
  const v = vault();
  recordIssue(v, { url: 'https://a.test/one', kind: 'failed', reason: 'x' });
  recordIssue(v, { url: 'https://a.test/two', kind: 'failed', reason: 'x' });
  closeIssuesResolvedByClip(v, 'https://a.test/one', 'clipped');
  const left = openIssues(loadIssueLog(v));
  assert.equal(left.length, 1);
  assert.equal(left[0].url, 'https://a.test/two');
});

test('a url already in the vault closes its row too', () => {
  // 9 of the 29 stale rows in the real run were `duplicate` — already clipped,
  // by an earlier run or another clipper. The row is just as wrong as one whose
  // clip landed today, and leaving it open is what let 29 accumulate.
  const v = vault();
  recordIssue(v, { url: 'https://a.test/x', kind: 'failed', reason: 'fetch failed' });
  closeIssuesResolvedByClip(v, 'https://a.test/x', 'duplicate');
  assert.equal(openIssues(loadIssueLog(v)).length, 0);
});

test('the note records HOW it was resolved, so the log stays auditable', () => {
  // The log is events, not state (see lib/triage.mjs). "Closed because a clip
  // landed" and "closed because a human said ignore" must stay tellable apart
  // long after the fact.
  const v = vault();
  recordIssue(v, { url: 'https://a.test/x', kind: 'failed', reason: 'fetch failed' });
  closeIssuesResolvedByClip(v, 'https://a.test/x', 'clipped');
  const d = loadIssueLog(v).find((e) => e.t === 'disposition');
  assert.equal(d.disposition, 'clipped');
  assert.match(d.note, /clip/i);
});

test('closing nothing is silent, so every healthy clip does not pay for this', () => {
  const v = vault();
  const closed = closeIssuesResolvedByClip(v, 'https://never-queued.test/x', 'clipped');
  assert.equal(closed, 0);
  assert.equal(loadIssueLog(v).length, 0, 'no row means no event — the log must not grow on a normal clip');
});
