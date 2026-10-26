import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync as rfs } from 'node:fs';
import {
  loadDeclines, recordDecline, isDeclined, supersedeDecline, isAutomaticDecline, AUTOMATIC_REASON, DECLINE_TTL_DAYS,
} from '../scripts/lib/decline.mjs';
import { declineFlags, declineGate } from '../scripts/lib/decline-gate.mjs';
import { THIN_DECLINE_REASON } from '../scripts/clip-docx.mjs';
import { thinOutcome } from '../scripts/clip-pdf.mjs';
import { classifyShortExtraction } from '../scripts/clip.mjs';

// A decline can be wrong, or stop being true. Two ways out, both applied only after a clip is written so a failed clip
// leaves the decline in place: --override-decline lifts a decline the clippers recorded themselves (a thin or
// wrong-node verdict), and --supersede-decline="reason" supersedes any decline with a recorded reason. Neither deletes:
// the entry keeps the original reason and date, and gains the new reason and date.

function vault(t) {
  const v = mkdtempSync(join(tmpdir(), 'wm-supersede-'));
  t.after(() => rmSync(v, { recursive: true, force: true }));
  return v;
}
const store = (v) => JSON.parse(readFileSync(join(v, '.wiki-master', 'declined.json'), 'utf8'));
const URL1 = 'https://example.com/a';

test('supersedeDecline keeps the entry, adds the new reason and date, and the URL is no longer declined', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'off-topic');
  const r = supersedeDecline(v, URL1, 'needed for the physics research');
  assert.equal(r.done, true);
  const [e] = store(v);
  assert.equal(e.reason, 'off-topic');
  assert.equal(e.superseded.reason, 'needed for the physics research');
  assert.match(e.superseded.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(isDeclined(URL1, loadDeclines(v)), false);
  assert.deepEqual(loadDeclines(v), [], 'the loaded list is the active declines only, which purge reads as "declined"');
});

test('supersedeDecline on a URL with no active decline does nothing and says why', (t) => {
  const v = vault(t);
  assert.deepEqual(supersedeDecline(v, URL1, 'x'), { done: false, why: 'none' });
  recordDecline(v, URL1, 'off-topic');
  supersedeDecline(v, URL1, 'x');
  assert.deepEqual(supersedeDecline(v, URL1, 'again'), { done: false, why: 'none' }, 'an already superseded decline is not superseded twice');
});

test('onlyAutomatic refuses a decline someone recorded on purpose', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'redundant with the vendor guide');
  assert.deepEqual(supersedeDecline(v, URL1, 'x', { onlyAutomatic: true }), { done: false, why: 'not-automatic' });
  assert.equal(isDeclined(URL1, loadDeclines(v)), true);
  recordDecline(v, 'https://example.com/b', 'thin content (SPA/paywall shell)');
  assert.equal(supersedeDecline(v, 'https://example.com/b', 'x', { onlyAutomatic: true }).done, true);
});

test('declining a URL again appends to its history instead of replacing it', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'first reason');
  supersedeDecline(v, URL1, 'it was needed');
  recordDecline(v, URL1, 'second reason');
  const [e] = store(v);
  assert.equal(e.reason, 'second reason');
  assert.equal(e.superseded, undefined, 'the new decline is active');
  assert.equal(e.history.length, 1);
  assert.equal(e.history[0].reason, 'first reason');
  assert.equal(e.history[0].superseded.reason, 'it was needed');
  recordDecline(v, URL1, 'third reason');
  assert.deepEqual(store(v)[0].history.map((h) => h.reason), ['first reason', 'second reason']);
  assert.equal(loadDeclines(v).length, 1);
});

test('a first decline has no history field, so the stored shape is the old one', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'x');
  assert.deepEqual(Object.keys(store(v)[0]).sort(), ['date', 'reason', 'url']);
});

test('a superseded entry still expires with its original date', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'x');
  supersedeDecline(v, URL1, 'y');
  const raw = store(v);
  raw[0].date = new Date(Date.now() - (DECLINE_TTL_DAYS + 1) * 86400_000).toISOString().slice(0, 10);
  writeFileSync(join(v, '.wiki-master', 'declined.json'), JSON.stringify(raw));
  assert.equal(loadDeclines(v).length, 0);
});

test('an older reader that knows nothing of the new fields still treats the entry as declined', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'x');
  supersedeDecline(v, URL1, 'y');
  // what 0.73.0 does: read the file, keep entries by date, match by URL, and ignore any field it does not know
  const old = (url) => JSON.parse(readFileSync(join(v, '.wiki-master', 'declined.json'), 'utf8'))
    .filter((e) => new Date(e.date).getTime() >= Date.now() - DECLINE_TTL_DAYS * 86400_000)
    .some((e) => e.url === url);
  assert.equal(old(URL1), true, 'the safe direction: an old copy keeps honouring the decline');
});

test('automatic reasons: thin content, thin text and a wrong-node verdict; a human reason is not', () => {
  for (const r of ['thin content (SPA/paywall shell)', 'thin text (empty/near-empty docx)', 'thin text (scanned/encrypted; OCR ran and also failed)', 'thin content (empty/near-empty deck)', 'likely wrong-node extraction (description has substantive text)'])
    assert.equal(isAutomaticDecline({ reason: r }), true, r);
  for (const r of ['off-topic', 'redundant with the vendor guide', 'paywalled; thin extraction', 'purged:abc', 'purge-manifest-replay'])
    assert.equal(isAutomaticDecline({ reason: r }), false, r);
  assert.equal(isAutomaticDecline(undefined), false);
});

test('every reason the clippers record on their own is automatic', () => {
  assert.ok(AUTOMATIC_REASON.test(THIN_DECLINE_REASON));
  assert.ok(AUTOMATIC_REASON.test(thinOutcome({ ocrAvailable: true }).reason));
  const verdicts = [
    classifyShortExtraction({ markdown: '', rawHtml: '<html><body></body></html>', description: '' }),
    classifyShortExtraction({ markdown: 'x', rawHtml: '<html><body><div>' + 'word '.repeat(200) + '</div></body></html>', description: 'A long description with substantive words that are not in the extracted text at all, repeated several times over for length. '.repeat(3) }),
  ].filter((v) => v.reason);
  assert.ok(verdicts.length >= 1);
  for (const v of verdicts) assert.ok(AUTOMATIC_REASON.test(v.reason), v.reason);
  // the literal reasons in the other clippers
  const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
  const literals = readdirSync(scripts).filter((f) => /^clip.*\.mjs$/.test(f))
    .flatMap((f) => [...rfs(join(scripts, f), 'utf8').matchAll(/recordDecline\(vaultPath,[^,]+,\s*'([^']+)'\)/g)].map((m) => m[1]));
  assert.ok(literals.length >= 3, 'the scan found the literal reasons');
  for (const r of literals) assert.ok(AUTOMATIC_REASON.test(r), `automatic reason not recognised: ${r}`);
});

test('declineFlags reads both flags and refuses an empty reason or both at once', () => {
  assert.deepEqual(declineFlags(['f', '--override-decline']), { override: true, supersede: undefined });
  assert.deepEqual(declineFlags(['f', '--supersede-decline=needed now']), { override: false, supersede: 'needed now' });
  assert.deepEqual(declineFlags(['f']), { override: false, supersede: undefined });
  assert.match(declineFlags(['f', '--supersede-decline=']).error, /needs a reason/);
  assert.match(declineFlags(['f', '--supersede-decline=   ']).error, /needs a reason/);
  assert.match(declineFlags(['f', '--override-decline', '--supersede-decline=x']).error, /one of/);
});

test('declineGate: no decline, nothing to do', (t) => {
  const v = vault(t);
  const g = declineGate(v, URL1, ['--override-decline'], { log: () => {} });
  assert.equal(g.blocked, false);
  g.finish();
  assert.equal(loadDeclines(v).length, 0);
});

test('declineGate: a decline blocks, with the message the clippers always printed', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'off-topic');
  const g = declineGate(v, URL1, [], { log: () => {} });
  assert.equal(g.blocked, true);
  assert.equal(g.message, `declined previously (${new Date().toISOString().slice(0, 10)}: off-topic): ${URL1}`);
});

test('declineGate: --override-decline lifts an automatic decline, only when finish runs', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'thin content (SPA/paywall shell)');
  const logs = [];
  const g = declineGate(v, URL1, ['--override-decline'], { log: (s) => logs.push(s) });
  assert.equal(g.blocked, false);
  assert.equal(isDeclined(URL1, loadDeclines(v)), true, 'nothing changes before the clip is written');
  g.finish();
  assert.equal(isDeclined(URL1, loadDeclines(v)), false);
  assert.match(logs.join('\n'), /--override-decline/);
  assert.match(store(v)[0].superseded.reason, /clipped by hand/);
});

test('declineGate: --override-decline does not lift a decline someone chose, and names the way', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'redundant with the vendor guide');
  const g = declineGate(v, URL1, ['--override-decline'], { log: () => {} });
  assert.equal(g.blocked, true);
  assert.match(g.message, /redundant with the vendor guide/);
  assert.match(g.message, /--supersede-decline="reason"/);
  assert.equal(isDeclined(URL1, loadDeclines(v)), true);
});

test('declineGate: --supersede-decline lifts any decline and records the reason, after finish', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'redundant with the vendor guide');
  const g = declineGate(v, URL1, ['--supersede-decline=the vendor guide omits the limits table'], { log: () => {} });
  assert.equal(g.blocked, false);
  assert.equal(isDeclined(URL1, loadDeclines(v)), true);
  g.finish();
  assert.equal(isDeclined(URL1, loadDeclines(v)), false);
  assert.equal(store(v)[0].superseded.reason, 'the vendor guide omits the limits table');
});

test('declineGate: a bad flag blocks with an error and touches nothing', (t) => {
  const v = vault(t);
  recordDecline(v, URL1, 'thin content (SPA/paywall shell)');
  const g = declineGate(v, URL1, ['--supersede-decline='], { log: () => {} });
  assert.equal(g.blocked, true);
  assert.match(g.error, /needs a reason/);
  assert.equal(isDeclined(URL1, loadDeclines(v)), true);
});

test('isDeclined itself ignores a superseded entry it is handed', () => {
  const entries = [{ url: URL1, reason: 'x', date: '2026-10-26', superseded: { reason: 'y', date: '2026-10-26' } }];
  assert.equal(isDeclined(URL1, entries), false);
  assert.equal(isDeclined(URL1, [{ url: URL1, reason: 'x', date: '2026-10-26' }]), true);
});
