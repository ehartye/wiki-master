import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { scanClippings, collectTriage } from '../scripts/triage.mjs';
import { buildTopicIndex, attributeItem } from '../scripts/lib/topic.mjs';
import { disposeIssue, recordIssue, loadIssueLog, pendingReclips } from '../scripts/lib/triage.mjs';
import { runReclips } from '../scripts/lib/reclip.mjs';

// A recapture is a second clipping of a URL, written beside the first and naming it in `recapture-of`. The
// clipper route that writes one is separate work; these tests hand-write the two files. Every consumer that used to
// assume one clipping per URL has to cope: the topic index, a pending re-clip request, and the triage rows. The
// ingest backlog is joined by source-hash, so two captures with different text are already two rows and nothing
// here changes that.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const URL_ = 'https://docs.example.org/guide';
const FIRST = 'raw/clippings/Guide.md';
const SECOND_NAME = 'Guide (recaptured 2026-03-01).md';
const SECOND = `raw/clippings/${SECOND_NAME}`;
const SENTENCES = Array.from({ length: 40 }, (_, i) => `Step ${i} explains how the service handles request number ${i} and what a client should expect back.`);
const OLD_BODY = SENTENCES.join('\n\n');
const NEW_BODY = `${OLD_BODY}\n\nA newer section describes the changed behavior in a few more words for the reader.`;

const clipping = ({ created, topic, hash, extra = '' }) =>
  `---\ntitle: "Guide"\nsource: "${URL_}"\ncreated: ${created}\n${topic ? `topic: "${topic}"\n` : ''}${extra}source-hash: ${hash}\n---\n\n`;

function vault(t, { firstExtra = '', secondExtra = '', secondBody = NEW_BODY } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-recapture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/sources', '.wiki-master']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, FIRST), clipping({ created: '2026-01-01', topic: 'Old topic', hash: sha(OLD_BODY), extra: firstExtra }) + OLD_BODY + '\n');
  writeFileSync(join(dir, SECOND), clipping({ created: '2026-03-01', topic: 'New topic', hash: sha(secondBody), extra: `recapture-of: "${FIRST}"\n${secondExtra}` }) + secondBody + '\n');
  return dir;
}
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const page = (body) => async () => ({ md: body, wordCount: (body.match(/\S+/g) || []).length, hash: sha(body), fidelity: 'high', extraction: undefined, fidelityChecks: 12, fidelityIgnored: 0 });

// --- the topic index ---------------------------------------------------------

test('the topic index returns the topic of the newest capture of a URL', (t) => {
  const dir = vault(t);
  const index = buildTopicIndex(scanClippings(dir).topics);
  assert.equal(attributeItem({ url: URL_ }, index), 'New topic');
});

test('each capture still answers for its own path', (t) => {
  const dir = vault(t);
  const index = buildTopicIndex(scanClippings(dir).topics);
  assert.equal(attributeItem({ url: FIRST }, index), 'Old topic');
  assert.equal(attributeItem({ url: SECOND }, index), 'New topic');
});

// --- a pending re-clip request -----------------------------------------------

test('a pending re-clip request for a URL selects only the newest capture', async (t) => {
  const dir = vault(t);
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'reclip' });
  const report = await runReclips({ vaultPath: dir });
  assert.equal(report.selected, 1);
  assert.deepEqual(report.results.map((r) => r.path), [SECOND]);
});

test('the request never reaches an older capture, even when the newest cannot be repaired', async (t) => {
  const dir = vault(t, { secondExtra: 'citation-status: quarantined\n' });
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'reclip' });
  const report = await runReclips({ vaultPath: dir });
  assert.equal(report.selected, 0, 'a repair must not fall back to overwriting the older evidence');
});

test('an explicit target is still honored, so a person can repair an older capture on purpose', async (t) => {
  const dir = vault(t);
  const report = await runReclips({ vaultPath: dir, targets: [FIRST] });
  assert.deepEqual(report.results.map((r) => r.path), [FIRST]);
});

test('a chain of recaptures selects only the last link', async (t) => {
  const dir = vault(t);
  const third = 'raw/clippings/Guide (recaptured 2026-05-01).md';
  const body = `${NEW_BODY}\n\nAnd one more paragraph added later for the third capture.`;
  writeFileSync(join(dir, third), clipping({ created: '2026-05-01', topic: 'Newest topic', hash: sha(body), extra: `recapture-of: "${SECOND}"\n` }) + body + '\n');
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'reclip' });
  const report = await runReclips({ vaultPath: dir });
  assert.deepEqual(report.results.map((r) => r.path), [third]);
});

test('a URL with one capture is selected as before', async (t) => {
  const dir = vault(t);
  rmSync(join(dir, SECOND));
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'reclip' });
  assert.deepEqual((await runReclips({ vaultPath: dir })).results.map((r) => r.path), [FIRST]);
});

test('repairing the newest capture closes the request and leaves the older capture byte-identical', async (t) => {
  const dir = vault(t);
  const before = read(dir, FIRST);
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'reclip' });
  const report = await runReclips({ vaultPath: dir, apply: true, readPage: page(`${NEW_BODY}\n\n\`\`\`\ncurl https://api.example.org/run\n\`\`\``) });
  assert.equal(report.reclipped, 1, JSON.stringify(report));
  assert.deepEqual(report.changed, [SECOND]);
  assert.equal(read(dir, FIRST), before, 'the older capture is never edited');
  assert.deepEqual(pendingReclips(loadIssueLog(dir)), [], 'the repaired URL is no longer waiting');
});

// --- triage ------------------------------------------------------------------

const fidelityTitles = (data) => data.fidelity.map((row) => row.title);

test('a quarantine on the older capture suppresses no row of the newer one', (t) => {
  const dir = vault(t, { firstExtra: 'fidelity: partial\ncitation-status: quarantined\n', secondExtra: 'fidelity: partial\n' });
  recordIssue(dir, { url: URL_, kind: 'thin', reason: 'thin shell' });
  recordIssue(dir, { url: URL_, kind: 'attention', reason: 'check this page' });
  writeFileSync(join(dir, '.wiki-master/declined.json'), JSON.stringify([{ url: URL_, reason: 'noisy', date: new Date(Date.now() - 160 * 86400000).toISOString() }]));
  const data = collectTriage(dir);
  assert.deepEqual(fidelityTitles(data), [SECOND_NAME.replace(/\.md$/, '')], 'the flagged newer capture is listed');
  assert.deepEqual(data.clipFailures.map((r) => r.kind), ['thin']);
  assert.equal(data.attention.length, 1);
  assert.equal(data.expiring.length, 1, 'the decline on the URL is still shown');
  assert.deepEqual(data.backlog.map((r) => r.url), [SECOND], 'the older capture, quarantined, is not offered for ingest');
});

test('the quarantine disposition recorded for the older capture does not hide the newer capture', (t) => {
  const dir = vault(t, { firstExtra: 'fidelity: partial\ncitation-status: quarantined\n', secondExtra: 'fidelity: partial\n' });
  // What apply-reclips records when it quarantined the older capture, before any recapture existed.
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'quarantine', note: 'unreadable' });
  assert.deepEqual(fidelityTitles(collectTriage(dir)), [SECOND_NAME.replace(/\.md$/, '')]);
});

test('a person who accepts the newer capture afterwards is still believed', (t) => {
  const dir = vault(t, { firstExtra: 'fidelity: partial\ncitation-status: quarantined\n', secondExtra: 'fidelity: partial\n' });
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'quarantine', note: 'unreadable' });
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'acceptable', note: null });
  assert.deepEqual(fidelityTitles(collectTriage(dir)), []);
});

test('without a recapture-of link the quarantine disposition still settles the URL', (t) => {
  const dir = vault(t, { firstExtra: 'fidelity: partial\ncitation-status: quarantined\n', secondExtra: 'fidelity: partial\n' });
  writeFileSync(join(dir, SECOND), read(dir, SECOND).replace(/recapture-of:[^\n]*\n/, ''));
  disposeIssue(dir, { url: URL_, kind: 'fidelity', disposition: 'quarantine', note: 'unreadable' });
  assert.deepEqual(fidelityTitles(collectTriage(dir)), [], 'only a declared recapture is treated as a new capture');
});

// --- health ------------------------------------------------------------------

function health(dir, flag) {
  const env = { ...process.env, WIKI_MASTER_VAULT: dir, HOME: dir, USERPROFILE: dir, WIKI_MASTER_BROWSER: '/no/such/browser' };
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'health.mjs'), flag], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('health lists both captures in the ingest backlog and reports no new defect', (t) => {
  const single = vault(t);
  rmSync(join(single, SECOND));
  const both = vault(t);
  const base = JSON.parse(health(single, '--json'));
  const json = JSON.parse(health(both, '--json'));
  assert.equal(json.defectCount, 0);
  assert.equal(json.defectCount, base.defectCount);
  assert.deepEqual(json.issues, base.issues);
  const backlog = health(both, '--backlog');
  const listed = backlog.split('not ingested')[1].split('unparsed raw sources')[0];
  assert.ok(listed.includes(FIRST) && listed.includes(SECOND), listed);
  assert.match(backlog, /clippings missing source-hash \(repair\): 0/);
});
