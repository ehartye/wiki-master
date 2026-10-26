import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as health from '../scripts/health.mjs';
import { integrityReport } from '../scripts/lib/integrity.mjs';

// Two additions to the integrity scan. `sources` scopes what it reports (the scan still reads the whole
// vault, because a link is only ambiguous against every page), and `unrecognizedBacklogStatus` lists backlog
// items whose status the generated roadmap cannot place. The second is unscored: it never changes the defect
// count, the status or the worklist.

const FM = ['type: authored', 'created: 2026-01-01', 'updated: 2026-01-01', 'status: draft', 'sources: []', 'ai-generated: true', 'project: demo'];
const note = (body, extra = []) => ['---', ...FM, ...extra, '---', body, ''].join('\n');
const BODY = 'This original page explains how the importer decides which of the two settings wins when they disagree.';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}
const item = (status) => note(BODY, ['kind: backlog-item', ...(status === null ? [] : [`backlog-status: ${status}`])]);

const BROKEN = {
  'wiki/authored/demo/a.md': note(`${BODY} See [[wiki/sources/missing-source]].`, ['kind: note']),
  'wiki/authored/demo/b.md': note(`${BODY} See [[nowhere-b]] and [[wiki/sources/also-missing]].`, ['kind: note']),
  'wiki/authored/demo/c.md': note(`${BODY} See [[nowhere-c]].`, ['kind: note']),
};

test('sources scopes issues, forward links and the cleared status to the named pages, and returns the pages it covered', (t) => {
  const root = fixture(t, BROKEN);
  const whole = health.scanIntegrity(root);
  assert.ok(whole.issues.some(i => i.source === 'wiki/authored/demo/a.md'));
  assert.ok(whole.issues.some(i => i.source === 'wiki/authored/demo/b.md'));
  assert.equal('pages' in whole, false, 'the whole-vault result is unchanged');
  const scoped = health.scanIntegrity(root, { sources: new Set(['wiki/authored/demo/a.md', 'wiki/authored/demo/c.md']) });
  assert.deepEqual([...new Set(scoped.issues.map(i => i.source))], ['wiki/authored/demo/a.md']);
  assert.deepEqual(scoped.forwardLinks.map(l => l.source), ['wiki/authored/demo/c.md']);
  assert.equal(scoped.defectCount, scoped.issues.length);
  assert.deepEqual(scoped.pages, ['wiki/authored/demo/a.md', 'wiki/authored/demo/c.md']);
  assert.deepEqual(scoped.issues, whole.issues.filter(i => i.source === 'wiki/authored/demo/a.md'));
});

test('a source that is not a scanned page is left out of pages, so a caller can see it', (t) => {
  const root = fixture(t, BROKEN);
  const scoped = health.scanIntegrity(root, { sources: new Set(['wiki/authored/demo/a.md', 'wiki/authored/demo/Missing.md', 'raw/clippings/x.md']) });
  assert.deepEqual(scoped.pages, ['wiki/authored/demo/a.md']);
});

test('an empty set of sources reports nothing', (t) => {
  const root = fixture(t, BROKEN);
  const scoped = health.scanIntegrity(root, { sources: new Set() });
  assert.equal(scoped.defectCount, 0);
  assert.deepEqual(scoped.forwardLinks, []);
  assert.deepEqual(scoped.pages, []);
});

test('the default result and report are the same with and without an options argument', (t) => {
  const root = fixture(t, BROKEN);
  const a = health.scanIntegrity(root), b = health.scanIntegrity(root, {});
  assert.deepEqual(a, b);
  assert.equal(integrityReport(a), integrityReport(b));
});

test('a backlog item with an unknown or missing status is listed, unscored', (t) => {
  const root = fixture(t, {
    'wiki/authored/demo/overview.md': note(BODY, ['kind: overview']),
    'wiki/authored/demo/backlog/ok.md': item('planned'),
    'wiki/authored/demo/backlog/old.md': item('done'),
    'wiki/authored/demo/backlog/none.md': item(null),
  });
  const r = health.scanIntegrity(root);
  assert.deepEqual(r.unrecognizedBacklogStatus, [
    { page: 'wiki/authored/demo/backlog/none.md', status: null },
    { page: 'wiki/authored/demo/backlog/old.md', status: 'done' },
  ]);
  assert.equal(r.defectCount, 0);
  assert.equal(r.status, 'clear');
  const report = integrityReport(r);
  assert.match(report, /Backlog items with a missing or unrecognized status: 2 \(unscored/);
  assert.match(report, /wiki\/authored\/demo\/backlog\/old\.md \(done\)/);
  assert.match(report, /wiki\/authored\/demo\/backlog\/none\.md \(no status\)/);
});

test('a vault with only recognized statuses prints no new line and an empty list', (t) => {
  const root = fixture(t, {
    'wiki/authored/demo/overview.md': note(BODY, ['kind: overview']),
    'wiki/authored/demo/backlog/ok.md': item('shipped'),
    'wiki/authored/demo/backlog/ok2.md': item('in-progress'),
  });
  const r = health.scanIntegrity(root);
  assert.deepEqual(r.unrecognizedBacklogStatus, []);
  assert.doesNotMatch(integrityReport(r), /unrecognized status/);
});

test('only backlog items under wiki/authored count', (t) => {
  const root = fixture(t, {
    'wiki/authored/demo/overview.md': note(BODY, ['kind: overview']),
    'wiki/authored/demo/note.md': note(BODY, ['kind: note', 'backlog-status: done']),
    'wiki/concepts/elsewhere.md': note(BODY, ['kind: backlog-item', 'backlog-status: done']),
  });
  assert.deepEqual(health.scanIntegrity(root).unrecognizedBacklogStatus, []);
});

test('the report names five and counts the rest', (t) => {
  const files = { 'wiki/authored/demo/overview.md': note(BODY, ['kind: overview']) };
  for (let i = 0; i < 7; i++) files[`wiki/authored/demo/backlog/old-${i}.md`] = item('done');
  const report = integrityReport(health.scanIntegrity(fixture(t, files)));
  assert.match(report, /status: 7 \(unscored/);
  assert.match(report, /old-4\.md \(done\), \.\.\./);
  assert.doesNotMatch(report, /old-5\.md/);
});

test('a scoped scan keeps the unrecognized list to the named pages', (t) => {
  const root = fixture(t, {
    'wiki/authored/demo/overview.md': note(BODY, ['kind: overview']),
    'wiki/authored/demo/backlog/old.md': item('done'),
    'wiki/authored/demo/backlog/old2.md': item('proposed'),
  });
  const scoped = health.scanIntegrity(root, { sources: new Set(['wiki/authored/demo/backlog/old2.md']) });
  assert.deepEqual(scoped.unrecognizedBacklogStatus, [{ page: 'wiki/authored/demo/backlog/old2.md', status: 'proposed' }]);
});
