import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/clip.mjs';
import { clipSlugCandidates } from '../scripts/lib/clip-slug.mjs';
import { recordIssue, openIssues, loadIssueLog, closeIssuesResolvedByClip } from '../scripts/lib/triage.mjs';

// A clash is queued as an `attention` row because a name nobody can take needs a person to choose one. But a write
// that kept losing to other sessions is a condition that clears by itself, and a clash is always answered by clipping
// the URL again under a name. The row must not outlive that clip: the queue names work that is done.
// Other `attention` rows stay: reaching the content does not settle what a person was asked to decide.

const URL1 = 'https://raw.githubusercontent.com/acme/agent/v4.2.1/skills/one/SKILL.md';
const BODY = 'A substantive paragraph of document text that is long enough to count as content. '.repeat(30);
const extract = () => ({ title: '', contentMarkdown: BODY });

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clash-clear-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  return { root, dir: join(root, 'raw', 'clippings'), rows: () => openIssues(loadIssueLog(root)) };
}
const quiet = (fn) => { const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = log; console.error = err; } };
const clip = (args = [], deps = {}) => quiet(() => main([URL1, ...args], { extract, ...deps }));

test('clip, clash, clip again: the clash row is gone once the clip lands', (t) => {
  const v = vault(t);
  const lost = clip([], { writeClipping: () => false });
  assert.equal(lost.status, 'clash');
  assert.equal(v.rows().length, 1);
  const again = clip();
  assert.equal(again.status, 'clipped');
  assert.deepEqual(v.rows(), []);
});

test('the same when the clash came from every name being taken and the second clip names the file', (t) => {
  const v = vault(t);
  clipSlugCandidates({ title: '', url: URL1 }).forEach((name, i) => writeFileSync(join(v.dir, `${name}.md`), `---\nsource: "https://other.test/${i}"\n---\nx\n`));
  assert.equal(clip().status, 'clash');
  assert.equal(v.rows().length, 1);
  assert.equal(clip(['--slug=my-skill']).status, 'clipped');
  assert.deepEqual(v.rows(), []);
});

test('a clash row is closed with a disposition that says why', (t) => {
  const v = vault(t);
  clip([], { writeClipping: () => false });
  clip();
  const disposition = loadIssueLog(v.root).filter((e) => e.t === 'disposition');
  assert.equal(disposition.length, 1);
  assert.equal(disposition[0].kind, 'attention');
  assert.equal(disposition[0].disposition, 'clipped');
  assert.match(disposition[0].note, /closed automatically: clip succeeded/);
});

test('only a row tagged retryable is closed; the tag survives a read and a recurrence without it clears it', (t) => {
  const v = vault(t);
  recordIssue(v.root, { url: URL1, kind: 'attention', reason: 'a', retryable: 'clash' });
  assert.equal(v.rows()[0].retryable, 'clash');
  recordIssue(v.root, { url: URL1, kind: 'attention', reason: 'a person must decide this' });
  assert.equal(v.rows()[0].retryable, undefined, 'a recurrence recorded without the tag is a decision for a person again');
  assert.equal(closeIssuesResolvedByClip(v.root, URL1, 'clipped'), 0);
});

test('an attention row someone raised on purpose is not closed by a clip', (t) => {
  const v = vault(t);
  recordIssue(v.root, { url: URL1, kind: 'attention', reason: 'check the licence before keeping this', source: 'raw/clippings/x.md' });
  assert.equal(clip().status, 'clipped');
  assert.equal(v.rows().length, 1);
  assert.equal(closeIssuesResolvedByClip(v.root, URL1, 'clipped'), 0);
});

test('a clash row for another URL is untouched', (t) => {
  const v = vault(t);
  clip([], { writeClipping: () => false });
  const other = quiet(() => main(['https://example.org/other.html'], { extract: () => ({ title: 'Other', contentMarkdown: BODY }) }));
  assert.equal(other.status, 'clipped');
  assert.equal(v.rows().length, 1);
});
