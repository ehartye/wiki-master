import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/clip.mjs';
import { classifyInterstitial } from '../scripts/lib/interstitial.mjs';
import { readPageForReclip } from '../scripts/lib/reclip-html.mjs';
import { openIssues, loadIssueLog } from '../scripts/lib/triage.mjs';
import { loadDeclines } from '../scripts/lib/decline.mjs';

// A page that is the gate and not the page: a login form, a consent wall, an age check. It has words enough to clear
// the thin floor, so it was filed as the source it stood in for, and two different URLs even shared one body. The
// signal is the gate's own vocabulary, dense, with none of the page's title in the text. Measured on the 5,886 HTML
// clippings of one vault: the three known shells were the only pages with at least 3 such phrases per 100 words (5.4
// to 6.4), and all three had none of their title words in the body; the next highest page had 2.86 and its title in full.

const LOGIN_SHELL = `#### Log in to ExampleSound
Don't have an account? Join now #### Problems logging in? Enter your email or username below and we'll send you a link to help you login into your account. #### Almost there! We've sent a verification link by email. Didn't receive the email? Check your Spam folder, it may have been caught by a filter. If you still don't see it, you can resend the verification email. #### Default title In our website we only use our own technical cookies for allowing you to access and use the platform (necessary cookies). Click here for more information about the cookie policy. Sign up to join the community, or log in with your account to continue.`;
const AGE_GATE = `## This game may contain content not appropriate for all ages, or may not be appropriate for viewing at work.
The developers describe the content like this: "This game features violence and bad language." Please enter your birth date to continue: Cancel ## Hey, would you like to hide this kind of warning in the future? Sign in Sign in to the store and set your preferences so we know what kind of products to warn you about or hide from your store. Or sign up and join for free. This data is for verification purposes only and will not be stored. Your preferences are configured to warn you about this kind of mature content. Edit Preferences`;
const ARTICLE = 'The telescope array measures faint radio sources across the southern sky, and the survey team compares each night of data against a catalog of known objects before releasing results to the wider community of astronomers. '.repeat(8);

test('a login shell whose title is nowhere in the body is a shell', () => {
  const r = classifyInterstitial({ markdown: LOGIN_SHELL, title: 'Heavy Machine Gun by Someone' });
  assert.ok(r, 'flagged');
  assert.ok(r.hits >= 5 && r.per100 >= 3 && r.titleShare < 0.5, JSON.stringify(r));
  assert.match(r.reason, /login|sign-in|gate/i);
});

test('an age gate whose title is nowhere in the body is a shell', () => {
  assert.ok(classifyInterstitial({ markdown: AGE_GATE, title: 'The Ascent' }));
});

test('the same words on a page that is about them (its title is in the text) are not a shell', () => {
  assert.equal(classifyInterstitial({ markdown: LOGIN_SHELL, title: 'Log in to ExampleSound' }), null);
});

test('a page with no distinctive title words cannot be judged, so it is not flagged', () => {
  assert.equal(classifyInterstitial({ markdown: LOGIN_SHELL, title: 'Home' }), null);
  assert.equal(classifyInterstitial({ markdown: LOGIN_SHELL, title: '' }), null);
});

test('a few gate phrases inside a long article are not a shell', () => {
  const long = `${ARTICLE} ${ARTICLE} ${ARTICLE} ${ARTICLE} ${ARTICLE} Readers can sign in or log in to save progress, and may create an account later. ${ARTICLE} ${ARTICLE} ${ARTICLE} ${ARTICLE} Sign up to the newsletter. Accept cookies if you wish.`;
  assert.equal(classifyInterstitial({ markdown: long, title: 'Radio survey of the southern sky' }), null);
});

test('gate phrases scattered through a long text are not a shell, even when the title is not in it', () => {
  const long = `${ARTICLE.repeat(6)} Readers can sign in or log in to save progress, and may create an account later. ${ARTICLE.repeat(6)} Sign up to the newsletter. Accept cookies if you wish. ${ARTICLE.repeat(4)}`;
  const r = classifyInterstitial({ markdown: long, title: 'Completely different heading about gardening' });
  assert.equal(r, null, 'six or more phrases in about 1,000 words is under one per hundred');
});

test('four gate phrases are below the floor even when dense', () => {
  const four = 'Log in. Sign in. Sign up. Forgot password. Some other short words here to pad the text a little more.';
  assert.equal(classifyInterstitial({ markdown: four, title: 'Quarterly telescope budget' }), null);
});

test('an authentication guide that discusses signing in is not a shell', () => {
  const guide = `# Authentication guide\n\nThis guide explains how authentication works. ${ARTICLE} To sign in, send the password to the endpoint; to log in with a token, use the header. ${ARTICLE} Sign up for an account in the dashboard. ${ARTICLE}`;
  assert.equal(classifyInterstitial({ markdown: guide, title: 'Authentication guide' }), null);
});

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-interstitial-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  return { root, files: () => readdirSync(join(root, 'raw', 'clippings')), rows: () => openIssues(loadIssueLog(root)) };
}
const quiet = (fn) => { const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = log; console.error = err; } };
const clip = (url, data) => quiet(() => main([url], { extract: () => data }));

test('a login shell is not clipped; a triage row says why, and the URL is not declined', (t) => {
  const v = vault(t);
  const url = 'https://sounds.example.org/people/someone/sounds/1234/';
  const r = clip(url, { title: 'Heavy Machine Gun by Someone', contentMarkdown: LOGIN_SHELL });
  assert.equal(r.status, 'thin');
  assert.match(r.reason, /login|sign-in|gate/i);
  assert.deepEqual(v.files(), [], 'nothing was written');
  assert.equal(v.rows().length, 1);
  assert.equal(v.rows()[0].kind, 'wrong-node');
  assert.equal(v.rows()[0].url, url);
  assert.deepEqual(loadDeclines(v.root), [], 'a login wall is transient, so it is not declined for 180 days');
});

test('an age gate is not clipped either', (t) => {
  const v = vault(t);
  const r = clip('https://store.example.org/app/42/Game/', { title: 'The Ascent', contentMarkdown: AGE_GATE });
  assert.equal(r.status, 'thin');
  assert.deepEqual(v.files(), []);
});

test('a real article of the same length is clipped as before', (t) => {
  const v = vault(t);
  const r = clip('https://example.org/survey', { title: 'Radio survey of the southern sky', contentMarkdown: ARTICLE });
  assert.equal(r.status, 'clipped');
  assert.equal(v.files().length, 1);
  assert.deepEqual(v.rows(), []);
});

test('a short real page (a man page of 130 words with headings) is still clipped', (t) => {
  const v = vault(t);
  const short = '## Name\n\nxr_hand_tracking - enables hand tracking for a session\n\n## Synopsis\n\nThe extension adds a hand tracker that reports the pose of each joint of a hand relative to a base space, with a radius for every joint and a flag that says whether the pose is valid. '.repeat(3) + '\n\n## Description\n\nA runtime reports poses only while the hand is tracked.';
  const r = clip('https://registry.example.org/man/xr_hand_tracking', { title: 'xr_hand_tracking', contentMarkdown: short });
  assert.equal(r.status, 'clipped');
  assert.equal(v.files().length, 1);
});

test('re-clipping a page through the repair route refuses a page that has become a gate', async () => {
  await assert.rejects(readPageForReclip('https://sounds.example.org/people/someone/sounds/1234/', { extract: () => ({ title: 'Heavy Machine Gun by Someone', contentMarkdown: LOGIN_SHELL }) }), /login|sign-in|gate/i);
  const clip2 = await readPageForReclip('https://example.org/survey', { extract: () => ({ title: 'Radio survey of the southern sky', contentMarkdown: ARTICLE, fidelityWarnings: [], fidelityAssessment: { checked: 1, ignored: [] } }) });
  assert.equal(clip2.fidelity, 'high');
});
