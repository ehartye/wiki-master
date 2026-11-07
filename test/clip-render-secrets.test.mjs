import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, renderAttempt } from '../scripts/clip.mjs';
import { classifyRenderOutcome } from '../scripts/lib/render.mjs';
import { redactReasonText } from '../scripts/lib/url-safety.mjs';

// A page can redirect to an address that carries a secret. The address reaches the clipper from the page, so it must not reach a
// reason, a printed line, the synced triage log, declined.json or the ledger as it came.

const SECRET = 'SECRETPW99';
const PAGE = 'https://docs.example.test/app/page';
const LEAK = `https://example.test/next?access_token=${SECRET}`;
const THIN = { title: 'App page', contentMarkdown: 'Please enable JavaScript to view this page.' };
const NO_TWIN = () => ({ ok: false, reason: 'status 404' });

test('a redirect to an address with a secret names the address without it, in both redirect verdicts', () => {
  const moved = classifyRenderOutcome({ requestedUrl: PAGE, finalUrl: LEAK, status: 200, title: 'Next', words: 500 });
  assert.equal(moved.ok, false);
  assert.ok(!moved.reason.includes(SECRET), moved.reason);
  assert.match(moved.reason, /\(https:\/\/example\.test\/next\?access_token=redacted\)/);
  const errorPage = classifyRenderOutcome({ requestedUrl: PAGE, finalUrl: `https://example.test/login?token=${SECRET}`, status: 200, title: 'Sign in', words: 40 });
  assert.equal(errorPage.ok, false);
  assert.ok(!errorPage.reason.includes(SECRET), errorPage.reason);
  assert.match(errorPage.reason, /\(https:\/\/example\.test\/login\?token=redacted\)/);
});

test('a redirect to an address with a secret in a username, password or fragment is named without it', () => {
  for (const finalUrl of [`https://reader:${SECRET}@example.test/next`, `https://example.test/next#access_token=${SECRET}&state=1`]) {
    const { reason } = classifyRenderOutcome({ requestedUrl: PAGE, finalUrl, status: 200, title: 'Next', words: 500 });
    assert.ok(!reason.includes(SECRET), reason);
    assert.match(reason, /https:\/\/example\.test\/next/);
  }
});

test('a plain redirect is reported exactly as before', () => {
  for (const finalUrl of ['https://example.test/next', 'https://example.test/next?page=2&lang=en#top', 'https://example.test']) {
    const { reason } = classifyRenderOutcome({ requestedUrl: PAGE, finalUrl, status: 200, title: 'Next', words: 500 });
    assert.equal(reason, `redirect landed on a different page (${finalUrl}) — the requested page has moved or been retired`);
  }
});

test('the render rung returns no secret from a redirect, or from a failure that quotes one', () => {
  const meta = JSON.stringify({ htmlFile: 'x.html', finalUrl: LEAK, status: 200, title: 'Next', words: 500 });
  const moved = renderAttempt(PAGE, { run: () => meta });
  assert.equal(moved.ok, false);
  assert.ok(!JSON.stringify(moved).includes(SECRET), moved.reason);
  const quoted = `net::ERR_TOO_MANY_REDIRECTS at ${LEAK}.`;
  const failure = (stderr) => Object.assign(new Error('Command failed'), { status: 1, stderr });
  const failed = renderAttempt(PAGE, { run: () => { throw failure(JSON.stringify({ unavailable: false, error: quoted })); } });
  assert.ok(!JSON.stringify(failed).includes(SECRET), failed.reason);
  assert.match(failed.reason, /ERR_TOO_MANY_REDIRECTS at https:\/\/example\.test\/next\?access_token=redacted\.$/);
});

test('redactReasonText changes only an address that carries a secret', () => {
  assert.equal(redactReasonText('see https://example.test and https://example.test/a?b=1.'), 'see https://example.test and https://example.test/a?b=1.');
  assert.equal(redactReasonText(`moved (${LEAK}), then gone`), 'moved (https://example.test/next?access_token=redacted), then gone');
  assert.equal(redactReasonText('no address here'), 'no address here');
});

// ---------------------------------------------------------------- through main: what is printed and what is stored
function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-render-secrets-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const ledger = join(root, 'ledger.jsonl');
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  return { ledger, stored: () => [read(join(root, '.wiki-master', 'triage.jsonl')), read(join(root, '.wiki-master', 'declined.json')), read(ledger)].join('\n') };
}

function clip(argv, deps) {
  const lines = [];
  const log = console.log, err = console.error, code = process.exitCode;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: main(argv, { fetchTwin: NO_TWIN, sleep: () => {}, runtimeAvailable: () => true, ...deps }), lines }; }
  finally { console.log = log; console.error = err; process.exitCode = code; }
}

const MOVED = (finalUrl) => `redirect landed on a different page (${finalUrl}) — the requested page has moved or been retired`;
const moved = (finalUrl) => () => ({ ok: false, kind: 'failed', reason: MOVED(finalUrl) });

test('a render that failed on a redirect to a secret address leaves it in no line, row, decline or ledger row', (t) => {
  for (const [name, argv, extract] of [
    ['the thin path', [PAGE], () => THIN],
    ['the failed static read', [PAGE], () => { throw new Error('403'); }],
    ['--expand', [PAGE, '--expand'], () => THIN],
  ]) {
    const v = vault(t);
    const { result, lines } = clip([...argv, '--ledger', v.ledger], { extract, render: moved(LEAK) });
    assert.ok(['thin', 'failed'].includes(result.status), `${name}: ${result.status}`);
    const everything = [JSON.stringify(result), lines.join('\n'), v.stored()].join('\n');
    assert.ok(!everything.includes(SECRET), `${name}: ${everything}`);
    assert.match(everything, /access_token=redacted/, name);
  }
});

test('a render that found the page gone through a redirect leaves a secret address out of the line and the row', (t) => {
  const v = vault(t);
  const reason = `redirected to an error page (https://example.test/404?token=${SECRET}) — served as HTTP 200`;
  const { lines } = clip([PAGE, '--ledger', v.ledger], { extract: () => THIN, render: () => ({ ok: false, kind: 'gone', reason }) });
  assert.ok(!`${lines.join('\n')}${v.stored()}`.includes(SECRET));
});

test('a redirect without a secret is queued and printed as it was', (t) => {
  const v = vault(t);
  const plain = 'https://example.test/next?page=2';
  const { result, lines } = clip([PAGE, '--ledger', v.ledger], { extract: () => THIN, render: moved(plain) });
  assert.equal(result.status, 'thin');
  assert.ok(result.reason.includes(MOVED(plain)), result.reason);
  assert.ok(lines.join('\n').includes(MOVED(plain)));
  assert.ok(v.stored().includes(plain));
});
