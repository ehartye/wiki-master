import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from '../scripts/clip.mjs';
import { recordDecline, loadDeclines, isDeclined } from '../scripts/lib/decline.mjs';
import { CLIP_SPECS, checkClipArgs } from '../scripts/lib/clip-args.mjs';

// A page declined as thin can later be had another way (a saved file, a print to PDF, a rendered copy), and a decline
// someone chose can stop holding. The decline log used to block both with no way through. The flags lift a decline
// only once the clipping is written, so a clip that does not happen leaves the decline where it was.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const URL1 = 'https://example.com/docs/page';
const BODY = 'A substantive paragraph of document text that is long enough to count as content. '.repeat(30);
const good = () => ({ title: 'Page', contentMarkdown: BODY });
const thin = () => ({ title: 'Page', contentMarkdown: 'tiny' });

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-declineflags-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  return { root, clippings: () => readdirSync(join(root, 'raw', 'clippings')), store: () => JSON.parse(readFileSync(join(root, '.wiki-master', 'declined.json'), 'utf8')) };
}
const quiet = (fn) => { const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = log; console.error = err; } };
const clip = (args, extract = good) => quiet(() => main([URL1, ...args], { extract }));

test('without a flag an active decline still stops the clip, with the same message', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL1, 'thin content (SPA/paywall shell)');
  const lines = [];
  const log = console.log;
  console.log = (s) => lines.push(s);
  let r;
  try { r = main([URL1], { extract: good }); } finally { console.log = log; }
  assert.equal(r.status, 'declined');
  assert.match(lines.join('\n'), new RegExp(`^declined previously \\(\\d{4}-\\d{2}-\\d{2}: thin content \\(SPA/paywall shell\\)\\): ${URL1}$`));
  assert.deepEqual(v.clippings(), []);
});

test('--override-decline clips past an automatic decline and supersedes it once the clipping is written', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL1, 'thin content (SPA/paywall shell)');
  const r = clip(['--override-decline']);
  assert.equal(r.status, 'clipped');
  assert.equal(v.clippings().length, 1);
  assert.equal(isDeclined(URL1, loadDeclines(v.root)), false);
  assert.match(v.store()[0].superseded.reason, /clipped by hand/);
});

test('--override-decline leaves a decline someone recorded on purpose, and nothing is clipped', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL1, 'redundant with the vendor guide');
  const r = clip(['--override-decline']);
  assert.equal(r.status, 'declined');
  assert.deepEqual(v.clippings(), []);
  assert.equal(isDeclined(URL1, loadDeclines(v.root)), true);
});

test('--supersede-decline clips past any decline and records why', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL1, 'redundant with the vendor guide');
  const r = clip(['--supersede-decline=the vendor guide omits the limits table']);
  assert.equal(r.status, 'clipped');
  assert.equal(v.clippings().length, 1);
  const [e] = v.store();
  assert.equal(e.reason, 'redundant with the vendor guide');
  assert.equal(e.superseded.reason, 'the vendor guide omits the limits table');
  assert.equal(isDeclined(URL1, loadDeclines(v.root)), false);
});

test('a clip that does not happen leaves the decline in place (thin again, duplicate)', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL1, 'redundant with the vendor guide');
  const again = clip(['--supersede-decline=try again'], thin);
  assert.notEqual(again.status, 'clipped');
  assert.deepEqual(v.clippings(), []);
  const [e] = v.store();
  assert.equal(isDeclined(URL1, loadDeclines(v.root)), true, 'a thin result declines it again, so it is active');
  assert.match(e.reason, /^thin content/, 'the active decline is the new one');
  assert.equal(e.history.length, 1);
  assert.equal(e.history[0].reason, 'redundant with the vendor guide');
  assert.equal(e.history[0].superseded, undefined, 'the flag did not take effect on a clip that was not written');
});

test('with no decline the flags change nothing', (t) => {
  const v = vault(t);
  assert.equal(clip(['--override-decline']).status, 'clipped');
  assert.equal(clip(['--supersede-decline=x']).status, 'duplicate');
  assert.equal(v.clippings().length, 1);
});

test('an empty reason, or both flags, stop before anything is fetched or written', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL1, 'thin content (SPA/paywall shell)');
  for (const args of [['--supersede-decline='], ['--override-decline', '--supersede-decline=x']]) {
    process.exitCode = 0;
    const r = clip(args, () => { throw new Error('fetched'); });
    assert.equal(r.status, 'error', args.join(' '));
    assert.equal(process.exitCode, 2);
    process.exitCode = 0;
  }
  assert.equal(isDeclined(URL1, loadDeclines(v.root)), true);
});

test('every clipper accepts both flags and shows them in its usage', () => {
  for (const [name, spec] of Object.entries(CLIP_SPECS)) {
    assert.deepEqual(checkClipArgs(['target', '--override-decline'], spec), { ok: true }, name);
    assert.deepEqual(checkClipArgs(['target', '--supersede-decline=because'], spec), { ok: true }, name);
    assert.match(checkClipArgs(['target', '--supersede-decline'], spec).error, /needs a value/, name);
    assert.ok(spec.usage.some((l) => l.includes('--override-decline')) && spec.usage.some((l) => l.includes('--supersede-decline')), name);
  }
});

test('every clipper asks the gate before it works and finishes it only where it writes its clipping', () => {
  for (const name of ['clip', 'clip-pdf', 'clip-docx', 'clip-pptx', 'clip-xlsx', 'clip-gh', 'clip-confluence']) {
    const src = readFileSync(join(SCRIPTS, `${name}.mjs`), 'utf8');
    assert.equal(src.split('declineGate(').length - 1, 1, `${name} asks the gate once`);
    assert.equal(src.split('gate.finish()').length - 1, 1, `${name} finishes the gate once`);
    assert.ok(src.indexOf('declineGate(') < src.indexOf('gate.finish()'), name);
    assert.ok(!src.includes('const declines = loadDeclines') || name === 'clip-docx', `${name} still checks the log by hand`);
    const tail = src.slice(src.indexOf('gate.finish()'));
    assert.match(tail.slice(0, 400), /status: 'clipped'/, `${name}: the gate is finished away from the clipped return`);
  }
});

test('the command line: an empty reason is refused with exit 2 and nothing is fetched', (t) => {
  const v = vault(t);
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'clip.mjs'), 'https://example.invalid/x', '--supersede-decline='], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--supersede-decline needs a reason/);
});
