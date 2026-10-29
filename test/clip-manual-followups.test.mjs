import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { main, classifyShortExtraction } from '../scripts/clip.mjs';
import { classifyInterstitial } from '../scripts/lib/interstitial.mjs';
import { runReclips } from '../scripts/lib/reclip.mjs';
import { disposeIssue, loadIssueLog, openIssues } from '../scripts/lib/triage.mjs';

// Two follow-ups to `clip.mjs <url> --from-file <path>`: (A) every line that sends a person to clip a refused page by
// hand names the route, and (B) the re-clip never replaces text a person supplied. Vaults are disposable directories
// and nothing is fetched: extraction is injected, and the browser rung is pointed at a path that does not exist.

const ROUTE = 'clip.mjs <url> --from-file <path>';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const LOGIN_SHELL = `#### Log in to ExampleSound
Don't have an account? Join now #### Problems logging in? Enter your email or username below and we'll send you a link to help you login into your account. #### Almost there! We've sent a verification link by email. Didn't receive the email? Check your Spam folder, it may have been caught by a filter. If you still don't see it, you can resend the verification email. #### Default title In our website we only use our own technical cookies for allowing you to access and use the platform (necessary cookies). Click here for more information about the cookie policy. Sign up to join the community, or log in with your account to continue.`;

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-manual-followups-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  mkdirSync(join(root, 'wiki', 'sources'), { recursive: true });
  const prior = { vault: process.env.WIKI_MASTER_VAULT, browser: process.env.WIKI_MASTER_BROWSER };
  process.env.WIKI_MASTER_VAULT = root;
  process.env.WIKI_MASTER_BROWSER = '/no/such/browser';
  t.after(() => {
    for (const [key, value] of [['WIKI_MASTER_VAULT', prior.vault], ['WIKI_MASTER_BROWSER', prior.browser]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const quiet = (fn) => {
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: fn(), lines }; } finally { console.log = log; console.error = err; }
};
const NO_FETCH = () => { throw new Error('fetchText must not be called: nothing is fetched'); };

// ---------------------------------------------------------------- Part A: the route is named
test('a login or age-gate page names the route to supply it from a signed-in browser', (t) => {
  vault(t);
  const { result, lines } = quiet(() => main(['https://sounds.example.org/people/someone/sounds/1234/'], { extract: () => ({ title: 'Heavy Machine Gun by Someone', contentMarkdown: LOGIN_SHELL }), fetchText: NO_FETCH }));
  assert.equal(result.status, 'thin');
  const line = lines.find((l) => /login, consent or age-gate page/.test(l));
  assert.ok(line, lines.join('\n'));
  assert.ok(line.includes(ROUTE), line);
  assert.match(line, /signed-in browser/);
  assert.match(line, /triage recorded, not declined\): https:\/\/sounds\.example\.org\//);
  assert.doesNotMatch(line, /clip manually/);
});

test('a thin page names the route and keeps the triage kind', (t) => {
  const root = vault(t);
  const { result, lines } = quiet(() => main(['https://spa.example.org/app'], { extract: () => ({ title: 'App', contentMarkdown: 'Please enable JavaScript to view this page.', content: '<div id="root"></div>', description: '' }), fetchText: NO_FETCH }));
  assert.equal(result.status, 'thin');
  const line = lines.find((l) => /^thin content \(/.test(l));
  assert.ok(line, lines.join('\n'));
  assert.ok(line.includes(ROUTE), line);
  assert.match(line, /signed-in browser/);
  assert.match(line, /triage recorded; not declined — browser render unavailable\): https:\/\/spa\.example\.org\/app$/);
  assert.doesNotMatch(line, /clip manually/);
  assert.deepEqual(openIssues(loadIssueLog(root)).map((r) => r.kind), ['thin']);
});

test('the wrong-node reason and the gate reason name the route', () => {
  const wrong = classifyShortExtraction({
    markdown: 'This Week at FDA: a short roundup of items.',
    rawHtml: '<div><p>This Week at FDA</p></div>',
    description: 'The agency issued comprehensive guidance describing mandatory manufacturing inspection requirements, laboratory certification procedures, and enforcement deadlines affecting pharmaceutical distributors nationwide.',
  });
  assert.equal(wrong.kind, 'wrong_node');
  assert.ok(wrong.reason.includes(ROUTE), wrong.reason);
  assert.doesNotMatch(wrong.reason, /clipping manually/);
  const gate = classifyInterstitial({ markdown: LOGIN_SHELL, title: 'Heavy Machine Gun by Someone' });
  assert.ok(gate.reason.includes(ROUTE), gate.reason);
  assert.match(gate.reason, /signed-in browser/);
  assert.doesNotMatch(gate.reason, /clip it manually/);
  assert.match(gate.reason, /^looks like a login, consent or age-gate page, not the page asked for \(/);
});

// ---------------------------------------------------------------- Part B: supplied text is protected from a re-clip
const URL_ = 'https://docs.example.test/guide/setup-guide';
const BODY = Array.from({ length: 60 }, (_, i) => `Section ${i} explains how the service handles request number ${i} and what a client should expect back.`).join('\n\n');
const clipping = (extraction) => `---\ntitle: "Setup guide"\nsource: "${URL_}"\ncreated: 2026-10-01\ntags: [clippings]\nquality: medium\n${extraction ? `extraction: ${extraction}\n` : ''}source-hash: ${sha(BODY)}\n---\n\n${BODY}\n`;
const readPageThrows = () => { throw new Error('readPage must not be called: nothing is fetched'); };
function reclipVault(t, extraction) {
  const root = vault(t);
  writeFileSync(join(root, 'raw', 'clippings', 'Setup guide.md'), clipping(extraction));
  disposeIssue(root, { url: URL_, kind: 'fidelity', disposition: 'reclip' });
  return root;
}

test('control: a fetched page with a re-clip request is a target of the dry run', async (t) => {
  const root = reclipVault(t, undefined);
  const report = await runReclips({ vaultPath: root, readPage: readPageThrows });
  assert.equal(report.selected, 1);
  assert.deepEqual(report.results.map((r) => r.status), ['planned']);
});

test('a clipping a person supplied is refused by the re-clip, with the way to refresh it, and the dry run lists it as refused', async (t) => {
  const root = reclipVault(t, 'manual');
  const before = readFileSync(join(root, 'raw', 'clippings', 'Setup guide.md'), 'utf8');
  const report = await runReclips({ vaultPath: root, readPage: readPageThrows });
  assert.equal(report.selected, 0, 'it is not a target');
  assert.deepEqual(report.results.filter((r) => r.status === 'planned'), []);
  assert.equal(report.refused.length, 1);
  assert.equal(report.refused[0].path, 'raw/clippings/Setup guide.md');
  assert.equal(report.refused[0].url, URL_);
  assert.match(report.refused[0].reason, /supplied by a person/);
  assert.ok(report.refused[0].reason.includes('clip.mjs <url> --from-file <path> --recapture'), report.refused[0].reason);
  assert.deepEqual(report.results.map((r) => r.status), ['refused']);
  assert.equal(readFileSync(join(root, 'raw', 'clippings', 'Setup guide.md'), 'utf8'), before);
});

test('applying never reads a page for a supplied clipping and leaves the file as it was', async (t) => {
  const root = reclipVault(t, 'manual');
  const file = join(root, 'raw', 'clippings', 'Setup guide.md');
  const before = readFileSync(file, 'utf8');
  const report = await runReclips({ vaultPath: root, apply: true, readPage: readPageThrows, obtain: readPageThrows });
  assert.equal(report.reclipped, 0);
  assert.deepEqual(report.failed, []);
  assert.equal(report.refused.length, 1);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('an explicit target and an explicit kind are refused too', async (t) => {
  const root = reclipVault(t, 'manual');
  for (const kind of ['auto', 'html', 'pdf']) {
    const report = await runReclips({ vaultPath: root, apply: true, targets: ['raw/clippings/Setup guide.md'], kind, readPage: readPageThrows, obtain: readPageThrows });
    assert.equal(report.refused.length, 1, kind);
    assert.equal(report.selected, 0, kind);
  }
});
