import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { main as clipMain } from '../scripts/clip.mjs';
import { scanClippings } from '../scripts/triage.mjs';
import { buildTopicIndex, attributeItem } from '../scripts/lib/topic.mjs';
import { disposeIssue, openIssues, loadIssueLog } from '../scripts/lib/triage.mjs';
import { runReclips } from '../scripts/lib/reclip.mjs';

// The three capture routes together, over one disposable vault and no network: a page is clipped, recaptured when it
// changes, supplied by file when a gate stops the clipper, and a decline on a page is superseded from the command line;
// known-urls.mjs answers for every URL along the way. The older clipping of the page is compared byte for byte after every
// step, and the read-only commands are compared against a snapshot of every file in the vault.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const URL_A = 'https://docs.example.test/guide/setup';
const URL_GATE = 'https://sounds.example.org/people/someone/sounds/heavy-machine-gun';
const URL_PAGE = 'https://docs.example.test/guide/saved-page';
const URL_DECLINED = 'https://docs.example.test/guide/off-topic';
const URL_NEW = 'https://docs.example.test/guide/never-seen';
const sentence = (s) => `${s} is described here in enough plain words that the page counts as real content. `;
const text = (s) => sentence(s).repeat(30);
// A login form long enough to clear the thin floor, none of the page title in it (the same shape test/interstitial.test.mjs uses).
const LOGIN_SHELL = `#### Log in to ExampleSound
Don't have an account? Join now #### Problems logging in? Enter your email or username below and we'll send you a link to help you login into your account. #### Almost there! We've sent a verification link by email. Didn't receive the email? Check your Spam folder, it may have been caught by a filter. If you still don't see it, you can resend the verification email. #### Default title In our website we only use our own technical cookies for allowing you to access and use the platform (necessary cookies). Click here for more information about the cookie policy. Sign up to join the community, or log in with your account to continue.`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const day = (d) => ({ today: () => d });
const field = (md, name) => (md.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1];
const page = (title, body) => () => ({ title, contentMarkdown: body });

// Nothing may be fetched, and nothing may be extracted unless a test says it will be.
const NO_FETCH = () => { throw new Error('fetchText must not be called: nothing is fetched'); };
const NO_EXTRACT = () => { throw new Error('extract must not be called for supplied text'); };

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-routes-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const supplied = mkdtempSync(join(tmpdir(), 'wm-routes-supplied-'));
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => {
    if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior;
    rmSync(root, { recursive: true, force: true });
    rmSync(supplied, { recursive: true, force: true });
  });
  const dir = join(root, 'raw', 'clippings');
  return {
    root, dir,
    save: (name, content) => { const p = join(supplied, name); writeFileSync(p, content); return p; },
    files: () => readdirSync(dir).sort(),
    read: (name) => readFileSync(join(dir, name), 'utf8'),
    issues: () => openIssues(loadIssueLog(root)),
    // every file under the vault with its bytes: "writes nothing" and "writes only the decline file" are checked, not assumed
    snapshot: () => {
      const out = new Map();
      const walk = (d) => {
        for (const name of readdirSync(d)) {
          const full = join(d, name);
          if (statSync(full).isDirectory()) walk(full);
          else out.set(full.slice(root.length).split(sep).join('/'), readFileSync(full).toString('base64'));
        }
      };
      walk(root);
      return out;
    },
  };
}
const changed = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();

// Runs clip.mjs main with console output captured; returns the result, the printed lines and the exit code it set.
function clip(argv, deps) {
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  const code = process.exitCode;
  process.exitCode = undefined;
  try { const result = clipMain(argv, deps); return { result, lines, exitCode: process.exitCode }; }
  finally { console.log = log; console.error = err; process.exitCode = code; }
}
const fromFile = (url, path, extra = [], deps = {}) => clip([url, '--from-file', path, ...extra], { fetchText: NO_FETCH, extract: NO_EXTRACT, ...deps });

// The two commands are run as the real scripts, in their own process, against the disposable vault and a throwaway home.
function command(v, script, ...args) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, WIKI_MASTER_VAULT: v.root, HOME: v.root, USERPROFILE: v.root, WIKI_MASTER_BROWSER: '/no/such/browser' },
  });
  return { status: r.status, out: r.stdout.split('\n').filter(Boolean), err: r.stderr };
}

test('clip, recapture, supply a gate page by file, supersede a decline, check candidates: the older clipping is never touched', async (t) => {
  const v = setup(t);

  // ---- 1. a page is clipped
  const first = clip([URL_A, '--topic=Old topic'], { extract: page('Setup guide', text('The first text')), fetchText: NO_FETCH, ...day('2026-10-01') });
  assert.equal(first.result.status, 'clipped', first.lines.join('\n'));
  assert.deepEqual(v.files(), ['Setup guide.md']);
  const OLDER = v.read('Setup guide.md');
  assert.equal(field(OLDER, 'source'), JSON.stringify(URL_A));
  assert.equal(field(OLDER, 'recapture-of'), undefined);
  assert.equal(field(OLDER, 'extraction'), undefined);
  const olderIsUntouched = (step) => assert.equal(v.read('Setup guide.md'), OLDER, `the older clipping is byte-identical after ${step}`);

  // ---- 2. a plain second clip is a duplicate, even with different text
  let before = v.snapshot();
  const dup = clip([URL_A], { extract: page('Setup guide', text('A different text')), fetchText: NO_FETCH, ...day('2026-10-02') });
  assert.equal(dup.result.status, 'duplicate');
  assert.deepEqual(dup.lines, [`duplicate (already clipped): ${URL_A}`]);
  assert.deepEqual(changed(before, v.snapshot()), [], 'a duplicate writes nothing');

  // ---- 3. known-urls before the recapture
  assert.deepEqual(command(v, 'known-urls.mjs', '--count').out, ['1']);
  assert.deepEqual(command(v, 'known-urls.mjs', '--check', URL_A, URL_NEW).out, ['clipped raw/clippings/Setup guide.md', 'new']);

  // ---- 4. a recapture with different text is a dated second clipping beside the first
  const recap = clip([URL_A, '--recapture', '--topic=New topic'], { extract: page('Setup guide', text('A different text')), fetchText: NO_FETCH, ...day('2026-10-29') });
  assert.equal(recap.result.status, 'clipped', recap.lines.join('\n'));
  const SECOND = 'Setup guide (recaptured 2026-10-29).md';
  assert.deepEqual(v.files(), [SECOND, 'Setup guide.md']);
  const second = v.read(SECOND);
  assert.equal(field(second, 'source'), JSON.stringify(URL_A));
  assert.equal(field(second, 'title'), JSON.stringify('Setup guide (recaptured 2026-10-29)'));
  assert.equal(field(second, 'created'), '2026-10-29');
  assert.equal(field(second, 'recapture-of'), JSON.stringify('raw/clippings/Setup guide.md'));
  assert.equal(field(second, 'source-hash'), sha(text('A different text')));
  assert.notEqual(field(second, 'source-hash'), field(OLDER, 'source-hash'));
  olderIsUntouched('the recapture');

  // ---- 5. the same text again is unchanged and writes nothing
  before = v.snapshot();
  const same = clip([URL_A, '--recapture'], { extract: page('Setup guide', text('A different text')), fetchText: NO_FETCH, ...day('2026-11-02') });
  assert.equal(same.result.status, 'unchanged');
  assert.deepEqual(same.lines, ['unchanged (same text as raw/clippings/Setup guide (recaptured 2026-10-29).md); nothing written']);
  assert.deepEqual(changed(before, v.snapshot()), [], 'an unchanged recapture writes nothing');
  olderIsUntouched('an unchanged recapture');

  // ---- 6. known-urls counts the recapture; the consumers read the newest capture
  assert.deepEqual(command(v, 'known-urls.mjs', '--check', URL_A).out, ['clipped raw/clippings/Setup guide.md (+1 recapture)']);
  assert.deepEqual(command(v, 'known-urls.mjs', '--count').out, ['1'], 'two captures of one page are one known URL');
  const index = buildTopicIndex(scanClippings(v.root).topics);
  assert.equal(attributeItem({ url: URL_A }, index), 'New topic', 'the topic index takes the newest capture');
  disposeIssue(v.root, { url: URL_A, kind: 'fidelity', disposition: 'reclip' });
  const reclips = await runReclips({ vaultPath: v.root });
  assert.equal(reclips.selected, 1, 'a re-clip request selects one capture');
  assert.deepEqual(reclips.results.map((r) => r.path), [`raw/clippings/${SECOND}`], 'the newest capture, not the older evidence');
  olderIsUntouched('the consumers');

  // ---- 7. a gate stops the clipper; the person saves the page and supplies it by file
  const gated = clip([URL_GATE, '--topic=Gate topic'], { extract: page('Heavy Machine Gun by Someone', LOGIN_SHELL), fetchText: NO_FETCH, ...day('2026-10-29') });
  assert.equal(gated.result.status, 'thin');
  assert.deepEqual(v.issues().filter((r) => r.url === URL_GATE).map((r) => r.kind), ['wrong-node']);
  assert.ok(!v.files().some((f) => /heavy/i.test(f)), 'the gate page is not written');
  // a login form supplied as a file is still the gate: no override exists
  before = v.snapshot();
  const loginFile = fromFile(URL_GATE, v.save('login.md', LOGIN_SHELL), ['--override-decline'], day('2026-10-29'));
  assert.equal(loginFile.result.status, 'thin');
  assert.deepEqual(v.files().length, 2, 'a supplied login form is not written');
  // a short file is thin
  const shortFile = fromFile(URL_GATE, v.save('short.md', 'Only a few words here.'), [], day('2026-10-29'));
  assert.equal(shortFile.result.status, 'thin');
  assert.equal(v.files().length, 2);
  // a binary file and a file over 1 MiB are queued as attention
  const binary = fromFile(URL_GATE, v.save('model.md', Buffer.concat([Buffer.from(text('Looks like text')), Buffer.from([0, 1, 2, 0])])), [], day('2026-10-29'));
  assert.equal(binary.result.status, 'thin');
  assert.match(binary.result.reason, /binary/);
  assert.match(v.issues().find((r) => r.url === URL_GATE && r.kind === 'attention').reason, /binary/);
  const big = fromFile(URL_GATE, v.save('big.md', Buffer.alloc(1024 * 1024 + 1, 97)), [], day('2026-10-29'));
  assert.equal(big.result.status, 'thin');
  assert.match(big.result.reason, /larger/);
  assert.match(v.issues().find((r) => r.url === URL_GATE && r.kind === 'attention').reason, /larger/, 'the oversized file is queued as attention');
  assert.equal(v.files().length, 2, 'no refused file is written');
  // a missing file exits 2
  const missing = fromFile(URL_GATE, join(v.root, 'no-such-page.md'), [], day('2026-10-29'));
  assert.equal(missing.exitCode, 2);
  assert.equal(v.files().length, 2);
  void before;

  // the page itself, supplied as text: fetch and extractor throw if called
  const pageText = `# Heavy Machine Gun\n\n${text('The saved gate page')}\n`;
  const pageFile = v.save('heavy.md', pageText);
  const supplied = fromFile(URL_GATE, pageFile, ['--topic=Gate topic'], day('2026-10-29'));
  assert.equal(supplied.result.status, 'clipped', supplied.lines.join('\n'));
  const gateName = `${supplied.result.slug}.md`;
  const gateMd = v.read(gateName);
  assert.equal(field(gateMd, 'source'), JSON.stringify(URL_GATE));
  assert.equal(field(gateMd, 'extraction'), 'manual');
  assert.equal(field(gateMd, 'supplied-sha256'), sha(pageText), 'the hash of the supplied bytes');
  assert.equal(field(gateMd, 'source-hash'), sha(pageText.trimEnd()), 'the hash of the stored text');
  assert.ok(gateMd.endsWith(`\n\n${pageText.trimEnd()}\n`), 'a text file is the page text, unchanged');
  assert.deepEqual(v.issues().filter((r) => r.url === URL_GATE && r.kind === 'wrong-node'), [], 'the gate row described a source that is now on disk');
  olderIsUntouched('the supplied page');

  // supplied again: a duplicate without --recapture, a dated recapture with it; the first supplied page is never edited
  const gateBytes = v.read(gateName);
  const gateDup = fromFile(URL_GATE, pageFile, [], day('2026-11-01'));
  assert.equal(gateDup.result.status, 'duplicate');
  const newer = `# Heavy Machine Gun\n\n${text('The saved gate page, saved again')}\n`;
  const gateRecap = fromFile(URL_GATE, v.save('heavy-again.md', newer), ['--recapture', '--topic=Gate topic'], day('2026-11-01'));
  assert.equal(gateRecap.result.status, 'clipped', gateRecap.lines.join('\n'));
  assert.equal(gateRecap.result.slug, `${supplied.result.slug} (recaptured 2026-11-01)`);
  const gateRecapMd = v.read(`${gateRecap.result.slug}.md`);
  assert.equal(field(gateRecapMd, 'recapture-of'), JSON.stringify(`raw/clippings/${gateName}`));
  assert.equal(field(gateRecapMd, 'supplied-sha256'), sha(newer));
  assert.equal(v.read(gateName), gateBytes, 'the first supplied page is never edited');
  olderIsUntouched('the second supplied page');

  // an HTML file goes through the extractor, run on the local file, with the URL as the page address
  const html = `<html><head><title>Saved page</title></head><body><article>${text('The saved page')}</article></body></html>\n`;
  const htmlPath = v.save('saved.html', html);
  const calls = [];
  const extract = (source, options) => { calls.push({ source, options }); return { title: 'Saved page', contentMarkdown: text('The extracted page') }; };
  const viaHtml = fromFile(URL_PAGE, htmlPath, [], { extract, ...day('2026-10-29') });
  assert.equal(viaHtml.result.status, 'clipped', viaHtml.lines.join('\n'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, resolve(htmlPath));
  assert.equal(calls[0].options.sourceUrl, URL_PAGE);
  const htmlMd = v.read(`${viaHtml.result.slug}.md`);
  assert.equal(field(htmlMd, 'extraction'), 'manual');
  assert.equal(field(htmlMd, 'supplied-sha256'), sha(html));
  assert.equal(field(htmlMd, 'source-hash'), sha(text('The extracted page')));

  // ---- 8. a decline is superseded from the command line, then the page is supplied by file
  const declined = clip([URL_DECLINED, '--decline=off-topic for now'], { extract: NO_EXTRACT, fetchText: NO_FETCH });
  assert.equal(declined.result.status, 'declined');
  assert.deepEqual(command(v, 'known-urls.mjs', '--check', URL_DECLINED).out, ['declined: off-topic for now']);
  const offTopic = v.save('off-topic.md', `# Off topic guide\n\n${text('The off topic page')}`);
  before = v.snapshot();
  const blocked = fromFile(URL_DECLINED, offTopic, [], day('2026-10-29'));
  assert.equal(blocked.result.status, 'declined');
  assert.deepEqual(changed(before, v.snapshot()), [], 'a declined URL writes nothing');
  const listed = command(v, 'decline.mjs', 'list', '--json');
  assert.equal(listed.status, 0);
  assert.equal(JSON.parse(listed.out.join('\n')).find((e) => e.url === URL_DECLINED).active, true);
  assert.equal(command(v, 'decline.mjs', 'show', URL_DECLINED).status, 0);
  assert.equal(command(v, 'decline.mjs', 'show', URL_NEW).status, 1);

  // supersede with no active decline: exit 1 and not one byte changes
  before = v.snapshot();
  const none = command(v, 'decline.mjs', 'supersede', URL_NEW, '--reason', 'there is none');
  assert.equal(none.status, 1);
  assert.deepEqual(changed(before, v.snapshot()), [], 'supersede with no active decline writes nothing');

  // supersede an active decline: exit 0, and only the decline file changes
  before = v.snapshot();
  const done = command(v, 'decline.mjs', 'supersede', URL_DECLINED, '--reason', 'the page is wanted after all');
  assert.equal(done.status, 0, done.err);
  assert.deepEqual(done.out, ['superseded']);
  assert.deepEqual(changed(before, v.snapshot()), ['/.wiki-master/declined.json'], 'supersede writes only the decline file');
  const entry = JSON.parse(command(v, 'decline.mjs', 'list', '--json').out.join('\n')).find((e) => e.url === URL_DECLINED);
  assert.equal(entry.active, false);
  assert.equal(entry.superseded.reason, 'the page is wanted after all');
  assert.deepEqual(command(v, 'known-urls.mjs', '--check', URL_DECLINED).out, ['new'], 'a superseded decline no longer blocks');
  const lifted = fromFile(URL_DECLINED, offTopic, ['--topic=Gate topic'], day('2026-10-29'));
  assert.equal(lifted.result.status, 'clipped', lifted.lines.join('\n'));
  olderIsUntouched('the decline');

  // ---- 9. the read-only commands change nothing
  before = v.snapshot();
  const summary = command(v, 'known-urls.mjs', '--summary', '--topic=New topic');
  assert.equal(summary.status, 0, summary.err);
  assert.ok(summary.out.includes('clipped: 1'), summary.out.join('\n'));
  assert.ok(summary.out.includes('quality medium: 1'), summary.out.join('\n'));
  assert.ok(summary.out.includes('Declines are not recorded per topic.'));
  const oldTopic = command(v, 'known-urls.mjs', '--summary', '--topic=Old topic');
  assert.ok(oldTopic.out.includes('clipped: 0'), 'a page counts once, under the topic of its newest capture');
  const gateTopic = command(v, 'known-urls.mjs', '--summary', '--topic=Gate topic');
  assert.ok(gateTopic.out.includes('clipped: 2'), gateTopic.out.join('\n'));
  command(v, 'known-urls.mjs');
  command(v, 'known-urls.mjs', '--count');
  command(v, 'known-urls.mjs', '--check', URL_A, URL_GATE, URL_DECLINED, URL_NEW);
  command(v, 'decline.mjs', 'list');
  command(v, 'decline.mjs', 'show', URL_DECLINED);
  assert.deepEqual(changed(before, v.snapshot()), [], 'known-urls.mjs and the decline listings are read-only');

  // ---- 10. the end state
  assert.deepEqual(command(v, 'known-urls.mjs', '--count').out, ['4']);
  assert.deepEqual(
    command(v, 'known-urls.mjs', '--check', URL_A, URL_GATE, URL_NEW).out,
    ['clipped raw/clippings/Setup guide.md (+1 recapture)', `clipped raw/clippings/${gateName} (+1 recapture)`, 'new'],
  );
  olderIsUntouched('everything');
});

test('a page recaptured on the day it was first clipped is still read as the newest capture by every consumer', async (t) => {
  const v = setup(t);
  const same = day('2026-10-29');
  assert.equal(clip([URL_A, '--topic=Old topic'], { extract: page('Setup guide', text('Morning text')), fetchText: NO_FETCH, ...same }).result.status, 'clipped');
  const OLDER = v.read('Setup guide.md');
  const recap = clip([URL_A, '--recapture', '--topic=New topic'], { extract: page('Setup guide', text('Afternoon text')), fetchText: NO_FETCH, ...same });
  assert.equal(recap.result.status, 'clipped', recap.lines.join('\n'));
  const SECOND = 'Setup guide (recaptured 2026-10-29).md';
  assert.deepEqual(v.files(), [SECOND, 'Setup guide.md']);
  assert.equal(field(v.read(SECOND), 'recapture-of'), JSON.stringify('raw/clippings/Setup guide.md'));
  // a third capture the same day names the second, so the chain reads in order even when every date is the same
  const third = clip([URL_A, '--recapture', '--slug=Setup guide (recaptured 2026-10-29, evening)', '--topic=Newest topic'], { extract: page('Setup guide', text('Evening text')), fetchText: NO_FETCH, ...same });
  assert.equal(third.result.status, 'clipped', third.lines.join('\n'));
  assert.equal(field(v.read('Setup guide (recaptured 2026-10-29, evening).md'), 'recapture-of'), JSON.stringify(`raw/clippings/${SECOND}`));
  assert.equal(v.read('Setup guide.md'), OLDER, 'the older clipping is byte-identical');

  const index = buildTopicIndex(scanClippings(v.root).topics);
  assert.equal(attributeItem({ url: URL_A }, index), 'Newest topic');
  disposeIssue(v.root, { url: URL_A, kind: 'fidelity', disposition: 'reclip' });
  const reclips = await runReclips({ vaultPath: v.root });
  assert.deepEqual(reclips.results.map((r) => r.path), ['raw/clippings/Setup guide (recaptured 2026-10-29, evening).md']);
  assert.ok(command(v, 'known-urls.mjs', '--summary', '--topic=Newest topic').out.includes('clipped: 1'));
  assert.ok(command(v, 'known-urls.mjs', '--summary', '--topic=Old topic').out.includes('clipped: 0'));
  assert.ok(command(v, 'known-urls.mjs', '--summary', '--topic=New topic').out.includes('clipped: 0'));
});

// A stand-in for the node that the render rung starts: it records that it was started and says the rung is unavailable, so
// a render attempt is observable without a browser and without the network.
function renderSpy(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-routes-spy-'));
  const marker = join(dir, 'started.txt');
  const windows = process.platform === 'win32';
  const unavailable = '{"unavailable":true,"error":"render stand-in"}';
  writeFileSync(join(dir, windows ? 'node.cmd' : 'node'), windows
    ? `@echo off\r\necho started>> "${marker}"\r\necho ${unavailable} 1>&2\r\nexit /b 3\r\n`
    : `#!/bin/sh\necho started >> '${marker}'\necho '${unavailable}' >&2\nexit 3\n`, { mode: 0o755 });
  const prior = process.env.PATH;
  process.env.PATH = `${dir}${windows ? ';' : ':'}${prior}`;
  t.after(() => { process.env.PATH = prior; rmSync(dir, { recursive: true, force: true }); });
  return { started: () => { try { return readFileSync(marker, 'utf8').trim().split(/\s+/).length; } catch { return 0; } } };
}

test('a supplied page is stored as it was saved and is never fetched or rendered, even when it is thin', (t) => {
  const v = setup(t);
  const spy = renderSpy(t);
  // control: a thin page that was fetched does start the render rung, so the stand-in can tell
  const fetched = clip(['https://docs.example.test/guide/thin-fetched'], { extract: page('Thin', 'A few words only.'), fetchText: NO_FETCH, ...day('2026-10-29') });
  assert.equal(fetched.result.status, 'thin');
  assert.equal(spy.started(), 1, 'the render rung runs for a thin fetched page');
  // a thin supplied file is refused without a render
  const thin = fromFile(URL_PAGE, v.save('thin.md', 'A few words only.'), [], day('2026-10-29'));
  assert.equal(thin.result.status, 'thin');
  assert.equal(spy.started(), 1, 'a thin supplied file is not rendered');
  assert.deepEqual(v.files(), []);

  // a Wayback header and blank lines at the top of a saved text are the saved text: nothing is stripped or trimmed
  const saved = `\n\nThe Wayback Machine - https://web.archive.org/web/2020/${URL_PAGE}\n\n# Saved heading\n\n${text('The archived text')}\n`;
  const r = fromFile(URL_PAGE, v.save('archived.md', saved), [], day('2026-10-29'));
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  const md = v.read(`${r.result.slug}.md`);
  assert.ok(md.endsWith(`\n\n${saved.trimEnd()}\n`), 'the saved text is stored unchanged');
  assert.equal(field(md, 'source-hash'), sha(saved.trimEnd()));
  assert.equal(field(md, 'supplied-sha256'), sha(saved));
  assert.equal(spy.started(), 1);
});

test('two unlinked clippings of one page: the topic index and the summary take the later created one, whatever the file names', (t) => {
  const v = setup(t);
  const hand = (name, created, topic) => writeFileSync(join(v.dir, name), `---\ntitle: ${JSON.stringify(name)}\nsource: ${JSON.stringify(URL_A)}\ncreated: ${created}\ntopic: ${JSON.stringify(topic)}\nquality: medium\nsource-hash: ${sha(name)}\n---\n\n${text(name)}\n`);
  hand('Zed.md', '2026-01-01', 'Earlier topic');
  hand('Alpha.md', '2026-02-02', 'Later topic');
  const index = buildTopicIndex(scanClippings(v.root).topics);
  assert.equal(attributeItem({ url: URL_A }, index), 'Later topic', 'the later created capture wins over the later file name');
  assert.ok(command(v, 'known-urls.mjs', '--summary', '--topic=Later topic').out.includes('clipped: 1'));
  assert.ok(command(v, 'known-urls.mjs', '--summary', '--topic=Earlier topic').out.includes('clipped: 0'));
});
